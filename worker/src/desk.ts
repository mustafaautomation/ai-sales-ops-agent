import { isDiscountCode } from '../../packages/core/src/catalog'
import { citedSections, companyFrom, type InquiryLike } from '../../packages/core/src/compose'
import { bindDeskIds } from '../../packages/core/src/bind-ids'
import { classifyText, spamSummary } from '../../packages/core/src/classify'
import { guardDraft, type GroundChunk } from '../../packages/core/src/ground'
import { KB_DOCS, searchChunks, allChunks } from '../../packages/core/src/kb'
import { CATALOG } from '../../packages/core/src/catalog'
import { computeQuote } from '../../packages/core/src/quote'
import { nextObligation, proposalKey, type Proposal } from '../../packages/core/src/obligations'
import { decideNext, type PolicyContext, type StepView } from '../../packages/core/src/policy'
import { deskModelProvider } from '../../packages/core/src/gemini'
import { MalformedModelOutput, type AiBinding } from '../../packages/core/src/workers-ai'
import { runProvidersLabel } from '../../packages/core/src/outbound'
import { parseToolArgs, toolRequiresApproval } from '../../packages/core/src/tool-schemas'
import { id } from '../../packages/core/src/ids'
import { stopFooter } from './outbound-flow'
import type { D1Like } from './d1'

