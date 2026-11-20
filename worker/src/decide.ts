import { bindDeskIds } from '../../packages/core/src/bind-ids'
import { externalKey, id, slug } from '../../packages/core/src/ids'
import { quoteEmailSubject } from '../../packages/core/src/quote-email'
import { redactValue } from '../../packages/core/src/redact'
import { parseToolArgs } from '../../packages/core/src/tool-schemas'
import type { D1Like } from './d1'
import { driveInquiry, type WorkerEnv } from './desk'
import { writeAuditRow } from './audit'
import { deliverApprovedEmail, placeCallback } from './outbound-flow'

type Row = Record<string, string | number | null>

async function one<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...args).first<T>()
}

export async function decideApproval(
  db: D1Like,
  env: WorkerEnv,
  input: { approvalId: string; decision: 'approved' | 'rejected'; finalJson?: string | null; actor: string },
): Promise<Record<string, unknown>> {
  const approval = await one<Row>(db, 'SELECT * FROM approvals WHERE id = ?', input.approvalId)
  if (!approval) throw new Error('Approval was not found.')
  if (approval.status !== 'pending') throw new Error('This approval is no longer pending.')
  const run = await one<Row>(db, 'SELECT * FROM agent_runs WHERE id = ?', approval.run_id)
  const inquiry = run ? await one<Row>(db, 'SELECT * FROM inquiries WHERE id = ?', run.inquiry_id) : null

  if (approval.tool_name === 'human_review') {
    await claim(db, input.approvalId)
    const at = Date.now()
    const closed = input.decision === 'rejected'
    const summary = closed ? 'An operator closed the review.' : 'An operator accepted the review. No customer message was sent.'
    await db.prepare(`UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, final_json = ? WHERE id = ?`).bind(
      closed ? 'rejected' : 'executed', input.actor, at, approval.proposed_json, input.approvalId,
    ).run()
    if (run) {
      await db.prepare(`UPDATE agent_runs SET status = 'completed', disposition = 'human_review', summary = ?, finished_at = ? WHERE id = ?`).bind(summary, at, run.id).run()
      await db.prepare(`UPDATE inquiries SET status = 'resolved', updated_at = ? WHERE id = ?`).bind(at, run.inquiry_id).run()
    }
    await audit(db, input.actor, closed ? 'approval.rejected' : 'approval.approved', input.approvalId, { tool: 'human_review' })
    return { runId: run?.id ?? null, status: 'completed', approvalId: input.approvalId }
  }

  if (input.decision === 'rejected') {
    await claim(db, input.approvalId)
    const at = Date.now()
    await db.prepare(`UPDATE approvals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?`).bind(input.actor, at, input.approvalId).run()
    await db.prepare(`UPDATE agent_steps SET status = 'rejected' WHERE approval_id = ?`).bind(input.approvalId).run()
    const proposed = safeJson(approval.proposed_json)
    if (approval.tool_name === 'send_email' && proposed.quoteId) {
      await db.prepare(`UPDATE quotes SET status = 'void' WHERE id = ?`).bind(proposed.quoteId).run()
    }
    await audit(db, input.actor, 'approval.rejected', input.approvalId, { tool: approval.tool_name })
    if (!run || !inquiry) return { runId: run?.id ?? null, status: 'rejected', approvalId: input.approvalId }
    if (await pendingCount(db, String(run.id)) > 0) {
      await holdForApprovals(db, String(run.id), String(inquiry.id))
      return { runId: run.id, status: 'awaiting_approval', approvalId: input.approvalId }
    }
    const atDone = Date.now()
    await db.prepare(`UPDATE agent_runs SET status = 'completed', disposition = 'approval_rejected', summary = ?, finished_at = ? WHERE id = ?`).bind(
      'An operator rejected a proposed action. Nothing further was sent.', atDone, run.id,
    ).run()
    await db.prepare(`UPDATE inquiries SET status = 'resolved', updated_at = ? WHERE id = ?`).bind(atDone, inquiry.id).run()
    return { runId: run.id, status: 'completed', approvalId: input.approvalId }
  }

  const raw = input.finalJson?.trim() ? input.finalJson : String(approval.proposed_json)
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new Error('The edited payload is invalid.')
  }
  const parsed = parseToolArgs(String(approval.tool_name), decoded)
  if (!parsed.ok) throw new Error(parsed.error)
  const proposed = parseToolArgs(String(approval.tool_name), safeJson(approval.proposed_json))
  // Compare before reattaching the real unsubscribe token.
  const operatorOverride = !proposed.ok || JSON.stringify(parsed.data) !== JSON.stringify(proposed.data)
  await claim(db, input.approvalId)
  try {
    const quote = run ? await one<{ id: string }>(db, 'SELECT id FROM quotes WHERE run_id = ? ORDER BY created_at DESC LIMIT 1', run.id) : null
    let bound = bindDeskIds(String(approval.tool_name), parsed.data, {
      inquiryId: String(inquiry?.id ?? ''),
      quoteId: quote?.id ?? null,
    })
    if (String(approval.tool_name) === 'send_email' && String(bound.purpose ?? '') === 'quote' && quote) {
      const detail = await one<Record<string, string | number | null>>(db, 'SELECT * FROM quotes WHERE id = ?', quote.id)
      const lines = detail
        ? await db.prepare('SELECT description FROM quote_lines WHERE quote_id = ? ORDER BY position').bind(quote.id).all<{ description: string }>()
        : { results: [] as { description: string }[] }
      if (detail) {
        bound = {
          ...bound,
          subject: quoteEmailSubject(
            { number: String(detail.number), lines: (lines.results ?? []).map((line) => ({ description: line.description })) },
            String(bound.subject ?? ''),
          ),
        }
      }
    }
    const result = await execute(db, env, String(approval.tool_name), bound, inquiry, input.approvalId)
    if (
      String(approval.tool_name) === 'send_email'
      && result
      && typeof result === 'object'
      && typeof (result as { body?: unknown }).body === 'string'
    ) {
      bound = { ...bound, body: (result as { body: string }).body }
    }
    const at = Date.now()
    const prior = await one<{ result_json: string | null }>(db, 'SELECT result_json FROM agent_steps WHERE approval_id = ?', input.approvalId)
    const stored = preserveStepMarkers(result, prior?.result_json ?? null)
    await db.prepare(`UPDATE approvals SET status = 'executed', final_json = ?, decided_by = ?, decided_at = ? WHERE id = ?`).bind(
      JSON.stringify(bound), input.actor, at, input.approvalId,
    ).run()
    await db.prepare(
      `UPDATE agent_steps SET status = 'ok', args_json = ?, result_json = ?, redacted_args_json = ?, redacted_result_json = ? WHERE approval_id = ?`,
    ).bind(
      JSON.stringify(bound),
      JSON.stringify(stored),
      JSON.stringify(redactValue(bound)),
      JSON.stringify(redactValue(stored)),
      input.approvalId,
    ).run()
    await audit(db, input.actor, operatorOverride ? 'approval.edited' : 'approval.approved', input.approvalId, { tool: approval.tool_name, sandbox: true })
    if (!run || !inquiry) return { runId: run?.id ?? null, status: 'executed', approvalId: input.approvalId, result }
    if (inquiry.source === 'voice') {
      await db.prepare(`UPDATE agent_runs SET status = 'completed', disposition = 'completed', summary = ?, finished_at = ? WHERE id = ?`).bind(
        'Lead written to the CRM after approval. No email was sent.', at, run.id,
      ).run()
      await db.prepare(`UPDATE inquiries SET status = 'resolved', updated_at = ? WHERE id = ?`).bind(at, inquiry.id).run()
      return { runId: run.id, status: 'completed', approvalId: input.approvalId, result }
    }
    if (await pendingCount(db, String(run.id)) > 0) {
      await holdForApprovals(db, String(run.id), String(inquiry.id))
      return { runId: run.id, status: 'awaiting_approval', approvalId: input.approvalId, result }
    }
    await db.prepare(`UPDATE agent_runs SET status = 'running', disposition = NULL, finished_at = NULL WHERE id = ?`).bind(run.id).run()
    const continued = await driveInquiry(db, env, String(inquiry.id), 1)
    return { runId: run.id, status: continued.status, approvalId: input.approvalId, inquiryId: inquiry.id, result }
  } catch (error) {
    await db.prepare(`UPDATE approvals SET status = 'pending', note = ? WHERE id = ?`).bind(
      error instanceof Error ? error.message : 'The action failed.', input.approvalId,
    ).run()
    throw error
  }
}

