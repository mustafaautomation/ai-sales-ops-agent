import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { D1Like } from './d1'
import { migrateD1 } from './d1'
import { visitorAddress } from './client-ip'
import { decideApproval } from './decide'
import { createInquiry, driveInquiry, listRows, stepInquiry, type WorkerEnv } from './desk'
import { listApprovals } from './read'
import { handleMcp } from './mcp'
import { acceptPublicInquiry } from './public-inquiry'
import { DEMO_RESET_TABLES, resetDemo } from './reset'
import { authorizedVapi, handleVapiTool, recordCall } from './vapi'
import { RateLimiter } from './rate-limiter'
import { confirmOptIn, deliverApprovedEmail, draftDueFollowUps, suppressContact } from './outbound-flow'
import { resetDemoAndLimits } from './reset'
import { takeDaily, takeWindow } from './limits'
import { utcDay } from '../../packages/core/src/limits'
import { MCP_TOOLS } from '../../packages/core/src/tool-schemas'
import { WORKERS_AI_FALLBACK, WORKERS_AI_PRIMARY } from '../../packages/core/src/workers-ai'

function memoryD1(): D1Like {
  const db = new Database(':memory:')
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all<T>() {
              return { results: db.prepare(sql).all(...values) as T[] }
            },
            async first<T>() {
              return (db.prepare(sql).get(...values) as T) ?? null
            },
            async run() {
              const result = db.prepare(sql).run(...values)
              return { meta: { changes: result.changes } }
            },
          }
        },
      }
    },
    async exec(sql: string) {
      db.exec(sql)
    },
  }
}

const migrations = readdirSync('worker/migrations')
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ id: name.replace(/\.sql$/, ''), sql: readFileSync(`worker/migrations/${name}`, 'utf8') }))

async function ready() {
  const db = memoryD1()
  await migrateD1(db, migrations)
  return db
}

describe('D1 desk', () => {
  it('keeps an inquiry and a catalog quote after a fresh migration', async () => {
    const db = await ready()
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Quote',
      body: 'Please quote nightly cleaning for 10,000 sqft and 4 restrooms. We want an annual contract.',
    })
    let status = 'running'
    for (let step = 0; step < 8 && status === 'running'; step += 1) {
      const result = await stepInquiry(db, { DB: db, LLM_PROVIDER: 'mock' }, inquiryId)
      status = String(result.status)
    }
    expect(status).toBe('awaiting_approval')
    const quote = await db.prepare('SELECT total_cents, discount_code FROM quotes').bind().first<{ total_cents: number; discount_code: string }>()
    expect(quote?.total_cents).toBe(145_401)
    expect(quote?.discount_code).toBe('ANNUAL')
    const again = await db.prepare('SELECT subject FROM inquiries WHERE id = ?').bind(inquiryId).first<{ subject: string }>()
    expect(again?.subject).toBe('Quote')
  })
})

describe('Vapi tools', () => {
  it('rejects a missing secret and prices from the rate card without writing a quote email', async () => {
    const db = await ready()
    const request = new Request('https://worker/vapi/tool', { headers: { 'x-vapi-secret': 'nope' } })
    expect(await authorizedVapi(request, 'expected-secret')).toBe(false)
    expect(await authorizedVapi(new Request('https://worker/vapi/tool', { headers: { 'x-vapi-secret': 'expected-secret' } }), 'expected-secret')).toBe(true)
    const result = await handleVapiTool(db, {
      message: {
        type: 'tool-calls',
        call: { id: 'call_1' },
        toolCallList: [{ id: 'tc1', function: { name: 'ballpark_quote', arguments: { request: 'Please quote 24 windows.' } } }],
      },
    })
    expect(result.results[0]?.result).toContain('207.84')
    const sent = await db.prepare('SELECT count(*) AS n FROM outbound_messages').bind().first<{ n: number }>()
    expect(sent?.n).toBe(0)
    await recordCall(db, { message: { type: 'end-of-call-report', summary: 'Asked about windows.', endedReason: 'customer-ended-call', call: { id: 'call_1' }, transcript: 'hello' } })
    const call = await db.prepare('SELECT summary FROM calls WHERE vapi_call_id = ?').bind('call_1').first<{ summary: string }>()
    expect(call?.summary).toContain('windows')
  })
})

describe('call limits', () => {
  it('stops the fourth call from the same visitor and the global daily cap', async () => {
    const db = await ready()
    for (let index = 0; index < 3; index += 1) expect(await takeWindow(db, 'call:hash', 3, 86_400_000, 1_000)).toBe(true)
    expect(await takeWindow(db, 'call:hash', 3, 86_400_000, 1_000)).toBe(false)
    for (let index = 0; index < 40; index += 1) expect(await takeDaily(db, 'calls', '2026-11-20', 40)).toBe(true)
    expect(await takeDaily(db, 'calls', '2026-11-20', 40)).toBe(false)
  })
})

describe('remote MCP', () => {
  it('requires a bearer token and lists the desk tools', async () => {
    const db = await ready()
    const denied = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }))
    expect(denied.status).toBe(401)
    const listed = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    }))
    const payload = await listed.json() as { result: { tools: { name: string; inputSchema: unknown }[] } }
    expect(payload.result.tools.map((tool) => tool.name)).toEqual(MCP_TOOLS.map((tool) => tool.name))
    expect(payload.result.tools).toHaveLength(12)
    expect(payload.result.tools.every((tool) => tool.inputSchema)).toBe(true)
    const quote = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'draft_quote', arguments: { request: 'Please quote 24 windows.' } } }),
    }))
    const quoteBody = await quote.json() as { result: { content: { text: string }[] } }
    expect(quoteBody.result.content[0]?.text).toContain('20784')
  })
})

const quoteBody = 'Please quote 24 windows for the lobby.'