export type WorkerEnv = {
  DB: D1Like
  AI?: AiBinding
  LLM_PROVIDER?: string
  WORKERS_AI_MODEL?: string
  WORKERS_AI_FALLBACK_MODEL?: string
  MODEL_FALLBACK_ORDER?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  GROQ_API_KEY?: string
  GROQ_MODEL?: string
  VAPI_SECRET?: string
  MCP_BEARER_TOKEN?: string
  WORKER_AUTH_TOKEN?: string
  RATE_LIMIT_SALT?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  EMAIL_REPLY_TO?: string
  OUTBOUND_EMAIL_ENABLED?: string
  OUTBOUND_CALLS_ENABLED?: string
  VAPI_PRIVATE_KEY?: string
  VAPI_ASSISTANT_ID?: string
  VAPI_PUBLIC_KEY?: string
  VAPI_OUTBOUND_PHONE_NUMBER_ID?: string
  SESSION_SECRET?: string
  PUBLIC_ORIGIN?: string
  FOLLOW_UP_AFTER_DAYS?: string
  CALL_WINDOW_TZ?: string
  now?: Date
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

export async function stepInquiry(db: D1Like, env: WorkerEnv, inquiryId: string, options?: { forceNew?: boolean }): Promise<Record<string, unknown>> {
  const inquiry = await one<Record<string, string | number | null>>(db, 'SELECT * FROM inquiries WHERE id = ?', inquiryId)
  if (!inquiry) return { error: 'not_found' }
  let run = await one<Record<string, string | number | null>>(db, `SELECT * FROM agent_runs WHERE inquiry_id = ? ORDER BY started_at DESC LIMIT 1`, inquiryId)
  if (options?.forceNew && run && run.status !== 'running' && run.status !== 'awaiting_approval') run = null
  if (!run) {
    const classification = classifyText(`${inquiry.subject}\n${inquiry.body}`)
    const runId = id('run')
    await db.prepare(
      `INSERT INTO agent_runs (id, inquiry_id, status, provider, disposition, summary, error, started_at, finished_at)
       VALUES (?, ?, 'running', ?, NULL, NULL, NULL, ?, NULL)`,
    ).bind(runId, inquiryId, env.LLM_PROVIDER || 'mock', Date.now()).run()
    await db.prepare(
      `INSERT INTO agent_steps (id, run_id, step_index, kind, tool_name, status, args_json, result_json, redacted_args_json, redacted_result_json, approval_id, created_at, started_at, finished_at)
       VALUES (?, ?, 0, 'guardrail', 'classify', 'ok', NULL, ?, NULL, ?, NULL, ?, ?, ?)`,
    ).bind(id('stp'), runId, JSON.stringify({ intent: classification.intent, injection: classification.injection, signals: classification.signals }), JSON.stringify({ intent: classification.intent, signals: classification.signals }), Date.now(), Date.now(), Date.now()).run()
    await writeAudit(db, 'inquiry.classified', 'inquiry', inquiryId, { intent: classification.intent, injection: classification.injection, signals: classification.signals })
    const closed = classification.intent === 'spam' || classification.intent === 'out_of_scope'
    await db.prepare('UPDATE inquiries SET status = ?, intent = ?, injection_flag = ?, updated_at = ? WHERE id = ?').bind(
      classification.intent === 'spam' ? 'archived' : closed ? 'resolved' : 'processing',
      classification.intent,
      classification.injection ? 1 : 0,
      Date.now(),
      inquiryId,
    ).run()
    if (closed) {
      const disposition = classification.intent === 'spam' ? 'archived_spam' : 'out_of_scope'
      const summary = classification.intent === 'spam'
        ? spamSummary(classification)
        : 'Out of scope for Meridian Facilities. No quote or customer email was drafted.'
      await db.prepare(`UPDATE agent_runs SET status = 'completed', disposition = ?, summary = ?, finished_at = ? WHERE id = ?`).bind(disposition, summary, Date.now(), runId).run()
      return { runId, status: 'completed', inquiryId }
    }
    run = await one(db, 'SELECT * FROM agent_runs WHERE id = ?', runId)
  }
  if (!run || run.status === 'completed' || run.status === 'awaiting_approval') return { runId: run?.id, status: run?.status, inquiryId }
  const steps = await many<Record<string, unknown>>(db, 'SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index', run.id)
  if (steps.some((step) => step.status === 'pending_approval')) {
    await markAwaiting(db, String(run.id), inquiryId)
    return { runId: run.id, status: 'awaiting_approval', inquiryId }
  }
  if (env.LLM_PROVIDER === 'workers-ai' && env.AI) {
    return stepWorkers(db, env, inquiry, run, steps)
  }
  if (steps.length >= 12) {
    await openReview(db, String(run.id), inquiryId, steps.length, 'The run reached the step budget before it finished.')
    return { runId: run.id, status: 'awaiting_approval', inquiryId }
  }
  const provider = { name: 'mock', next: decideNext }
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
    if (!(error instanceof MalformedModelOutput) && prior < 1) return { runId: run.id, status: 'running', retry: true, inquiryId }
    await openReview(db, String(run.id), inquiryId, steps.length + 1, message)
    return { runId: run.id, status: 'awaiting_approval', inquiryId }
  }
  if (action.type === 'text') {
    await insertStep(db, String(run.id), steps.length, 'model_output', 'error', { text: action.text }, { error: 'The model replied with text instead of a tool call.' }, undefined, action.model)
    await openReview(db, String(run.id), inquiryId, steps.length + 1, 'The model replied with text instead of a tool call.')
    return { runId: run.id, status: 'awaiting_approval', inquiryId }
  }
  if (action.type === 'final') {
    await db.prepare(`UPDATE agent_runs SET status = 'completed', disposition = ?, summary = ?, finished_at = ? WHERE id = ?`).bind(action.disposition, action.summary, Date.now(), run.id).run()
    await db.prepare('UPDATE inquiries SET status = ?, updated_at = ? WHERE id = ?').bind(action.disposition === 'archived_spam' ? 'archived' : 'resolved', Date.now(), inquiryId).run()
    return { runId: run.id, status: 'completed', inquiryId }
  }
  const name = action.name
  const parsed = parseToolArgs(name, action.args)
  if (!parsed.ok) {
    const prior = steps.filter((step) => step.tool_name === 'model_output' && step.status === 'error').length
    await insertStep(db, String(run.id), steps.length, 'model_output', 'error', action.args, { error: parsed.error })
    if (prior < 1) return { runId: run.id, status: 'running', retry: true, inquiryId }
    await openReview(db, String(run.id), inquiryId, steps.length + 1, parsed.error)
    return { runId: run.id, status: 'awaiting_approval', inquiryId }
  }
  if (toolRequiresApproval(name)) {
    const settled = await settleProposal(db, String(run.id), inquiry, name, parsed.data)
    if (settled.blocked) {
      await openReview(db, String(run.id), inquiryId, steps.length, settled.blocked)
      return { runId: run.id, status: 'awaiting_approval', inquiryId }
    }
    if (name === 'send_email') {
      settled.data.body = await stopFooter(env, inquiryId, String(inquiry.from_email), String(settled.data.body ?? ''))
    }
    const approvalId = id('apr')
    await db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES (?, ?, ?, 'pending', ?, NULL, ?, NULL, ?, NULL)`,
    ).bind(approvalId, run.id, name, JSON.stringify(settled.data), settled.note, Date.now()).run()
    await writeAudit(db, 'approval.requested', 'approval', approvalId, { tool: name, runId: run.id })
    await insertStep(db, String(run.id), steps.length, name, 'pending_approval', settled.data, null, approvalId)
    await db.prepare(`UPDATE agent_runs SET status = 'awaiting_approval' WHERE id = ?`).bind(run.id).run()
    await db.prepare(`UPDATE inquiries SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`).bind(Date.now(), inquiryId).run()
    return { runId: run.id, status: 'awaiting_approval', approvalId, inquiryId }
  }
  const result = await runFreeTool(db, String(inquiry.id), String(run.id), name, parsed.data)
  await insertStep(db, String(run.id), steps.length, name, 'ok', parsed.data, result)
  return { runId: run.id, status: 'running', tool: name, inquiryId }
}

export async function driveInquiry(db: D1Like, env: WorkerEnv, inquiryId: string, budget = 8, options?: { forceNew?: boolean }): Promise<Record<string, unknown>> {
  const claimed = await claimDrive(db, inquiryId)
  if (!claimed) {
    const run = await one<{ id: string; status: string }>(db, `SELECT id, status FROM agent_runs WHERE inquiry_id = ? ORDER BY started_at DESC LIMIT 1`, inquiryId)
    return { runId: run?.id ?? null, status: run?.status ?? 'running', busy: true, inquiryId }
  }
  try {
    let last: Record<string, unknown> = { status: 'running', inquiryId }
    for (let index = 0; index < budget; index += 1) {
      last = await stepInquiry(db, env, inquiryId, index === 0 ? options : undefined)
      if (last.status !== 'running') break
    }
    return last
  } finally {
    await releaseDrive(db, inquiryId)
  }
}

export async function syncOpen(db: D1Like, env: WorkerEnv): Promise<{ continued: number }> {
  const rows = await many<{ id: string }>(db, `SELECT id FROM inquiries WHERE status IN ('new', 'processing') LIMIT 20`)
  for (const row of rows) await driveInquiry(db, env, row.id, 6)
  return { continued: rows.length }
}

async function claimDrive(db: D1Like, inquiryId: string): Promise<boolean> {
  const key = `drive:${inquiryId}`
  const existing = await one<{ created_at: number }>(db, 'SELECT created_at FROM idempotency_keys WHERE key = ?', key)
  if (existing && Date.now() - existing.created_at < 60_000) return false
  if (existing) await db.prepare('DELETE FROM idempotency_keys WHERE key = ?').bind(key).run()
  try {
    await db.prepare(`INSERT INTO idempotency_keys (key, scope, response_json, created_at) VALUES (?, 'drive', '{}', ?)`).bind(key, Date.now()).run()
    return true
  } catch {
    return false
  }
}

async function releaseDrive(db: D1Like, inquiryId: string): Promise<void> {
  await db.prepare('DELETE FROM idempotency_keys WHERE key = ?').bind(`drive:${inquiryId}`).run()
}

async function settingNumber(db: D1Like, key: string, fallback: number): Promise<number> {
  const row = await one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key)
  const parsed = Number(row?.value ?? fallback)
  return Number.isInteger(parsed) ? parsed : fallback
}

async function runFreeTool(db: D1Like, inquiryId: string, runId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'search_kb') {
    const ranked = citedSections(String(args.query), Number(args.limit ?? 4))
    const chunks = (ranked.length > 0 ? ranked : searchChunks(allChunks(KB_DOCS), String(args.query), Number(args.limit ?? 4))).map((chunk) => ({
      slug: chunk.slug,
      title: chunk.title,
      heading: chunk.heading,
      excerpt: (chunk.content ?? '').slice(0, 700),
      content: chunk.content ?? '',
      ordinal: 'ordinal' in chunk ? chunk.ordinal : 0,
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
    const taxBps = await settingNumber(db, 'tax_bps', 825)
    const days = await settingNumber(db, 'quote_valid_days', 14)
    const math = computeQuote({
      lines: args.lines as { sku: string; qty: number }[],
      discountCode: (args.discountCode as string | null) ?? null,
      taxBps,
    })
    const current = await one<{ value: string }>(db, `SELECT value FROM settings WHERE key = 'quote_seq'`)
    const next = Number(current?.value ?? '1000') + 1
    if (current) await db.prepare(`UPDATE settings SET value = ? WHERE key = 'quote_seq'`).bind(String(next)).run()
    else await db.prepare(`INSERT INTO settings (key, value) VALUES ('quote_seq', ?)`).bind(String(next)).run()
    const quoteId = id('quo')
    const number = `MF-${next}`
    const valid = new Date()
    valid.setUTCDate(valid.getUTCDate() + days)
    await db.prepare(
      `INSERT INTO quotes (id, number, inquiry_id, run_id, company_name, contact_name, contact_email, discount_code, discount_bps, tax_bps, subtotal_cents, discount_cents, tax_cents, total_cents, currency, status, valid_until, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'draft', ?, ?, ?)`,
    ).bind(
      quoteId, number, inquiryId, runId, args.companyName, args.contactName, args.contactEmail, math.discountCode, math.discountBps, math.taxBps,
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

function jsonOrNull(value: unknown): string | null {
  // Never store the JSON literal "null" — readers parse that to null and crash on property access.
  if (value == null) return null
  return JSON.stringify(value)
}

async function insertStep(db: D1Like, runId: string, index: number, tool: string, status: string, args: unknown, result: unknown, approvalId?: string, model?: string | null, startedAt?: number): Promise<void> {
  const finished = Date.now()
  const argsJson = jsonOrNull(args)
  const resultJson = jsonOrNull(result)
  await db.prepare(
    `INSERT INTO agent_steps (id, run_id, step_index, kind, tool_name, status, args_json, result_json, redacted_args_json, redacted_result_json, approval_id, model, created_at, started_at, finished_at)
     VALUES (?, ?, ?, 'tool', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id('stp'),
    runId,
    index,
    tool,
    status,
    argsJson,
    resultJson,
    argsJson,
    resultJson,
    approvalId ?? null,
    model ?? null,
    finished,
    startedAt ?? finished,
    finished,
  ).run()
  if (model) await touchRunProviders(db, runId)
}

async function touchRunProviders(db: D1Like, runId: string): Promise<void> {
  const steps = await many<{ model: string | null }>(db, 'SELECT model FROM agent_steps WHERE run_id = ? ORDER BY step_index', runId)
  const label = runProvidersLabel(steps.map((step) => step.model))
  await db.prepare('UPDATE agent_runs SET provider = ? WHERE id = ?').bind(label, runId).run()
}

function viewSteps(rows: Record<string, unknown>[]): StepView[] {
  return rows.filter((step) => step.kind === 'tool' || step.tool_name).map((step) => ({
    id: step.id ? String(step.id) : undefined,
    tool: step.tool_name ? String(step.tool_name) : null,
    status: String(step.status),
    args: step.args_json ? JSON.parse(String(step.args_json)) : undefined,
    result: step.result_json ? JSON.parse(String(step.result_json)) : null,
  }))
}

function inquiryView(inquiry: Record<string, string | number | null>): PolicyContext['inquiry'] {
  return {
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
  }
}

async function markAwaiting(db: D1Like, runId: string, inquiryId: string): Promise<void> {
  await db.prepare(`UPDATE agent_runs SET status = 'awaiting_approval', disposition = NULL, finished_at = NULL WHERE id = ?`).bind(runId).run()
  await db.prepare(`UPDATE inquiries SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`).bind(Date.now(), inquiryId).run()
}

async function finishRun(db: D1Like, runId: string, inquiryId: string, disposition: string, summary: string): Promise<Record<string, unknown>> {
  const pending = await one<{ n: number }>(db, `SELECT count(*) AS n FROM approvals WHERE run_id = ? AND status = 'pending'`, runId)
  if ((pending?.n ?? 0) > 0) {
    await markAwaiting(db, runId, inquiryId)
    return { runId, status: 'awaiting_approval', inquiryId }
  }
  await db.prepare(`UPDATE agent_runs SET status = 'completed', disposition = ?, summary = ?, finished_at = ? WHERE id = ?`).bind(disposition, summary, Date.now(), runId).run()
  const inquiryStatus = disposition === 'archived_spam' ? 'archived' : disposition === 'failed' ? 'failed' : 'resolved'
  await db.prepare('UPDATE inquiries SET status = ?, updated_at = ? WHERE id = ?').bind(inquiryStatus, Date.now(), inquiryId).run()
  return { runId, status: 'completed', inquiryId }
}

async function stepWorkers(
  db: D1Like,
  env: WorkerEnv,
  inquiry: Record<string, string | number | null>,
  run: Record<string, string | number | null>,
  steps: Record<string, unknown>[],
): Promise<Record<string, unknown>> {
  const inquiryId = String(inquiry.id)
  const runId = String(run.id)
  const provider = deskAi(env)
  let localSteps = steps
  const context = (): PolicyContext => ({ inquiry: inquiryView(inquiry), steps: viewSteps(localSteps) })
  const obligation = nextObligation(context())
  if (obligation.type === 'stop') return finishRun(db, runId, inquiryId, obligation.disposition, obligation.summary)
  if (obligation.type === 'done') return finishRun(db, runId, inquiryId, 'completed', obligation.summary)
  if (obligation.type === 'wait') {
    await markAwaiting(db, runId, inquiryId)
    return { runId, status: 'awaiting_approval', inquiryId }
  }
  const requiredTool = obligation.type === 'act' ? obligation.name : obligation.proposals[0]?.name
  const nudgeFor = (reason: string) => `${reason} Call only ${requiredTool}. Do not describe the call.`
  let turn
  let modelStarted = Date.now()
  try {
    turn = await provider.next({ ...context(), requiredTool })
  } catch (error) {
    const summary = await recordModelFailure(db, runId, localSteps.length, error)
    return applyDeterministic(db, inquiry, runId, localSteps, obligation, summary, env)
  }
  if (turn.type === 'text' || (turn.type === 'tool' && toolRequiresApproval(turn.name) && !proposalNames(obligation).includes(turn.name))) {
    const raw = turn.type === 'text' ? { text: turn.text } : turn.type === 'tool' ? turn.args : null
    await insertStep(db, runId, localSteps.length, 'model_output', 'error', raw, {
      error: 'The model did not call the required tool.',
      model: turn.model ?? null,
      attempts: turn.attempts ?? [],
    }, undefined, turn.model, modelStarted)
    localSteps = await many(db, 'SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index', runId)
    modelStarted = Date.now()
    try {
      turn = await provider.next({ ...context(), requiredTool, nudge: nudgeFor(obligation.reason) })
    } catch (error) {
      const summary = await recordModelFailure(db, runId, localSteps.length, error)
      return applyDeterministic(db, inquiry, runId, localSteps, obligation, summary, env)
    }
  }
  if (turn.type === 'text' || turn.type === 'final') {
    const why = (turn.type === 'text' ? turn.text : turn.summary).replace(/\s+/g, ' ').slice(0, 180)
    return applyDeterministic(db, inquiry, runId, localSteps, obligation, `${turn.model ?? 'model'}: ${why}`, env)
  }
  if (toolRequiresApproval(turn.name)) {
    const outcome = await queueProposal(db, runId, { name: turn.name, args: turn.args }, false, turn.model, undefined, turn.attempts, modelStarted, env)
    if (outcome === 'blocked') {
      await markAwaiting(db, runId, inquiryId)
      return { runId, status: 'awaiting_approval', inquiryId }
    }
    localSteps = await many(db, 'SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index', runId)
    const rest = nextObligation(context())
    if (rest.type === 'queue') {
      const letters = rest.proposals.filter((proposal) => proposal.name === 'send_email')
      const other = rest.proposals.filter((proposal) => proposal.name !== 'send_email')
      if (other.length > 0) await queueMany(db, runId, other, true, undefined, rest.reason, env)
      if (letters.length > 0) {
        const retry = await retrySendEmail(db, env, inquiry, runId, localSteps, rest.reason)
        if (!retry.ok) {
          const count = Number((await many<{ n: number }>(db, 'SELECT count(*) AS n FROM agent_steps WHERE run_id = ?', runId))[0]?.n ?? 0)
          await openReview(db, runId, inquiryId, count, emailReviewReason(retry.reason ?? rest.reason))
          return { runId, status: 'awaiting_approval', inquiryId }
        }
      }
    }
    await markAwaiting(db, runId, inquiryId)
    return { runId, status: 'awaiting_approval', inquiryId }
  }
  const result = await runFreeTool(db, inquiryId, runId, turn.name, turn.args)
  await insertStep(db, runId, localSteps.length, turn.name, 'ok', turn.args, {
    ...asObject(result),
    model: turn.model,
    ...(turn.attempts?.length ? { attempts: turn.attempts } : {}),
  }, undefined, turn.model, modelStarted)
  return { runId, status: 'running', tool: turn.name, inquiryId }
}

function proposalNames(obligation: ReturnType<typeof nextObligation>): string[] {
  return obligation.type === 'queue' ? obligation.proposals.map((proposal) => proposal.name) : obligation.type === 'act' ? [obligation.name] : []
}

async function applyDeterministic(
  db: D1Like,
  inquiry: Record<string, string | number | null>,
  runId: string,
  steps: Record<string, unknown>[],
  obligation: ReturnType<typeof nextObligation>,
  reason: string,
  env: WorkerEnv,
): Promise<Record<string, unknown>> {
  const inquiryId = String(inquiry.id)
  if (obligation.type === 'stop') return finishRun(db, runId, inquiryId, obligation.disposition, obligation.summary)
  if (obligation.type === 'done') return finishRun(db, runId, inquiryId, 'completed', obligation.summary)
  if (obligation.type === 'wait') {
    await markAwaiting(db, runId, inquiryId)
    return { runId, status: 'awaiting_approval', inquiryId }
  }
  await insertStep(db, runId, steps.length, 'desk_fallback', 'ok', { obligation: obligation.type }, {
    fallback: true,
    reason,
  }, undefined, null)
  if (obligation.type === 'queue') {
    const letters = obligation.proposals.filter((proposal) => proposal.name === 'send_email')
    const other = obligation.proposals.filter((proposal) => proposal.name !== 'send_email')
    if (other.length > 0) await queueMany(db, runId, other, true, undefined, obligation.reason, env)
    if (letters.length > 0) {
      const retry = await retrySendEmail(db, env, inquiry, runId, steps, obligation.reason)
      if (!retry.ok) {
        const count = Number((await many<{ n: number }>(db, 'SELECT count(*) AS n FROM agent_steps WHERE run_id = ?', runId))[0]?.n ?? 0)
        await openReview(db, runId, inquiryId, count, emailReviewReason(retry.reason ?? reason))
      } else {
        await markAwaiting(db, runId, inquiryId)
      }
    } else {
      await markAwaiting(db, runId, inquiryId)
    }
    return { runId, status: 'awaiting_approval', inquiryId }
  }
  if (obligation.name === 'send_email') {
    const retry = await retrySendEmail(db, env, inquiry, runId, steps, reason)
    if (!retry.ok) {
      await openReview(db, runId, inquiryId, steps.length + 1, emailReviewReason(retry.reason ?? reason))
      return { runId, status: 'awaiting_approval', inquiryId }
    }
    await markAwaiting(db, runId, inquiryId)
    return { runId, status: 'awaiting_approval', inquiryId }
  }
  const parsed = parseToolArgs(obligation.name, obligation.args)
  if (!parsed.ok) {
    await openReview(db, runId, inquiryId, steps.length + 1, parsed.error)
    return { runId, status: 'awaiting_approval', inquiryId }
  }
  const result = await runFreeTool(db, inquiryId, runId, obligation.name, parsed.data)
  await insertStep(db, runId, steps.length + 1, obligation.name, 'ok', parsed.data, { ...asObject(result), fallback: true }, undefined, null)
  return { runId, status: 'running', tool: obligation.name, inquiryId }
}

/** One more model turn for send_email. Never invent a customer body from desk rules. */
async function retrySendEmail(
  db: D1Like,
  env: WorkerEnv,
  inquiry: Record<string, string | number | null>,
  runId: string,
  steps: Record<string, unknown>[],
  reason: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!(env.LLM_PROVIDER === 'workers-ai' && env.AI)) return { ok: false }
  const provider = deskAi(env)
  const context: PolicyContext = { inquiry: inquiryView(inquiry), steps: viewSteps(steps) }
  const started = Date.now()
  try {
    const turn = await provider.next({ ...context, requiredTool: 'send_email', nudge: `${reason} Call only send_email. Do not describe the call.` })
    if (turn.type !== 'tool' || turn.name !== 'send_email') {
      await insertStep(db, runId, steps.length, 'model_output', 'error', turn.type === 'text' ? { text: turn.text } : turn.type === 'final' ? { summary: turn.summary } : null, {
        error: 'The model did not write the email on retry.',
        model: turn.model ?? null,
      }, undefined, turn.model, started)
      return { ok: false }
    }
    const outcome = await queueProposal(db, runId, { name: turn.name, args: turn.args }, false, turn.model, undefined, turn.attempts, started, env)
    return { ok: outcome === 'stored' || outcome === 'duplicate' }
  } catch (error) {
    const summary = await recordModelFailure(db, runId, steps.length, error)
    return { ok: false, reason: summary }
  }
}

