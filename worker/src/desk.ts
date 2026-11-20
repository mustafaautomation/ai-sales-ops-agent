import { companyFrom } from '../../packages/core/src/compose'
import { classifyText } from '../../packages/core/src/classify'
import { KB_DOCS, searchChunks, allChunks } from '../../packages/core/src/kb'
import { CATALOG } from '../../packages/core/src/catalog'
import { computeQuote } from '../../packages/core/src/quote'
import { decideNext } from '../../packages/core/src/policy'
import { workersAiProvider, type AiBinding } from '../../packages/core/src/workers-ai'
import { toolRequiresApproval, toolSchemas, type ToolName } from '../../packages/core/src/tool-schemas'
import { id } from '../../packages/core/src/ids'
import type { D1Like } from './d1'

export type WorkerEnv = {
  DB: D1Like
  AI?: AiBinding
  LLM_PROVIDER?: string
  WORKERS_AI_MODEL?: string
  WORKERS_AI_FALLBACK_MODEL?: string
  VAPI_SECRET?: string
  MCP_BEARER_TOKEN?: string
  WORKER_AUTH_TOKEN?: string
  RATE_LIMIT_SALT?: string
  EMAIL_API_URL?: string
}

async function one<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...args).first<T>()
}

async function many<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...args).all<T>()
  return result.results
}

export async function seedReference(db: D1Like): Promise<void> {
  const user = await one(db, 'SELECT id FROM users WHERE email = ?', 'amina.okonkwo@meridian-facilities.example')
  if (!user) {
    await db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      'user_amina',
      'amina.okonkwo@meridian-facilities.example',
      'Amina Okonkwo',
      'scrypt$worker$not-used-on-the-edge',
      Date.now(),
    ).run()
  }
  for (const [key, value] of [['tax_bps', '825'], ['quote_valid_days', '14'], ['quote_seq', '1000']] as const) {
    const existing = await one(db, 'SELECT key FROM settings WHERE key = ?', key)
    if (!existing) await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(key, value).run()
  }
  const docs = await one<{ n: number }>(db, 'SELECT count(*) AS n FROM kb_documents')
  if ((docs?.n ?? 0) > 0) return
  for (const doc of KB_DOCS) {
    const documentId = `kb_${doc.slug}`
    await db.prepare('INSERT INTO kb_documents (id, slug, title, body, updated_at) VALUES (?, ?, ?, ?, ?)').bind(documentId, doc.slug, doc.title, doc.body, Date.now()).run()
  }
}

export async function createInquiry(db: D1Like, input: {
  source: string
  fromName: string
  fromEmail: string
  companyName: string | null
  subject: string
  body: string
}): Promise<string> {
  const inquiryId = id('inq')
  const at = Date.now()
  await db.prepare(
    `INSERT INTO inquiries (id, source, external_id, from_name, from_email, company_name, subject, body, status, intent, injection_flag, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, 0, ?, ?)`,
  ).bind(inquiryId, input.source, `web:${inquiryId}`, input.fromName, input.fromEmail, input.companyName, input.subject, input.body, at, at).run()
  return inquiryId
}

