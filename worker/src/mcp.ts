import { KB_DOCS, allChunks, searchChunks } from '../../packages/core/src/kb'
import { computeQuote } from '../../packages/core/src/quote'
import { pickQuote } from '../../packages/core/src/picker'
import { secretsMatch } from '../../packages/core/src/vapi-jwt'
import type { D1Like } from './d1'
import { decideApproval } from './decide'
import { isSuppressed, suppressContact } from './outbound-flow'
import { id } from '../../packages/core/src/ids'
import { parseE164 } from '../../packages/core/src/outbound'
import type { WorkerEnv } from './desk'

const TOOLS = [
  { name: 'list_inbox', description: 'List recent inquiries.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_inquiry', description: 'Read one inquiry by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'search_kb', description: 'Search the knowledge base. Read-only.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'draft_quote', description: 'Estimate a quote from the rate card. Does not send it or write the CRM.', inputSchema: { type: 'object', properties: { request: { type: 'string' } }, required: ['request'] } },
  { name: 'list_pending_approvals', description: 'List approvals waiting on an operator.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_lead', description: 'Read a company and its deals by name.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'search_crm', description: 'Search companies and deals. Read-only.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_calls', description: 'List stored sales-line calls.', inputSchema: { type: 'object', properties: {} } },
  { name: 'decide_approval', description: 'Approve or reject a pending approval. Writes an audit row.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, decision: { type: 'string', enum: ['approved', 'rejected'] } }, required: ['id', 'decision'] } },
  { name: 'request_callback', description: 'Queue an AI callback for a verified lead. It waits for approval.', inputSchema: { type: 'object', properties: { inquiryId: { type: 'string' }, phone: { type: 'string' } }, required: ['inquiryId', 'phone'] } },
  { name: 'list_outbound', description: 'List recent outbound emails and callbacks.', inputSchema: { type: 'object', properties: {} } },
  { name: 'suppress_contact', description: 'Stop email and calls for an address.', inputSchema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] } },
]

export function mcpTools() {
  return TOOLS
}

export async function handleMcp(db: D1Like, token: string, request: Request, env?: WorkerEnv): Promise<Response> {
  const header = request.headers.get('authorization') ?? ''
  const presented = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!(await secretsMatch(presented, token))) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, { status: 401 })
  }
  const body = (await request.json()) as { id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
  if (body.method === 'initialize') {
    return rpc(body.id ?? null, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'meridian-desk', version: '1.0.0' },
    })
  }
  if (body.method === 'tools/list') return rpc(body.id ?? null, { tools: TOOLS })
  if (body.method === 'tools/call') {
    const name = body.params?.name ?? ''
    const args = body.params?.arguments ?? {}
    const text = await callTool(db, env ?? { DB: db, LLM_PROVIDER: 'mock' }, name, args)
    return rpc(body.id ?? null, { content: [{ type: 'text', text }] })
  }
  if (body.method === 'ping') return rpc(body.id ?? null, {})
  return rpc(body.id ?? null, {})
}