async function pendingCount(db: D1Like, runId: string): Promise<number> {
  const row = await one<{ n: number }>(db, `SELECT count(*) AS n FROM approvals WHERE run_id = ? AND status = 'pending'`, runId)
  return row?.n ?? 0
}

async function holdForApprovals(db: D1Like, runId: string, inquiryId: string): Promise<void> {
  await db.prepare(`UPDATE agent_runs SET status = 'awaiting_approval', disposition = NULL, finished_at = NULL WHERE id = ?`).bind(runId).run()
  await db.prepare(`UPDATE inquiries SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`).bind(Date.now(), inquiryId).run()
}

async function claim(db: D1Like, approvalId: string): Promise<void> {
  const result = await db.prepare(`UPDATE approvals SET status = 'executing' WHERE id = ? AND status = 'pending'`).bind(approvalId).run()
  if (!result.meta?.changes) throw new Error('This approval is no longer pending.')
}

async function execute(
  db: D1Like,
  env: WorkerEnv,
  tool: string,
  args: Record<string, unknown>,
  inquiry: Row | null,
  approvalId: string,
): Promise<unknown> {
  if (tool === 'send_email') return sendApproved(db, env, args, inquiry, approvalId)
  if (tool === 'crm_upsert') return upsertCrm(db, args, approvalId)
  if (tool === 'request_callback') return placeCallback(db, env, { inquiryId: String(inquiry?.id ?? args.inquiryId ?? ''), phone: String(args.phone ?? ''), approvalId })
  throw new Error(`Approval names a tool the desk does not run.`)
}