export async function stepInquiry(db: D1Like, env: WorkerEnv, inquiryId: string): Promise<Record<string, unknown>> {
  const inquiry = await one<Record<string, string | number | null>>(db, 'SELECT * FROM inquiries WHERE id = ?', inquiryId)
  if (!inquiry) return { error: 'not_found' }
  let run = await one<Record<string, string | number | null>>(db, `SELECT * FROM agent_runs WHERE inquiry_id = ? ORDER BY started_at DESC LIMIT 1`, inquiryId)
  if (!run) {
    const classification = classifyText(`${inquiry.subject}\n${inquiry.body}`)
    const runId = id('run')
    await db.prepare(
      `INSERT INTO agent_runs (id, inquiry_id, status, provider, disposition, summary, error, started_at, finished_at)
       VALUES (?, ?, 'running', ?, NULL, NULL, NULL, ?, NULL)`,
    ).bind(runId, inquiryId, env.LLM_PROVIDER || 'mock', Date.now()).run()
    await db.prepare(
      `INSERT INTO agent_steps (id, run_id, step_index, kind, tool_name, status, args_json, result_json, redacted_args_json, redacted_result_json, approval_id, created_at)
       VALUES (?, ?, 0, 'guardrail', 'classify', 'ok', NULL, ?, NULL, ?, NULL, ?)`,
    ).bind(id('stp'), runId, JSON.stringify({ intent: classification.intent, injection: classification.injection }), JSON.stringify({ intent: classification.intent }), Date.now()).run()
    await db.prepare('UPDATE inquiries SET status = ?, intent = ?, injection_flag = ?, updated_at = ? WHERE id = ?').bind(
      classification.intent === 'spam' ? 'archived' : 'processing',
      classification.intent,
      classification.injection ? 1 : 0,
      Date.now(),
      inquiryId,
    ).run()
    if (classification.intent === 'spam') {
      await db.prepare(`UPDATE agent_runs SET status = 'completed', disposition = 'archived_spam', summary = ?, finished_at = ? WHERE id = ?`).bind('Marked as spam. No reply was drafted.', Date.now(), runId).run()
      return { runId, status: 'completed' }
    }
    run = await one(db, 'SELECT * FROM agent_runs WHERE id = ?', runId)
  }
  if (!run || run.status === 'completed' || run.status === 'awaiting_approval') return { runId: run?.id, status: run?.status }
  const steps = await many<Record<string, unknown>>(db, 'SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index', run.id)
  const provider = env.LLM_PROVIDER === 'workers-ai' && env.AI
    ? workersAiProvider(env.AI, { primary: env.WORKERS_AI_MODEL, fallback: env.WORKERS_AI_FALLBACK_MODEL })
    : { name: 'mock', next: decideNext }
  const view = {
    inquiry: {
      id: String(inquiry.id),
      source: String(inquiry.source),
      fromName: String(inquiry.from_name),
      fromEmail: String(inquiry.from_email),
      companyName: inquiry.company_name ? String(inquiry.company_name) : companyFrom({
        fromName: String(inquiry.from_name),
        fromEmail: String(inquiry.from_email),
        companyName: null,
        subject: String(inquiry.subject),
        body: String(inquiry.body),
      }),
      subject: String(inquiry.subject),
      body: String(inquiry.body),
    },
    steps: steps.filter((step) => step.kind === 'tool').map((step) => ({
      tool: step.tool_name ? String(step.tool_name) : null,
      status: String(step.status),
      result: step.result_json ? JSON.parse(String(step.result_json)) : null,
    })),
  }
  let action
  try {
    action = await provider.next(view)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'model failed'
    const prior = steps.filter((step) => step.tool_name === 'model_output' && step.status === 'error').length
    await insertStep(db, String(run.id), steps.length, 'model_output', 'error', null, { error: message })
    if (prior < 1) return { runId: run.id, status: 'running', retry: true }
    await openReview(db, String(run.id), inquiryId, steps.length + 1, message)
    return { runId: run.id, status: 'awaiting_approval' }
  }
  if (action.type === 'final') {
    await db.prepare(`UPDATE agent_runs SET status = 'completed', disposition = ?, summary = ?, finished_at = ? WHERE id = ?`).bind(action.disposition, action.summary, Date.now(), run.id).run()
    await db.prepare('UPDATE inquiries SET status = ?, updated_at = ? WHERE id = ?').bind(action.disposition === 'archived_spam' ? 'archived' : 'resolved', Date.now(), inquiryId).run()
    return { runId: run.id, status: 'completed' }
  }
  const name = action.name
  const schema = toolSchemas[name as ToolName]
  const parsed = schema.safeParse(action.args)
  if (!parsed.success) {
    const prior = steps.filter((step) => step.tool_name === 'model_output' && step.status === 'error').length
    await insertStep(db, String(run.id), steps.length, 'model_output', 'error', action.args, { error: parsed.error.message })
    if (prior < 1) return { runId: run.id, status: 'running', retry: true }
    await openReview(db, String(run.id), inquiryId, steps.length + 1, parsed.error.message)
    return { runId: run.id, status: 'awaiting_approval' }
  }
  if (toolRequiresApproval(name)) {
    const approvalId = id('apr')
    await db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES (?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, NULL)`,
    ).bind(approvalId, run.id, name, JSON.stringify(parsed.data), Date.now()).run()
    await insertStep(db, String(run.id), steps.length, name, 'pending_approval', parsed.data, null, approvalId)
    await db.prepare(`UPDATE agent_runs SET status = 'awaiting_approval' WHERE id = ?`).bind(run.id).run()
    await db.prepare(`UPDATE inquiries SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`).bind(Date.now(), inquiryId).run()
    return { runId: run.id, status: 'awaiting_approval', approvalId }
  }
  const result = await runFreeTool(db, name, parsed.data)
  await insertStep(db, String(run.id), steps.length, name, 'ok', parsed.data, result)
  return { runId: run.id, status: 'running', tool: name }
}

async function runFreeTool(db: D1Like, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'search_kb') {
    const chunks = searchChunks(allChunks(KB_DOCS), String(args.query), Number(args.limit ?? 4)).map((chunk) => ({
      slug: chunk.slug,
      title: chunk.title,
      heading: chunk.heading,
      excerpt: chunk.content.slice(0, 700),
      content: chunk.content,
      ordinal: chunk.ordinal,
    }))
    return { query: args.query, chunks }
  }
  if (name === 'get_price_list') return { currency: 'USD', items: CATALOG }
  if (name === 'crm_lookup') {
    const query = String(args.query).toLowerCase()
    const records = await many(db, `SELECT name, external_id FROM crm_companies WHERE lower(name) LIKE ?`, `%${query}%`)
    return { records }
  }
  if (name === 'draft_quote') {
    const math = computeQuote({
      lines: args.lines as { sku: string; qty: number }[],
      discountCode: (args.discountCode as string | null) ?? null,
      taxBps: 825,
    })
    const current = await one<{ value: string }>(db, `SELECT value FROM settings WHERE key = 'quote_seq'`)
    const next = Number(current?.value ?? '1000') + 1
    await db.prepare(`UPDATE settings SET value = ? WHERE key = 'quote_seq'`).bind(String(next)).run()
    const quoteId = id('quo')
    const number = `MF-${next}`
    const valid = new Date()
    valid.setUTCDate(valid.getUTCDate() + 14)
    await db.prepare(
      `INSERT INTO quotes (id, number, inquiry_id, run_id, company_name, contact_name, contact_email, discount_code, discount_bps, tax_bps, subtotal_cents, discount_cents, tax_cents, total_cents, currency, status, valid_until, notes, created_at)
       VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'draft', ?, ?, ?)`,
    ).bind(
      quoteId, number, args.companyName, args.contactName, args.contactEmail, math.discountCode, math.discountBps, math.taxBps,
      math.subtotalCents, math.discountCents, math.taxCents, math.totalCents, valid.toISOString().slice(0, 10), args.notes ?? null, Date.now(),
    ).run()
    for (const [position, line] of math.lines.entries()) {
      await db.prepare(
        `INSERT INTO quote_lines (id, quote_id, sku, description, qty, unit_price_cents, line_total_cents, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id('qli'), quoteId, line.sku, line.description, line.qty, line.unitPriceCents, line.lineTotalCents, position).run()
    }
    return { quoteId, number, validUntil: valid.toISOString().slice(0, 10), ...math }
  }
  return { ignored: true }
}