function scriptedAi(script: ({ name: string; args: unknown } | { text: string })[]) {
  const calls: string[] = []
  let index = 0
  const ai = {
    async run(model: string) {
      calls.push(model)
      const step = script[index]
      index += 1
      if (!step) return { choices: [{ message: { content: 'Done.' } }] }
      if ('text' in step) return { choices: [{ finish_reason: 'stop', message: { content: step.text } }] }
      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: { tool_calls: [{ function: { name: step.name, arguments: JSON.stringify(step.args) } }] },
        }],
      }
    },
  }
  return { ai, calls }
}

const quotePreamble = [
  { name: 'search_kb', args: { query: 'services overview', limit: 4 } },
  { name: 'get_price_list', args: {} },
  { name: 'crm_lookup', args: { query: 'North Wharf Logistics' } },
] as const

describe('recorded Workers AI runs', () => {
  it('finishes a quote into the approval queue when tool arguments arrive as strings', async () => {
    const db = await ready()
    const { ai, calls } = scriptedAi([
      { name: 'search_kb', args: { query: 'services overview', limit: '5' } },
      { name: 'get_price_list', args: {} },
      { name: 'crm_lookup', args: { query: 'North Wharf Logistics' } },
      {
        name: 'draft_quote',
        args: {
          companyName: 'North Wharf Logistics',
          contactName: 'Priya Shah',
          contactEmail: 'priya.shah@north-wharf.example',
          lines: [{ sku: 'WINDOW', quantity: '24' }],
        },
      },
      {
        name: 'crm_upsert',
        args: {
          companyName: 'North Wharf Logistics',
          contactName: 'Priya Shah',
          contactEmail: 'priya.shah@north-wharf.example',
          dealTitle: 'Window cleaning',
          stage: 'proposal',
          amountCents: '20784',
        },
      },
    ])
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Windows',
      body: quoteBody,
    })
    const env: WorkerEnv = { DB: db, AI: ai, LLM_PROVIDER: 'workers-ai', WORKERS_AI_MODEL: WORKERS_AI_PRIMARY, WORKERS_AI_FALLBACK_MODEL: WORKERS_AI_FALLBACK }
    const result = await driveInquiry(db, env, inquiryId, 8)
    expect(result.status).toBe('awaiting_approval')
    expect(calls.every((model) => model === WORKERS_AI_PRIMARY)).toBe(true)
    const quote = await db.prepare('SELECT total_cents, inquiry_id, run_id FROM quotes').bind().first<{ total_cents: number; inquiry_id: string; run_id: string }>()
    expect(quote?.total_cents).toBe(20784)
    expect(quote?.inquiry_id).toBe(inquiryId)
    expect(quote?.run_id).toBe(result.runId)
    const review = await db.prepare(`SELECT count(*) AS n FROM approvals WHERE tool_name = 'human_review'`).bind().first<{ n: number }>()
    expect(review?.n).toBe(0)
  })

  it('uses the fallback model when the primary tool arguments do not validate', async () => {
    const db = await ready()
    const calls: string[] = []
    const ai = {
      async run(model: string) {
        calls.push(model)
        if (model === WORKERS_AI_PRIMARY) return { tool_calls: [{ name: 'search_kb', arguments: { query: 'hours', limit: 'five' } }] }
        return { tool_calls: [{ name: 'search_kb', arguments: { query: 'services overview', limit: 4 } }] }
      },
    }
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Hours',
      body: 'What are your service hours in Cedarhaven?',
    })
    const env: WorkerEnv = { DB: db, AI: ai, LLM_PROVIDER: 'workers-ai' }
    await driveInquiry(db, env, inquiryId, 1)
    expect(calls).toEqual([WORKERS_AI_PRIMARY, WORKERS_AI_PRIMARY, WORKERS_AI_FALLBACK])
  })

  it('queues the CRM write and the quote email when the model narrates after the quote', async () => {
    const db = await ready()
    const { ai } = scriptedAi([
      ...quotePreamble,
      {
        name: 'draft_quote',
        args: {
          companyName: 'North Wharf Logistics',
          contactName: 'Priya Shah',
          contactEmail: 'priya.shah@north-wharf.example',
          lines: JSON.stringify([{ sku: 'WINDOW', quantity: '24' }]),
        },
      },
      { text: 'Called crm_upsert.' },
      { text: 'I have added the company in the CRM.' },
    ])
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Windows',
      body: quoteBody,
    })
    const env: WorkerEnv = { DB: db, AI: ai, LLM_PROVIDER: 'workers-ai' }
    const result = await driveInquiry(db, env, inquiryId, 8)
    expect(result.status).toBe('awaiting_approval')
    const approvals = await db.prepare(`SELECT tool_name, status FROM approvals WHERE status = 'pending' ORDER BY tool_name`).bind().all<{ tool_name: string; status: string }>()
    expect(approvals.results.map((row) => row.tool_name)).toEqual(['crm_upsert', 'send_email'])
    const quote = await db.prepare('SELECT total_cents, inquiry_id FROM quotes').bind().first<{ total_cents: number; inquiry_id: string }>()
    expect(quote?.total_cents).toBe(20784)
    expect(quote?.inquiry_id).toBe(inquiryId)
    const fallback = await db.prepare(`SELECT result_json FROM agent_steps WHERE tool_name = 'desk_fallback'`).bind().first<{ result_json: string }>()
    expect(fallback?.result_json).toContain('"fallback":true')
    const draft = await db.prepare(`SELECT model FROM agent_steps WHERE tool_name = 'draft_quote'`).bind().first<{ model: string }>()
    expect(draft?.model).toBe(WORKERS_AI_PRIMARY)
    const run = await db.prepare('SELECT disposition FROM agent_runs').bind().first<{ disposition: string | null }>()
    expect(run?.disposition).toBeNull()
    const crm = await db.prepare(`SELECT id FROM approvals WHERE tool_name = 'crm_upsert' AND status = 'pending'`).bind().first<{ id: string }>()
    await decideApproval(db, env, { approvalId: crm!.id, decision: 'approved', actor: 'operator' })
    const email = await db.prepare(`SELECT id, proposed_json FROM approvals WHERE tool_name = 'send_email' AND status = 'pending'`).bind().first<{ id: string; proposed_json: string }>()
    const proposedBody = JSON.parse(email!.proposed_json).body as string
    await decideApproval(db, env, { approvalId: email!.id, decision: 'approved', actor: 'operator' })
    const outbox = await db.prepare('SELECT body FROM outbound_messages').bind().first<{ body: string }>()
    const finished = await db.prepare(`SELECT result_json FROM agent_steps WHERE tool_name = 'send_email'`).bind().first<{ result_json: string }>()
    expect(outbox?.body).toBe(proposedBody)
    expect(finished?.result_json).toContain('"fallback":true')
  })

  it('does not resume the model while another approval on the run is pending', async () => {
    const db = await ready()
    let calls = 0
    const ai = {
      async run(model: string) {
        calls += 1
        const script = [
          ...quotePreamble,
          {
            name: 'draft_quote',
            args: {
              companyName: 'North Wharf Logistics',
              contactName: 'Priya Shah',
              contactEmail: 'priya.shah@north-wharf.example',
              lines: [{ sku: 'WINDOW', qty: 24 }],
            },
          },
          { text: 'Called crm_upsert.' },
          { text: 'Called crm_upsert.' },
        ] as ({ name: string; args: unknown } | { text: string })[]
        const step = script[calls - 1]
        if (!step) throw new Error('the model was called after the approvals were queued')
        if (model !== WORKERS_AI_PRIMARY) throw new Error(model)
        if ('text' in step) return { choices: [{ message: { content: step.text } }] }
        return { choices: [{ message: { tool_calls: [{ function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] }
      },
    }
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Windows',
      body: quoteBody,
    })
    const env: WorkerEnv = { DB: db, AI: ai, LLM_PROVIDER: 'workers-ai' }
    await driveInquiry(db, env, inquiryId, 8)
    const before = calls
    const crm = await db.prepare(`SELECT id FROM approvals WHERE tool_name = 'crm_upsert' AND status = 'pending'`).bind().first<{ id: string }>()
    await decideApproval(db, env, { approvalId: crm!.id, decision: 'approved', actor: 'operator' })
    expect(calls).toBe(before)
    const pending = await db.prepare(`SELECT tool_name FROM approvals WHERE status = 'pending'`).bind().all<{ tool_name: string }>()
    expect(pending.results.map((row) => row.tool_name)).toEqual(['send_email'])
    const run = await db.prepare('SELECT status, disposition FROM agent_runs').bind().first<{ status: string; disposition: string | null }>()
    expect(run?.status).toBe('awaiting_approval')
    expect(run?.disposition).toBeNull()
    const companies = await db.prepare('SELECT count(*) AS n FROM crm_companies').bind().first<{ n: number }>()
    expect(companies?.n).toBe(1)
  })
})