async function sendApproved(db: D1Like, env: WorkerEnv, args: Record<string, unknown>, inquiry: Row | null, approvalId: string): Promise<unknown> {
  if (!inquiry) throw new Error('Email cannot be sent without an inquiry.')
  const delivered = await deliverApprovedEmail(db, env, inquiry, approvalId, args)
  return {
    messageId: delivered.messageId,
    sandbox: delivered.status !== 'sent',
    status: delivered.status,
    to: inquiry.from_email,
    purpose: args.purpose,
    quoteId: args.quoteId ?? null,
    error: delivered.error,
    body: delivered.body,
    subject: args.subject,
  }
}

async function upsertCrm(db: D1Like, args: Record<string, unknown>, approvalId: string): Promise<unknown> {
  const key = `crm:${approvalId}`
  const cached = await one<{ response_json: string }>(db, 'SELECT response_json FROM idempotency_keys WHERE key = ?', key)
  if (cached) return JSON.parse(cached.response_json) as unknown
  const at = Date.now()
  const companyName = String(args.companyName)
  const contactEmail = String(args.contactEmail)
  const companyExternal = slug(companyName)
  let company = await one<Row>(db, 'SELECT * FROM crm_companies WHERE external_id = ?', companyExternal)
  if (!company) {
    const companyId = id('co')
    await db.prepare(
      `INSERT INTO crm_companies (id, external_id, name, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(companyId, companyExternal, companyName, contactEmail.split('@')[1] ?? null, at, at).run()
    company = { id: companyId }
  } else {
    await db.prepare(`UPDATE crm_companies SET name = ?, updated_at = ? WHERE id = ?`).bind(companyName, at, company.id).run()
  }
  const contacts = await db.prepare('SELECT email FROM crm_contacts WHERE company_id = ?').bind(company.id).all<{ email: string }>()
  const known = contacts.results.some((row) => row.email.toLowerCase() === contactEmail.toLowerCase())
  if (!known) {
    await db.prepare(`INSERT INTO crm_contacts (id, company_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)`).bind(
      id('ctc'), company.id, args.contactName, contactEmail, at,
    ).run()
  }
  const dealKey = externalKey(companyName, String(args.dealTitle))
  const existingDeal = await one<Row>(db, 'SELECT * FROM crm_deals WHERE external_id = ?', dealKey)
  if (!existingDeal) {
    await db.prepare(
      `INSERT INTO crm_deals (id, company_id, external_id, title, stage, amount_cents, quote_id, inquiry_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent', ?, ?)`,
    ).bind(id('deal'), company.id, dealKey, args.dealTitle, args.stage, args.amountCents, args.quoteId ?? null, args.inquiryId ?? null, at, at).run()
  } else {
    await db.prepare(`UPDATE crm_deals SET stage = ?, amount_cents = ?, quote_id = ?, updated_at = ? WHERE id = ?`).bind(
      args.stage, args.amountCents, args.quoteId ?? existingDeal.quote_id, at, existingDeal.id,
    ).run()
  }
  const result = { localCompanyId: company.id, sandbox: true }
  await db.prepare(`INSERT INTO idempotency_keys (key, scope, response_json, created_at) VALUES (?, 'crm_upsert', ?, ?)`).bind(key, JSON.stringify(result), at).run()
  return result
}

async function audit(db: D1Like, actor: string, action: string, entityId: string, detail: unknown): Promise<void> {
  await writeAuditRow(db, { actor, action, entityType: 'approval', entityId, detail })
}

function preserveStepMarkers(result: unknown, priorJson: string | null): Record<string, unknown> {
  const stored: Record<string, unknown> = result && typeof result === 'object' ? { ...(result as Record<string, unknown>) } : { value: result }
  if (!priorJson) return stored
  try {
    const prior = JSON.parse(priorJson) as Record<string, unknown>
    if (prior.fallback === true) {
      stored.fallback = true
      stored.reason = prior.reason ?? null
    }
    if (Array.isArray(prior.attempts)) stored.attempts = prior.attempts
  } catch {
    return stored
  }
  return stored
}

function safeJson(value: string | number | null): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