async function queueMany(db: D1Like, runId: string, proposals: Proposal[], fallback: boolean, model: string | undefined, reason: string, env: WorkerEnv): Promise<void> {
  for (const proposal of proposals) {
    if (fallback && proposal.name === 'send_email') continue
    const outcome = await queueProposal(db, runId, proposal, fallback, model, reason, undefined, undefined, env)
    if (outcome === 'blocked') return
  }
}

async function queueProposal(
  db: D1Like,
  runId: string,
  proposal: Proposal,
  fallback: boolean,
  model?: string,
  reason?: string,
  attempts?: { model: string; outcome: string; reason: string }[],
  startedAt?: number,
  env?: WorkerEnv,
): Promise<'stored' | 'duplicate' | 'blocked' | 'invalid'> {
  const parsed = parseToolArgs(proposal.name, proposal.args)
  if (!parsed.ok) return 'invalid'
  const runRow = await one<{ inquiry_id: string }>(db, 'SELECT inquiry_id FROM agent_runs WHERE id = ?', runId)
  const quote = await one<{ id: string }>(db, 'SELECT id FROM quotes WHERE run_id = ? ORDER BY created_at DESC LIMIT 1', runId)
  const inquiry = runRow ? await one<Record<string, string | number | null>>(db, 'SELECT * FROM inquiries WHERE id = ?', runRow.inquiry_id) : null
  let data = bindDeskIds(proposal.name, parsed.data, { inquiryId: String(runRow?.inquiry_id ?? ''), quoteId: quote?.id ?? null })
  const settled = inquiry ? await settleProposal(db, runId, inquiry, proposal.name, data) : { data, note: null as string | null, blocked: null as string | null }
  if (settled.blocked) {
    await openReview(db, runId, String(runRow?.inquiry_id ?? ''), Number((await many<{ n: number }>(db, 'SELECT count(*) AS n FROM agent_steps WHERE run_id = ?', runId))[0]?.n ?? 0), settled.blocked)
    return 'blocked'
  }
  data = settled.data
  // Rule-based fallback must never invent or store a customer email body.
  if (fallback && proposal.name === 'send_email') return 'invalid'
  if (proposal.name === 'send_email' && inquiry) {
    data.body = await stopFooter(env ?? { DB: db }, String(inquiry.id), String(inquiry.from_email), String(data.body ?? ''))
  }
  const key = proposalKey(proposal.name, data)
  const existing = await many<{ tool_name: string; proposed_json: string }>(db, `SELECT tool_name, proposed_json FROM approvals WHERE run_id = ?`, runId)
  const duplicate = existing.some((row) => row.tool_name === proposal.name && proposalKey(row.tool_name, safeObject(row.proposed_json)) === key)
  if (duplicate) return 'duplicate'
  const approvalId = id('apr')
  const steps = await many<{ n: number }>(db, 'SELECT count(*) AS n FROM agent_steps WHERE run_id = ?', runId)
  const note = [fallback ? `Desk fallback. ${reason ?? ''}`.trim() : null, settled.note].filter(Boolean).join(' ') || null
  const recorded = {
    ...(fallback ? { fallback: true, reason: reason ?? null } : {}),
    ...(attempts?.length ? { attempts } : {}),
  }
  await db.prepare(
    `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
     VALUES (?, ?, ?, 'pending', ?, NULL, ?, NULL, ?, NULL)`,
  ).bind(approvalId, runId, proposal.name, JSON.stringify(data), note, Date.now()).run()
  await writeAudit(db, 'approval.requested', 'approval', approvalId, { tool: proposal.name, runId })
  await insertStep(
    db,
    runId,
    Number(steps[0]?.n ?? 0),
    proposal.name,
    'pending_approval',
    data,
    Object.keys(recorded).length > 0 ? recorded : null,
    approvalId,
    fallback ? null : model ?? null,
    startedAt,
  )
  return 'stored'
}

function safeObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value }
}

async function recordModelFailure(db: D1Like, runId: string, index: number, error: unknown): Promise<string> {
  const attempts = error instanceof MalformedModelOutput ? error.attempts : []
  const summary = (error instanceof Error ? error.message : 'model failed').replace(/\s+/g, ' ').slice(0, 500)
  if (attempts.length === 0) {
    await insertStep(db, runId, index, 'model_output', 'error', null, { error: summary.slice(0, 180) })
  } else {
    for (const [offset, attempt] of attempts.entries()) {
      await insertStep(db, runId, index + offset, 'model_output', 'error', null, {
        error: attempt.error,
        code: attempt.code,
        model: attempt.model,
      }, undefined, attempt.model)
    }
  }
  await db.prepare(`UPDATE agent_runs SET error = ? WHERE id = ?`).bind(summary, runId).run()
  return summary
}

export function humanReviewReason(reason: string): string {
  // Workers AI neuron quota only — not Groq/Gemini HTTP 429s.
  if (/\b4006\b/.test(reason) || /daily neuron/i.test(reason)) {
    return 'AI daily limit reached, resets 08:00 MYT. No customer email was drafted. Retry after the reset or draft by hand.'
  }
  if (/\b429\b/.test(reason) || /rate limited/i.test(reason)) {
    if (/groq/i.test(reason)) return 'Groq rate limited. No customer email was drafted. Retry later or draft by hand.'
    if (/gemini/i.test(reason)) return 'Gemini rate limited. No customer email was drafted. Retry later or draft by hand.'
    return 'A model provider was rate limited. No customer email was drafted. Retry later or draft by hand.'
  }
  return reason
}