describe('approval execution', () => {
  it('writes the sandbox outbox and the CRM from the worker and from MCP', async () => {
    const db = await ready()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock' }
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Quote',
      body: 'Please quote nightly cleaning for 10,000 sqft and 4 restrooms. We want an annual contract.',
    })
    const paused = await driveInquiry(db, env, inquiryId, 8)
    expect(paused.status).toBe('awaiting_approval')
    const crm = await db.prepare(`SELECT id, proposed_json FROM approvals WHERE status = 'pending'`).bind().first<{ id: string; proposed_json: string }>()
    expect(crm?.id).toBeTruthy()
    await decideApproval(db, env, { approvalId: crm!.id, decision: 'approved', actor: 'operator' })
    const company = await db.prepare('SELECT count(*) AS n FROM crm_companies').bind().first<{ n: number }>()
    expect(company?.n).toBe(1)
    const email = await db.prepare(`SELECT id, proposed_json FROM approvals WHERE status = 'pending'`).bind().first<{ id: string; proposed_json: string }>()
    const proposed = JSON.parse(email!.proposed_json) as { subject: string }
    proposed.subject = 'Updated subject'
    const mcp = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'decide_approval', arguments: { id: email!.id, decision: 'approved', finalJson: JSON.stringify(proposed) } } }),
    }), env)
    const mcpBody = await mcp.json() as { result: { content: { text: string }[] } }
    expect(mcpBody.result.content[0]?.text).toContain('run_')
    const outbox = await db.prepare(`SELECT status, subject FROM outbound_messages`).bind().first<{ status: string; subject: string }>()
    expect(outbox?.status).toBe('sandbox')
    expect(outbox?.subject).toBe('Updated subject')
    const quote = await db.prepare(`SELECT status FROM quotes`).bind().first<{ status: string }>()
    expect(quote?.status).toBe('sent')
    const sent = await db.prepare(`SELECT body FROM outbound_messages`).bind().first<{ body: string }>()
    const final = await db.prepare(`SELECT final_json FROM approvals WHERE id = ?`).bind(email!.id).first<{ final_json: string }>()
    expect(sent?.body).toBe(JSON.parse(final!.final_json).body)
    expect(sent?.body).toBe(JSON.parse(email!.proposed_json).body)
    const audit = await db.prepare(`SELECT action, actor FROM audit_log ORDER BY at, rowid`).bind().all<{ action: string; actor: string }>()
    const actions = audit.results.map((row) => `${row.actor}:${row.action}`)
    expect(actions).toContain('agent:inquiry.classified')
    expect(actions.filter((action) => action === 'agent:approval.requested').length).toBeGreaterThanOrEqual(2)
    expect(actions).toContain('operator:approval.approved')
    expect(actions).toContain('mcp:approval.edited')
    const again = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'decide_approval', arguments: { id: email!.id, decision: 'approved' } } }),
    }), env)
    const againBody = await again.json() as { result: { content: { text: string }[] } }
    expect(againBody.result.content[0]?.text).toContain('no longer pending')
    const messages = await db.prepare('SELECT count(*) AS n FROM outbound_messages').bind().first<{ n: number }>()
    expect(messages?.n).toBe(1)
  })

  it('rejects without writing the CRM', async () => {
    const db = await ready()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock' }
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Quote',
      body: 'Please quote nightly cleaning for 10,000 sqft and 4 restrooms. We want an annual contract.',
    })
    await driveInquiry(db, env, inquiryId, 8)
    const approval = await db.prepare(`SELECT id FROM approvals WHERE status = 'pending'`).bind().first<{ id: string }>()
    await decideApproval(db, env, { approvalId: approval!.id, decision: 'rejected', actor: 'operator' })
    const companies = await db.prepare('SELECT count(*) AS n FROM crm_companies').bind().first<{ n: number }>()
    expect(companies?.n).toBe(0)
    const actions = await db.prepare(`SELECT action FROM audit_log`).bind().all<{ action: string }>()
    expect(actions.results.map((row) => row.action)).toEqual(expect.arrayContaining(['inquiry.classified', 'approval.requested', 'approval.rejected']))
  })
})

