import { companyFrom } from '../../packages/core/src/compose'
import { bindDeskIds } from '../../packages/core/src/bind-ids'
import { classifyText, spamSummary } from '../../packages/core/src/classify'
import { KB_DOCS, searchChunks, allChunks } from '../../packages/core/src/kb'
import { CATALOG } from '../../packages/core/src/catalog'
import { computeQuote } from '../../packages/core/src/quote'
import { nextObligation, proposalKey, type Proposal } from '../../packages/core/src/obligations'
import { decideNext, type PolicyContext, type StepView } from '../../packages/core/src/policy'
import { MalformedModelOutput, workersAiProvider, type AiBinding } from '../../packages/core/src/workers-ai'
import { parseToolArgs, toolRequiresApproval } from '../../packages/core/src/tool-schemas'
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
      `INSERT INTO agent_steps (id, run_id, step_index, kind, tool_name, status, args_json, result_json, redacted_args_json, redacted_result_json, approval_id, created_at)
       VALUES (?, ?, 0, 'guardrail', 'classify', 'ok', NULL, ?, NULL, ?, NULL, ?)`,
    ).bind(id('stp'), runId, JSON.stringify({ intent: classification.intent, injection: classification.injection, signals: classification.signals }), JSON.stringify({ intent: classification.intent, signals: classification.signals }), Date.now()).run()
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
    const approvalId = id('apr')
    await db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES (?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, NULL)`,
    ).bind(approvalId, run.id, name, JSON.stringify(parsed.data), Date.now()).run()
    await insertStep(db, String(run.id), steps.length, name, 'pending_approval', parsed.data, null, approvalId)
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

async function insertStep(db: D1Like, runId: string, index: number, tool: string, status: string, args: unknown, result: unknown, approvalId?: string, model?: string | null): Promise<void> {
  await db.prepare(
    `INSERT INTO agent_steps (id, run_id, step_index, kind, tool_name, status, args_json, result_json, redacted_args_json, redacted_result_json, approval_id, model, created_at)
     VALUES (?, ?, ?, 'tool', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id('stp'),
    runId,
    index,
    tool,
    status,
    args === undefined ? null : JSON.stringify(args),
    result === undefined ? null : JSON.stringify(result),
    args === undefined ? null : JSON.stringify(args),
    result === undefined ? null : JSON.stringify(result),
    approvalId ?? null,
    model ?? null,
    Date.now(),
  ).run()
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
  const provider = workersAiProvider(env.AI!, { primary: env.WORKERS_AI_MODEL, fallback: env.WORKERS_AI_FALLBACK_MODEL })
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
  try {
    turn = await provider.next({ ...context(), requiredTool })
  } catch (error) {
    const summary = await recordModelFailure(db, runId, localSteps.length, error)
    return applyDeterministic(db, inquiry, runId, localSteps, obligation, summary)
  }
  if (turn.type === 'text' || (turn.type === 'tool' && toolRequiresApproval(turn.name) && !proposalNames(obligation).includes(turn.name))) {
    const raw = turn.type === 'text' ? { text: turn.text } : turn.type === 'tool' ? turn.args : null
    await insertStep(db, runId, localSteps.length, 'model_output', 'error', raw, { error: 'The model did not call the required tool.', model: turn.model ?? null }, undefined, turn.model)
    localSteps = await many(db, 'SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index', runId)
    try {
      turn = await provider.next({ ...context(), requiredTool, nudge: nudgeFor(obligation.reason) })
    } catch (error) {
      const summary = await recordModelFailure(db, runId, localSteps.length, error)
      return applyDeterministic(db, inquiry, runId, localSteps, obligation, summary)
    }
  }
  if (turn.type === 'text' || turn.type === 'final') {
    const why = (turn.type === 'text' ? turn.text : turn.summary).replace(/\s+/g, ' ').slice(0, 180)
    return applyDeterministic(db, inquiry, runId, localSteps, obligation, `${turn.model ?? 'model'}: ${why}`)
  }
  if (toolRequiresApproval(turn.name)) {
    await queueProposal(db, runId, { name: turn.name, args: turn.args }, false, turn.model)
    localSteps = await many(db, 'SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index', runId)
    const rest = nextObligation(context())
    if (rest.type === 'queue') await queueMany(db, runId, rest.proposals, true, undefined, rest.reason)
    await markAwaiting(db, runId, inquiryId)
    return { runId, status: 'awaiting_approval', inquiryId }
  }
  const result = await runFreeTool(db, inquiryId, runId, turn.name, turn.args)
  await insertStep(db, runId, localSteps.length, turn.name, 'ok', turn.args, { ...asObject(result), model: turn.model }, undefined, turn.model)
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
    await queueMany(db, runId, obligation.proposals, true, undefined, obligation.reason)
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

async function queueMany(db: D1Like, runId: string, proposals: Proposal[], fallback: boolean, model: string | undefined, reason: string): Promise<void> {
  for (const proposal of proposals) await queueProposal(db, runId, proposal, fallback, model, reason)
}

async function queueProposal(db: D1Like, runId: string, proposal: Proposal, fallback: boolean, model?: string, reason?: string): Promise<void> {
  const parsed = parseToolArgs(proposal.name, proposal.args)
  if (!parsed.ok) return
  const runRow = await one<{ inquiry_id: string }>(db, 'SELECT inquiry_id FROM agent_runs WHERE id = ?', runId)
  const quote = await one<{ id: string }>(db, 'SELECT id FROM quotes WHERE run_id = ? ORDER BY created_at DESC LIMIT 1', runId)
  const data = bindDeskIds(proposal.name, parsed.data, { inquiryId: String(runRow?.inquiry_id ?? ''), quoteId: quote?.id ?? null })
  const key = proposalKey(proposal.name, data)
  const existing = await many<{ tool_name: string; proposed_json: string }>(db, `SELECT tool_name, proposed_json FROM approvals WHERE run_id = ?`, runId)
  const duplicate = existing.some((row) => row.tool_name === proposal.name && proposalKey(row.tool_name, safeObject(row.proposed_json)) === key)
  if (duplicate) return
  const approvalId = id('apr')
  const steps = await many<{ n: number }>(db, 'SELECT count(*) AS n FROM agent_steps WHERE run_id = ?', runId)
  await db.prepare(
    `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
     VALUES (?, ?, ?, 'pending', ?, NULL, ?, NULL, ?, NULL)`,
  ).bind(approvalId, runId, proposal.name, JSON.stringify(data), fallback ? `Desk fallback. ${reason ?? ''}`.trim() : null, Date.now()).run()
  await insertStep(db, runId, Number(steps[0]?.n ?? 0), proposal.name, 'pending_approval', data, fallback ? { fallback: true, reason: reason ?? null } : null, approvalId, fallback ? null : model ?? null)
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
  const allowed = new Set(['inquiries', 'approvals', 'quotes', 'calls', 'crm_companies', 'crm_deals', 'crm_contacts', 'audit_log'])
  if (!allowed.has(table)) return []
  const rows = await many<Record<string, unknown>>(db, `SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 100`)
  return rows.map(camelRow)
}

export function camelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value
  }
  return out
}