function emailReviewReason(reason: string): string {
  if (/\b4006\b/.test(reason) || /daily neuron/i.test(reason)) return reason
  if (/\b429\b/.test(reason) || /rate limited/i.test(reason)) return humanReviewReason(reason)
  return 'The model did not write this email. Retry the run or draft it by hand. No customer body was saved.'
}

function deskAi(env: WorkerEnv) {
  return deskModelProvider({
    ai: env.AI!,
    primary: env.WORKERS_AI_MODEL,
    fallback: env.WORKERS_AI_FALLBACK_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL,
    fallbackOrder: env.MODEL_FALLBACK_ORDER,
  })
}

async function openReview(db: D1Like, runId: string, inquiryId: string, index: number, reason: string): Promise<void> {
  const approvalId = id('apr')
  const note = humanReviewReason(reason)
  const proposed = { reason: note, note: 'No price was invented.' }
  await db.prepare(
    `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
     VALUES (?, ?, 'human_review', 'pending', ?, NULL, ?, NULL, ?, NULL)`,
  ).bind(approvalId, runId, JSON.stringify(proposed), note.slice(0, 500), Date.now()).run()
  await insertStep(db, runId, index, 'human_review', 'pending_approval', proposed, undefined, approvalId)
  await writeAudit(db, 'approval.requested', 'approval', approvalId, { tool: 'human_review', runId, reason: note })
  await db.prepare(`UPDATE agent_runs SET status = 'awaiting_approval' WHERE id = ?`).bind(runId).run()
  await db.prepare(`UPDATE inquiries SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`).bind(Date.now(), inquiryId).run()
}