describe('public inquiry safety', () => {
  it('does not spend the model budget on spam', async () => {
    const db = await ready()
    let calls = 0
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'workers-ai', AI: { async run() { calls += 1; return {} } } }
    const response = await acceptPublicInquiry(db, env, {
      name: 'Promo',
      email: 'promo@guest-post.example',
      subject: 'Guest post',
      message: 'We offer SEO services and guest posts for your site.',
    }, '203.0.113.9')
    expect(response.status).toBe(201)
    expect(calls).toBe(0)
    const llm = await db.prepare(`SELECT count FROM daily_counters WHERE scope = 'llm'`).bind().first()
    expect(llm).toBeNull()
    const run = await db.prepare('SELECT disposition, summary FROM agent_runs').bind().first<{ disposition: string; summary: string }>()
    expect(run?.disposition).toBe('archived_spam')
    expect(run?.summary).toContain('guest post')
    expect(run?.summary).toContain('seo services')
    const classified = await db.prepare(`SELECT result_json FROM agent_steps WHERE tool_name = 'classify'`).bind().first<{ result_json: string }>()
    expect(classified?.result_json).toContain('guest post')
    expect(classified?.result_json).toContain('seo services')
  })

  it('keeps rate-limit counters when the demo reset runs', async () => {
    const db = await ready()
    expect(DEMO_RESET_TABLES).not.toContain('rate_buckets')
    await takeDaily(db, 'calls', '2026-11-20', 40)
    await takeWindow(db, 'call:hash', 3, 86_400_000, 1_000)
    await resetDemo(db)
    const daily = await db.prepare(`SELECT count FROM daily_counters WHERE scope = 'calls'`).bind().first<{ count: number }>()
    const bucket = await db.prepare(`SELECT count FROM rate_buckets WHERE bucket_key = 'call:hash'`).bind().first<{ count: number }>()
    expect(daily).toBeNull()
    expect(bucket?.count).toBe(1)
    const subjects = await db.prepare('SELECT subject, status FROM inquiries ORDER BY subject').bind().all<{ subject: string; status: string }>()
    expect(subjects.results).toEqual([
      { subject: 'Annual office quote', status: 'awaiting_approval' },
      { subject: 'Guest post', status: 'archived' },
      { subject: 'Unreadable note', status: 'awaiting_approval' },
      { subject: 'Window quote', status: 'resolved' },
    ])
    const pending = await db.prepare(`SELECT tool_name FROM approvals WHERE status = 'pending' ORDER BY tool_name`).bind().all<{ tool_name: string }>()
    expect(pending.results.map((row) => row.tool_name)).toEqual(['crm_upsert', 'human_review', 'send_email'])
    const outbox = await db.prepare(`SELECT status FROM outbound_messages`).bind().first<{ status: string }>()
    expect(outbox?.status).toBe('sandbox')
    const call = await db.prepare(`SELECT summary FROM calls`).bind().first<{ summary: string }>()
    expect(call?.summary).toContain('windows')
    const audit = await db.prepare('SELECT count(*) AS n FROM audit_log').bind().first<{ n: number }>()
    expect(audit?.n).toBe(3)
    const company = await db.prepare(`SELECT name FROM crm_companies`).bind().first<{ name: string }>()
    expect(company?.name).toBe('Lantern Hall')
    const ages = await db.prepare('SELECT id, created_at FROM inquiries').bind().all<{ id: string; created_at: number }>()
    const at = Object.fromEntries(ages.results.map((row) => [row.id, row.created_at]))
    expect(at.inq_seed_pending).toBeGreaterThan(at.inq_seed_review)
    expect(at.inq_seed_review).toBeGreaterThan(at.inq_seed_sent)
    expect(at.inq_seed_sent).toBeGreaterThan(at.inq_seed_spam)
    const listed = await listRows(db, 'inquiries')
    expect(listed.map((row) => row.id)).toEqual(['inq_seed_pending', 'inq_seed_review', 'inq_seed_sent', 'inq_seed_spam'])
    const approvalOrder = await listApprovals(db)
    const times = approvalOrder.map((row) => Number(row.createdAt))
    expect(times).toEqual([...times].sort((left, right) => right - left))
    const resetAt = Date.now()
    const week = 7 * 24 * 60 * 60 * 1000
    for (const row of ages.results) {
      expect(row.created_at).toBeGreaterThan(0)
      expect(row.created_at).toBeGreaterThan(resetAt - week)
      expect(row.created_at).toBeLessThanOrEqual(resetAt)
    }
  })
})

