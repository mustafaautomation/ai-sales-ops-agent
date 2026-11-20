import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { D1Like } from './d1'
import { migrateD1 } from './d1'
import { visitorAddress } from './client-ip'
import { decideApproval } from './decide'
import { createInquiry, driveInquiry, stepInquiry, type WorkerEnv } from './desk'
import { handleMcp, mcpTools } from './mcp'
import { acceptPublicInquiry } from './public-inquiry'
import { DEMO_RESET_TABLES, resetDemo } from './reset'
import { authorizedVapi, handleVapiTool, recordCall } from './vapi'
import { takeDaily, takeWindow } from './limits'
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
    expect(payload.result.tools.map((tool) => tool.name)).toEqual(mcpTools().map((tool) => tool.name))
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

function scriptedAi(script: { name: string; args: unknown }[]) {
  const calls: string[] = []
  let index = 0
  const ai = {
    async run(model: string) {
      calls.push(model)
      const step = script[index]
      index += 1
      if (!step) return { choices: [{ message: { content: 'Done.' } }] }
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
    const { ai, calls } = scriptedAi([
      { name: 'search_kb', args: { query: 'hours', limit: 'five' } },
      { name: 'search_kb', args: { query: 'services overview', limit: '4' } },
    ])
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
    expect(calls.slice(0, 2)).toEqual([WORKERS_AI_PRIMARY, WORKERS_AI_FALLBACK])
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
    const audit = await db.prepare(`SELECT action, actor FROM audit_log ORDER BY at`).bind().all<{ action: string; actor: string }>()
    expect(audit.results.map((row) => `${row.actor}:${row.action}`)).toEqual(['operator:approval.approved', 'mcp:approval.edited'])
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
    const row = await db.prepare(`SELECT action FROM audit_log`).bind().first<{ action: string }>()
    expect(row?.action).toBe('approval.rejected')
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
    const run = await db.prepare('SELECT disposition FROM agent_runs').bind().first<{ disposition: string }>()
    expect(run?.disposition).toBe('archived_spam')
  })

  it('keeps rate-limit counters when the demo reset runs', async () => {
    const db = await ready()
    expect(DEMO_RESET_TABLES).not.toContain('daily_counters')
    expect(DEMO_RESET_TABLES).not.toContain('rate_buckets')
    await takeDaily(db, 'calls', '2026-11-20', 40)
    await takeWindow(db, 'call:hash', 3, 86_400_000, 1_000)
    await resetDemo(db)
    const daily = await db.prepare(`SELECT count FROM daily_counters WHERE scope = 'calls'`).bind().first<{ count: number }>()
    const bucket = await db.prepare(`SELECT count FROM rate_buckets WHERE bucket_key = 'call:hash'`).bind().first<{ count: number }>()
    expect(daily?.count).toBe(1)
    expect(bucket?.count).toBe(1)
  })
})

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