const LIST_ORDER: Record<string, string> = {
  inquiries: 'created_at DESC, rowid DESC',
  approvals: 'created_at DESC, rowid DESC',
  quotes: 'created_at DESC, rowid DESC',
  calls: 'created_at DESC, rowid DESC',
  crm_companies: 'name ASC',
  crm_deals: 'updated_at DESC, rowid DESC',
  crm_contacts: 'created_at DESC, rowid DESC',
  audit_log: 'at DESC, rowid DESC',
}

export async function listRows(db: D1Like, table: string): Promise<Record<string, unknown>[]> {
  const order = LIST_ORDER[table]
  if (!order) return []
  const rows = await many<Record<string, unknown>>(db, `SELECT * FROM ${table} ORDER BY ${order} LIMIT 100`)
  return rows.map(camelRow)
}

async function writeAudit(db: D1Like, action: string, entityType: string, entityId: string, detail: unknown): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, 'agent', ?, ?, ?, ?)`,
  ).bind(id('aud'), Date.now(), action, entityType, entityId, JSON.stringify(detail)).run()
}

async function settleProposal(
  db: D1Like,
  runId: string,
  inquiry: Record<string, string | number | null>,
  tool: string,
  data: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; note: string | null; blocked: string | null }> {
  if (tool === 'crm_upsert' && data.quoteId) {
    return { data: { ...data, stage: 'proposal' }, note: null, blocked: null }
  }
  if (tool !== 'send_email') return { data, note: null, blocked: null }
  const purpose = String(data.purpose ?? 'answer')
  const guarded = guardDraft({
    inquiry: inquiryLike(inquiry),
    body: String(data.body ?? ''),
    purpose,
    chunks: await retrievedChunks(db, runId),
    quote: await quoteForDraft(db, runId, data.quoteId),
    structured: purpose === 'quote' ? data : null,
  })
  if (guarded.blocked) return { data, note: null, blocked: guarded.blocked }
  const next: Record<string, unknown> = { ...data, body: guarded.body }
  if (purpose === 'quote') {
    delete next.opening
    delete next.answers
    delete next.closing
  }
  return { data: next, note: guarded.note, blocked: null }
}

function inquiryLike(inquiry: Record<string, string | number | null>): InquiryLike {
  return {
    fromName: String(inquiry.from_name ?? ''),
    fromEmail: String(inquiry.from_email ?? ''),
    companyName: inquiry.company_name ? String(inquiry.company_name) : null,
    subject: String(inquiry.subject ?? ''),
    body: String(inquiry.body ?? ''),
  }
}

async function retrievedChunks(db: D1Like, runId: string): Promise<GroundChunk[]> {
  const step = await one<{ result_json: string | null }>(
    db,
    `SELECT result_json FROM agent_steps WHERE run_id = ? AND tool_name = 'search_kb' AND status = 'ok' ORDER BY step_index DESC LIMIT 1`,
    runId,
  )
  if (!step?.result_json) return []
  try {
    const parsed = JSON.parse(step.result_json) as { chunks?: GroundChunk[] }
    return parsed.chunks ?? []
  } catch {
    return []
  }
}

async function quoteForDraft(db: D1Like, runId: string, quoteId: unknown) {
  const idValue = typeof quoteId === 'string' && quoteId ? quoteId : null
  const quote = idValue
    ? await one<Record<string, string | number | null>>(db, 'SELECT * FROM quotes WHERE id = ?', idValue)
    : await one<Record<string, string | number | null>>(db, 'SELECT * FROM quotes WHERE run_id = ? ORDER BY created_at DESC LIMIT 1', runId)
  if (!quote) return null
  const lines = await many<Record<string, string | number | null>>(db, 'SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY position', quote.id)
  const code = quote.discount_code ? String(quote.discount_code) : null
  return {
    number: String(quote.number),
    validUntil: String(quote.valid_until),
    lines: lines.map((line) => ({
      sku: String(line.sku),
      description: String(line.description),
      unit: 'each',
      qty: Number(line.qty),
      unitPriceCents: Number(line.unit_price_cents),
      lineTotalCents: Number(line.line_total_cents),
    })),
    discountCode: isDiscountCode(code) ? code : null,
    discountBps: Number(quote.discount_bps),
    discountCents: Number(quote.discount_cents),
    taxBps: Number(quote.tax_bps),
    subtotalCents: Number(quote.subtotal_cents),
    taxCents: Number(quote.tax_cents),
    totalCents: Number(quote.total_cents),
    currency: 'USD' as const,
  }
}

export function camelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value
  }
  return out
}