describe('run ids', () => {
  it('overwrites a model inquiry id of none with the run inquiry', async () => {
    const db = await ready()
    const { ai } = scriptedAi([
      ...quotePreamble,
      {
        name: 'draft_quote',
        args: {
          companyName: 'North Wharf Logistics',
          contactName: 'Priya Shah',
          contactEmail: 'priya.shah@north-wharf.example',
          lines: [{ sku: 'WINDOW', qty: 24 }],
        },
      },
      {
        name: 'crm_upsert',
        args: {
          companyName: 'North Wharf Logistics',
          contactName: 'Priya Shah',
          contactEmail: 'priya.shah@north-wharf.example',
          dealTitle: 'Windows',
          stage: 'proposal',
          amountCents: 20784,
          inquiryId: 'none',
          quoteId: 'none',
        },
      },
    ])
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Windows',
      body: quoteBody,
    })
    await driveInquiry(db, { DB: db, AI: ai, LLM_PROVIDER: 'workers-ai' }, inquiryId, 8)
    const approval = await db.prepare(`SELECT proposed_json FROM approvals WHERE tool_name = 'crm_upsert'`).bind().first<{ proposed_json: string }>()
    const proposed = JSON.parse(approval!.proposed_json) as { inquiryId: string; quoteId: string }
    expect(proposed.inquiryId).toBe(inquiryId)
    expect(proposed.quoteId).not.toBe('none')
    expect(proposed.quoteId.startsWith('quo_')).toBe(true)
  })
})

describe('Workers AI schema failures', () => {
  it('keeps both model errors when the binding rejects the request', async () => {
    const db = await ready()
    const boom = '5006: oneOf at \'/\' not met, 0 matches: Type mismatch of \'/messages/2/content\', \'string\' not in \'null\''
    const ai = { async run() { throw new Error(boom) } }
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Hours',
      body: 'What are your service hours in Cedarhaven?',
    })
    const env: WorkerEnv = { DB: db, AI: ai, LLM_PROVIDER: 'workers-ai' }
    await driveInquiry(db, env, inquiryId, 2)
    const run = await db.prepare('SELECT error FROM agent_runs').bind().first<{ error: string }>()
    expect(run?.error).toContain(WORKERS_AI_PRIMARY)
    expect(run?.error).toContain(WORKERS_AI_FALLBACK)
    expect(run?.error).toContain('5006')
    expect(run?.error).not.toContain('oneOf')
    const steps = await db.prepare(`SELECT tool_name, result_json FROM agent_steps`).bind().all<{ tool_name: string; result_json: string | null }>()
    const errors = steps.results.filter((step) => step.tool_name === 'model_output')
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(errors.some((step) => step.result_json?.includes(WORKERS_AI_PRIMARY))).toBe(true)
    expect(errors.some((step) => step.result_json?.includes(WORKERS_AI_FALLBACK))).toBe(true)
    expect(steps.results.some((step) => step.result_json?.includes('oneOf'))).toBe(false)
    const fallback = steps.results.find((step) => step.tool_name === 'desk_fallback')
    expect(fallback?.result_json).toContain('5006')
    expect(fallback?.result_json).toContain(WORKERS_AI_PRIMARY)
  })
})

describe('demo reset and step clocks', () => {
  it('records each step’s own start and finish', async () => {
    const db = await ready()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock' }
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Hours',
      body: 'What are your evening hours?',
    })
    await driveInquiry(db, env, inquiryId, 8)
    const steps = await db.prepare('SELECT tool_name, started_at, finished_at FROM agent_steps ORDER BY step_index').bind().all<{ tool_name: string; started_at: number; finished_at: number }>()
    expect(steps.results.length).toBeGreaterThan(1)
    for (const step of steps.results) {
      expect(step.finished_at).toBeGreaterThanOrEqual(step.started_at)
      expect(step.finished_at - step.started_at).toBeLessThan(5_000)
    }
  })

  it('clears the call limiter when an operator resets the demo', async () => {
    const db = await ready()
    const hits: string[] = []
    await resetDemoAndLimits(db, {
      idFromName: () => 'calls',
      get: () => ({
        fetch: async (input: RequestInfo) => {
          hits.push(String(input))
          return Response.json({ ok: true })
        },
      }),
    })
    expect(hits).toEqual(['https://limiter/reset'])
    const sqlite = new Database(':memory:')
    const limiter = new RateLimiter({
      storage: {
        sql: {
          exec(query: string, ...params: unknown[]) {
            const statement = sqlite.prepare(query)
            const rows = /^\s*select/i.test(query) ? statement.all(...params) : (statement.run(...params), [])
            return { toArray: () => rows }
          },
        },
      },
    })
    const first = await limiter.fetch(new Request('https://limiter/calls', { method: 'POST', body: JSON.stringify({ hash: 'same' }) }))
    expect(first.status).toBe(200)
    await limiter.fetch(new Request('https://limiter/calls', { method: 'POST', body: JSON.stringify({ hash: 'same' }) }))
    await limiter.fetch(new Request('https://limiter/calls', { method: 'POST', body: JSON.stringify({ hash: 'same' }) }))
    const blocked = await limiter.fetch(new Request('https://limiter/calls', { method: 'POST', body: JSON.stringify({ hash: 'same' }) }))
    expect(blocked.status).toBe(429)
    const cleared = await limiter.fetch(new Request('https://limiter/reset', { method: 'POST', body: '{}' }))
    expect(cleared.status).toBe(200)
    const again = await limiter.fetch(new Request('https://limiter/calls', { method: 'POST', body: JSON.stringify({ hash: 'same' }) }))
    expect(again.status).toBe(200)
  })
})