async function insertStep(db: D1Like, runId: string, index: number, tool: string, status: string, args: unknown, result: unknown, approvalId?: string): Promise<void> {
  await db.prepare(
    `INSERT INTO agent_steps (id, run_id, step_index, kind, tool_name, status, args_json, result_json, redacted_args_json, redacted_result_json, approval_id, created_at)
     VALUES (?, ?, ?, 'tool', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id('stp'), runId, index, tool, status, args ? JSON.stringify(args) : null, result ? JSON.stringify(result) : null, args ? JSON.stringify(args) : null, result ? JSON.stringify(result) : null, approvalId ?? null, Date.now()).run()
}

async function openReview(db: D1Like, runId: string, inquiryId: string, index: number, reason: string): Promise<void> {
  const approvalId = id('apr')
  const proposed = { reason, note: 'No price was invented.' }
  await db.prepare(
    `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
     VALUES (?, ?, 'human_review', 'pending', ?, NULL, ?, NULL, ?, NULL)`,
  ).bind(approvalId, runId, JSON.stringify(proposed), reason.slice(0, 500), Date.now()).run()
  await insertStep(db, runId, index, 'human_review', 'pending_approval', proposed, null, approvalId)
  await db.prepare(`UPDATE agent_runs SET status = 'awaiting_approval' WHERE id = ?`).bind(runId).run()
  await db.prepare(`UPDATE inquiries SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`).bind(Date.now(), inquiryId).run()
}

export async function listRows(db: D1Like, table: string): Promise<Record<string, unknown>[]> {
  const allowed = new Set(['inquiries', 'approvals', 'quotes', 'calls', 'crm_companies', 'crm_deals', 'audit_log'])
  if (!allowed.has(table)) return []
  const rows = await many<Record<string, unknown>>(db, `SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 100`)
  return rows.map(camelRow)
}

function camelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value
  }
  return out
}