async function callTool(db: D1Like, env: WorkerEnv, name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'list_inbox') return JSON.stringify(await db.prepare('SELECT id, subject, status, intent, from_email, company_name, created_at FROM inquiries ORDER BY created_at DESC LIMIT 30').bind().all())
  if (name === 'get_inquiry') return JSON.stringify(await db.prepare('SELECT * FROM inquiries WHERE id = ?').bind(args.id).first())
  if (name === 'search_kb') return JSON.stringify(searchChunks(allChunks(KB_DOCS), String(args.query ?? ''), 4).map((hit) => ({ slug: hit.slug, title: hit.title, heading: hit.heading, excerpt: hit.content.slice(0, 400) })))
  if (name === 'draft_quote') {
    const picked = pickQuote(String(args.request ?? ''))
    if (!picked.lines.length) return JSON.stringify({ error: 'quantities_missing' })
    return JSON.stringify(computeQuote({ lines: picked.lines, discountCode: picked.discountCode, taxBps: 825 }))
  }
  if (name === 'list_pending_approvals') return JSON.stringify(await db.prepare(`SELECT id, tool_name, status, created_at FROM approvals WHERE status = 'pending' ORDER BY created_at DESC`).bind().all())
  if (name === 'get_lead' || name === 'search_crm') {
    const query = `%${String(args.name ?? args.query ?? '').toLowerCase()}%`
    return JSON.stringify(await db.prepare('SELECT id, name, external_id FROM crm_companies WHERE lower(name) LIKE ?').bind(query).all())
  }
  if (name === 'list_calls') return JSON.stringify(await db.prepare('SELECT id, vapi_call_id, caller_name, company_name, status, summary, outcome, created_at FROM calls ORDER BY created_at DESC LIMIT 30').bind().all())
  if (name === 'list_outbound') {
    const email = await db.prepare(`SELECT id, to_email, subject, status, provider, error, created_at FROM outbound_messages ORDER BY created_at DESC LIMIT 30`).bind().all()
    const calls = await db.prepare(`SELECT id, phone, mode, status, created_at FROM outbound_calls ORDER BY created_at DESC LIMIT 30`).bind().all()
    return JSON.stringify({ email, calls })
  }
  if (name === 'suppress_contact') {
    return JSON.stringify(await suppressContact(db, env, { email: String(args.email ?? '') }))
  }
  if (name === 'request_callback') {
    const phone = parseE164(String(args.phone ?? ''))
    if (!phone) return JSON.stringify({ error: 'invalid phone' })
    const inquiry = await db.prepare('SELECT id, from_name, from_email, company_name, subject, suppressed_at, email_verified_at FROM inquiries WHERE id = ?').bind(args.inquiryId).first<{ id: string; from_name: string; from_email: string; company_name: string | null; subject: string; suppressed_at: number | null; email_verified_at: number | null }>()
    if (!inquiry) return JSON.stringify({ error: 'not_found' })
    if (!inquiry.email_verified_at) return JSON.stringify({ error: 'email is not verified' })
    if (inquiry.suppressed_at || await isSuppressed(db, inquiry.from_email, phone)) return JSON.stringify({ error: 'suppressed' })
    const run = await db.prepare('SELECT id FROM agent_runs WHERE inquiry_id = ? ORDER BY started_at DESC LIMIT 1').bind(inquiry.id).first<{ id: string }>()
    const runId = run?.id ?? id('run')
    if (!run) {
      await db.prepare(`INSERT INTO agent_runs (id, inquiry_id, status, provider, disposition, summary, error, started_at, finished_at) VALUES (?, ?, 'awaiting_approval', 'mcp', NULL, NULL, NULL, ?, NULL)`).bind(runId, inquiry.id, Date.now()).run()
    }
    const approvalId = id('apr')
    await db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at) VALUES (?, ?, 'request_callback', 'pending', ?, NULL, ?, NULL, ?, NULL)`,
    ).bind(approvalId, runId, JSON.stringify({ inquiryId: inquiry.id, phone, companyName: inquiry.company_name, subject: inquiry.subject }), `AI will call ${phone} about ${inquiry.subject}.`, Date.now()).run()
    await db.prepare(`INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, 'agent', 'call.requested', 'approval', ?, ?)`).bind(id('aud'), Date.now(), approvalId, JSON.stringify({ phone })).run()
    return JSON.stringify({ approvalId, status: 'pending' })
  }
  if (name === 'decide_approval') {
    if (args.decision !== 'approved' && args.decision !== 'rejected') return JSON.stringify({ error: 'decision must be approved or rejected' })
    try {
      const result = await decideApproval(db, env, {
        approvalId: String(args.id ?? ''),
        decision: args.decision,
        finalJson: typeof args.finalJson === 'string' ? args.finalJson : null,
        actor: 'mcp',
      })
      return JSON.stringify(result)
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : 'decision failed' })
    }
  }
  return JSON.stringify({ error: 'unknown_tool' })
}

function rpc(id: number | string | null, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}