describe('follow-up and outbound calls', () => {
  it('drafts one follow-up and then stops', async () => {
    const db = await ready()
    const sentAt = Date.now() - 3 * 24 * 60 * 60 * 1000
    await db.prepare(
      `INSERT INTO inquiries (id, source, external_id, from_name, from_email, company_name, subject, body, status, intent, injection_flag, created_at, updated_at, email_verified_at)
       VALUES ('inq_follow', 'web', 'web:inq_follow', 'Elena Marsh', 'elena@example.com', 'West Cedar Dental', 'Quote', 'Please quote 1,000 sqft.', 'resolved', 'quote', 0, ?, ?, ?)`,
    ).bind(sentAt, sentAt, sentAt).run()
    await db.prepare(
      `INSERT INTO agent_runs (id, inquiry_id, status, provider, disposition, summary, error, started_at, finished_at) VALUES ('run_follow', 'inq_follow', 'completed', 'mock', 'completed', 'sent', NULL, ?, ?)`,
    ).bind(sentAt, sentAt).run()
    await db.prepare(
      `INSERT INTO quotes (id, number, inquiry_id, run_id, company_name, contact_name, contact_email, discount_code, discount_bps, tax_bps, subtotal_cents, discount_cents, tax_cents, total_cents, currency, status, valid_until, notes, created_at)
       VALUES ('quo_follow', 'MF-9', 'inq_follow', 'run_follow', 'West Cedar Dental', 'Elena', 'elena@example.com', NULL, 0, 825, 100, 0, 8, 108, 'USD', 'sent', '2026-12-01', NULL, ?)`,
    ).bind(sentAt).run()
    await db.prepare(
      `INSERT INTO outbound_messages (id, approval_id, inquiry_id, quote_id, to_email, subject, body, provider_message_id, status, created_at)
       VALUES ('out_follow', NULL, 'inq_follow', 'quo_follow', 'elena@example.com', 'Quote', 'Hello', NULL, 'sent', ?)`,
    ).bind(sentAt).run()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock', FOLLOW_UP_AFTER_DAYS: '2' }
    expect(await draftDueFollowUps(db, env)).toBe(1)
    expect(await draftDueFollowUps(db, env)).toBe(0)
    const pending = await db.prepare(`SELECT count(*) AS n FROM approvals WHERE tool_name = 'send_email' AND status = 'pending'`).bind().first<{ n: number }>()
    expect(pending?.n).toBe(1)
    await resetDemo(db)
    const still = await db.prepare(`SELECT id FROM inquiries WHERE id = 'inq_follow'`).bind().first<{ id: string }>()
    expect(still?.id).toBe('inq_follow')
    const fixtures = await db.prepare(`SELECT count(*) AS n FROM inquiries WHERE id LIKE 'inq_seed_%'`).bind().first<{ n: number }>()
    expect(fixtures?.n).toBe(4)
  })

  it('matches an ended outbound call by its Vapi id', async () => {
    const db = await ready()
    await db.prepare(
      `INSERT INTO outbound_calls (id, inquiry_id, approval_id, phone, mode, status, vapi_call_id, scheduled_at, started_at, ended_at, summary, created_at)
       VALUES ('ocall_1', 'inq_seed_sent', NULL, '+60123456789', 'phone', 'started', 'call_out_1', NULL, ?, NULL, NULL, ?)`,
    ).bind(Date.now(), Date.now()).run()
    await recordCall(db, {
      message: {
        type: 'end-of-call-report',
        summary: 'Booked a visit.',
        endedReason: 'customer-ended-call',
        call: { id: 'call_out_1', type: 'outboundPhoneCall' },
        artifact: { recordingUrl: 'https://example.com/recording.mp3' },
      },
    })
    const row = await db.prepare(`SELECT status, summary FROM outbound_calls WHERE id = 'ocall_1'`).bind().first<{ status: string; summary: string }>()
    expect(row?.status).toBe('ended')
    expect(row?.summary).toBe('Booked a visit.')
    const audit = await db.prepare(`SELECT action FROM audit_log WHERE action = 'call.ended'`).bind().first<{ action: string }>()
    expect(audit?.action).toBe('call.ended')
  })
})

describe('opt-in caps and callbacks', () => {
  it('returns 429 on the fourth opt-in from one IP', async () => {
    const db = await ready()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock', PUBLIC_ORIGIN: 'https://sales.quvantic.com', SESSION_SECRET: 'test-secret' }
    for (let index = 0; index < 3; index += 1) {
      const response = await acceptPublicInquiry(db, env, {
        name: 'Elena Marsh',
        email: `elena${index}@example.com`,
        company: 'West Cedar Dental',
        subject: 'Confirm me',
        message: 'Please quote nightly cleaning for 1,000 sqft.',
        consentEmail: true,
      }, '203.0.113.8')
      expect(response.status).toBe(201)
    }
    const blocked = await acceptPublicInquiry(db, env, {
      name: 'Elena Marsh',
      email: 'elena3@example.com',
      company: 'West Cedar Dental',
      subject: 'Confirm me',
      message: 'Please quote nightly cleaning for 1,000 sqft.',
      consentEmail: true,
    }, '203.0.113.8')
    expect(blocked.status).toBe(429)
    const body = await db.prepare(`SELECT body FROM outbound_messages WHERE subject = 'Confirm your email' LIMIT 1`).bind().first<{ body: string }>()
    expect(body?.body).toContain('https://sales.quvantic.com/confirm?token=')
    expect(body?.body).not.toContain('/api/public/opt-in')
    expect(body?.body).toContain('/unsubscribed?token=')
  })

  it('approves a callback for a verified lead and stores a call link', async () => {
    const db = await ready()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock', PUBLIC_ORIGIN: 'https://sales.quvantic.com', SESSION_SECRET: 'test-secret', now: new Date('2026-11-20T02:00:00Z') }
    await db.prepare(
      `INSERT INTO inquiries (id, source, external_id, from_name, from_email, company_name, subject, body, status, intent, injection_flag, created_at, updated_at, email_verified_at, phone)
       VALUES ('inq_call', 'web', 'web:inq_call', 'Elena Marsh', 'elena@example.com', 'West Cedar Dental', 'Nightly cleaning', 'Please call me.', 'processing', 'quote', 0, ?, ?, ?, '+60123456789')`,
    ).bind(Date.now(), Date.now(), Date.now()).run()
    const denied = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'request_callback', arguments: { inquiryId: 'inq_missing', phone: '+60123456789' } } }),
    }), env)
    const deniedBody = await denied.json() as { result: { content: { text: string }[] } }
    expect(deniedBody.result.content[0]?.text).toContain('not_found')
    await db.prepare(`UPDATE inquiries SET email_verified_at = NULL WHERE id = 'inq_call'`).bind().run()
    const unverified = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'request_callback', arguments: { inquiryId: 'inq_call', phone: '+60123456789' } } }),
    }), env)
    const unverifiedBody = await unverified.json() as { result: { content: { text: string }[] } }
    expect(unverifiedBody.result.content[0]?.text).toContain('not verified')
    await db.prepare(`UPDATE inquiries SET email_verified_at = ? WHERE id = 'inq_call'`).bind(Date.now()).run()
    const queued = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'request_callback', arguments: { inquiryId: 'inq_call', phone: '+60123456789' } } }),
    }), env)
    const queuedBody = await queued.json() as { result: { content: { text: string }[] } }
    const approvalId = JSON.parse(queuedBody.result.content[0]?.text ?? '{}').approvalId as string
    expect(approvalId).toBeTruthy()
    await decideApproval(db, env, { approvalId, decision: 'approved', actor: 'operator' })
    const call = await db.prepare(`SELECT status, summary, mode FROM outbound_calls WHERE approval_id = ?`).bind(approvalId).first<{ status: string; summary: string; mode: string }>()
    expect(call?.mode).toBe('browser')
    expect(call?.status).toBe('link_sent')
    expect(call?.summary).toContain('https://sales.quvantic.com/call/')
    const mailed = await db.prepare(`SELECT body, status FROM outbound_messages WHERE subject = 'Talk to Meridian now'`).bind().first<{ body: string; status: string }>()
    expect(mailed?.status).toBe('sandbox')
    expect(mailed?.body).toContain('/unsubscribed?token=')
    expect(mailed?.body).toContain(call?.summary)
  })

  it('confirms an address once and refuses a suppressed address', async () => {
    const db = await ready()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock', PUBLIC_ORIGIN: 'https://sales.quvantic.com', SESSION_SECRET: 'test-secret' }
    const created = await acceptPublicInquiry(db, env, {
      name: 'Elena Marsh',
      email: 'elena@example.com',
      company: 'West Cedar Dental',
      subject: 'Nightly cleaning',
      message: 'Please quote nightly cleaning for 1,000 sqft.',
      consentEmail: true,
    }, '203.0.113.20')
    expect(created.status).toBe(201)
    const stored = await db.prepare(`SELECT body FROM outbound_messages WHERE to_email = 'elena@example.com'`).bind().first<{ body: string }>()
    const token = stored?.body.match(/confirm\?token=([^\s]+)/)?.[1]
    expect(token).toBeTruthy()
    const first = await confirmOptIn(db, env, decodeURIComponent(token!))
    const second = await confirmOptIn(db, env, decodeURIComponent(token!))
    expect(first.ok).toBe(true)
    expect(first.already).toBe(false)
    expect(second.already).toBe(true)
    expect(second.subject).toBe('Nightly cleaning')
    const audits = await db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'email.verified' AND entity_id = ?`).bind(first.inquiryId).first<{ n: number }>()
    expect(audits?.n).toBe(1)
    const stop = stored?.body.match(/unsubscribed\?token=([^\s]+)/)?.[1]
    expect(await suppressContact(db, env, { token: decodeURIComponent(stop!) })).toMatchObject({ ok: true })
    const blocked = await acceptPublicInquiry(db, env, {
      name: 'Elena Marsh',
      email: 'Elena@Example.com',
      company: 'West Cedar Dental',
      subject: 'Nightly cleaning again',
      message: 'Please quote nightly cleaning for 1,000 sqft.',
      consentEmail: true,
    }, '203.0.113.21')
    expect(blocked.status).toBe(403)
    const listed = await db.prepare(`SELECT count(*) AS n FROM suppressions WHERE kind = 'email' AND value = 'elena@example.com' AND cleared_at IS NULL`).bind().first<{ n: number }>()
    expect(listed?.n).toBe(1)
  })

  it('returns 429 on the third opt-in to one address and when the global cap is full', async () => {
    const db = await ready()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock', PUBLIC_ORIGIN: 'https://sales.quvantic.com', SESSION_SECRET: 'test-secret' }
    for (let index = 0; index < 2; index += 1) {
      const response = await acceptPublicInquiry(db, env, {
        name: 'Elena Marsh',
        email: 'same@example.com',
        company: 'West Cedar Dental',
        subject: `Confirm ${index}`,
        message: 'Please quote nightly cleaning for 1,000 sqft.',
        consentEmail: true,
      }, `198.51.100.${index + 1}`)
      expect(response.status).toBe(201)
    }
    const third = await acceptPublicInquiry(db, env, {
      name: 'Elena Marsh',
      email: 'same@example.com',
      company: 'West Cedar Dental',
      subject: 'Confirm again',
      message: 'Please quote nightly cleaning for 1,000 sqft.',
      consentEmail: true,
    }, '198.51.100.9')
    expect(third.status).toBe(429)
    await db.prepare(`UPDATE daily_counters SET count = 50 WHERE scope = 'optin' AND day = ?`).bind(utcDay()).run()
    const global = await acceptPublicInquiry(db, env, {
      name: 'Elena Marsh',
      email: 'other@example.com',
      company: 'West Cedar Dental',
      subject: 'Confirm other',
      message: 'Please quote nightly cleaning for 1,000 sqft.',
      consentEmail: true,
    }, '198.51.100.10')
    expect(global.status).toBe(429)
  })

  it('does not mark a quote sent when the address is suppressed', async () => {
    const db = await ready()
    const env: WorkerEnv = { DB: db, LLM_PROVIDER: 'mock', SESSION_SECRET: 'test-secret' }
    await clearAndQuote(db, env)
    const quote = await db.prepare(`SELECT status FROM quotes WHERE id = 'quo_blocked'`).bind().first<{ status: string }>()
    expect(quote?.status).toBe('draft')
    await db.prepare(
      `INSERT INTO inquiries (id, source, external_id, from_name, from_email, company_name, subject, body, status, intent, injection_flag, created_at, updated_at, email_verified_at)
       VALUES ('inq_off', 'web', 'web:inq_off', 'Elena Marsh', 'off@example.com', 'West Cedar Dental', 'Quote', 'Please quote.', 'awaiting_approval', 'quote', 0, ?, ?, ?)`,
    ).bind(Date.now(), Date.now(), Date.now()).run()
    await db.prepare(
      `INSERT INTO quotes (id, number, inquiry_id, run_id, company_name, contact_name, contact_email, discount_code, discount_bps, tax_bps, subtotal_cents, discount_cents, tax_cents, total_cents, currency, status, valid_until, notes, created_at)
       VALUES ('quo_off', 'MF-1198', 'inq_off', NULL, 'West Cedar Dental', 'Elena Marsh', 'off@example.com', NULL, 0, 825, 100, 0, 8, 108, 'USD', 'draft', '2026-12-01', NULL, ?)`,
    ).bind(Date.now()).run()
    const off = await db.prepare('SELECT * FROM inquiries WHERE id = ?').bind('inq_off').first<Record<string, string | number | null>>()
    const disabled = await deliverApprovedEmail(db, env, off!, 'apr_off', {
      to: 'off@example.com',
      subject: 'Quote MF-1198',
      body: 'Hello Elena,\n\nThe total is $1.08.\n\nMeridian Facilities sales desk\nCedarhaven',
      purpose: 'quote',
      quoteId: 'quo_off',
    })
    expect(disabled.status).toBe('blocked_disabled')
    const stillDraft = await db.prepare(`SELECT status FROM quotes WHERE id = 'quo_off'`).bind().first<{ status: string }>()
    expect(stillDraft?.status).toBe('draft')
  })
})

async function clearAndQuote(db: D1Like, env: WorkerEnv) {
  await db.prepare(
    `INSERT INTO inquiries (id, source, external_id, from_name, from_email, company_name, subject, body, status, intent, injection_flag, created_at, updated_at, email_verified_at)
     VALUES ('inq_blocked', 'web', 'web:inq_blocked', 'Elena Marsh', 'blocked@example.com', 'West Cedar Dental', 'Quote', 'Please quote.', 'awaiting_approval', 'quote', 0, ?, ?, ?)`,
  ).bind(Date.now(), Date.now(), Date.now()).run()
  await db.prepare(
    `INSERT INTO quotes (id, number, inquiry_id, run_id, company_name, contact_name, contact_email, discount_code, discount_bps, tax_bps, subtotal_cents, discount_cents, tax_cents, total_cents, currency, status, valid_until, notes, created_at)
     VALUES ('quo_blocked', 'MF-1199', 'inq_blocked', NULL, 'West Cedar Dental', 'Elena Marsh', 'blocked@example.com', NULL, 0, 825, 100, 0, 8, 108, 'USD', 'draft', '2026-12-01', NULL, ?)`,
  ).bind(Date.now()).run()
  await suppressContact(db, env, { email: 'blocked@example.com' })
  const inquiry = await db.prepare('SELECT * FROM inquiries WHERE id = ?').bind('inq_blocked').first<Record<string, string | number | null>>()
  const delivered = await deliverApprovedEmail(db, env, inquiry!, 'apr_blocked', {
    to: 'blocked@example.com',
    subject: 'Quote MF-1199',
    body: 'Hello Elena,\n\nThe total is $1.08.\n\nMeridian Facilities sales desk\nCedarhaven',
    purpose: 'quote',
    quoteId: 'quo_blocked',
  })
  expect(delivered.status).toBe('blocked_suppressed')
  const row = await db.prepare(`SELECT status FROM outbound_messages WHERE approval_id = 'apr_blocked'`).bind().first<{ status: string }>()
  expect(row?.status).toBe('blocked_suppressed')
}

describe('visitor IP', () => {
  it('ignores a spoofed x-visitor-ip unless the bearer token matches', () => {
    const headers = { 'x-visitor-ip': '203.0.113.8', 'cf-connecting-ip': '198.51.100.20' }
    const spoofed = new Request('https://meridian-desk.example/api/public/inquiries', { headers })
    expect(visitorAddress(spoofed, 'desk-token')).toBe('198.51.100.20')
    const authed = new Request('https://meridian-desk.example/api/voice/session', {
      headers: { ...headers, authorization: 'Bearer desk-token' },
    })
    expect(visitorAddress(authed, 'desk-token')).toBe('203.0.113.8')
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/get\('x-visitor-ip'\)/)
    expect(source).toContain('visitorAddress')
  })
})

describe('call events', () => {
  it('does not overwrite an ended call when a later tool event arrives', async () => {
    const db = await ready()
    await recordCall(db, { message: { type: 'end-of-call-report', summary: 'Done', endedReason: 'customer-ended-call', call: { id: 'call_status' }, transcript: 'bye' } })
    await recordCall(db, { message: { type: 'tool-calls', call: { id: 'call_status' } } })
    const row = await db.prepare('SELECT status, summary FROM calls WHERE vapi_call_id = ?').bind('call_status').first<{ status: string; summary: string }>()
    expect(row?.status).toBe('ended')
    expect(row?.summary).toBe('Done')
  })
})
