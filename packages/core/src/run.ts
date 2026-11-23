import { HISTORY_TOOL, historyFromSteps, PRIOR_CONTACT_SQL, priorContactParams, toPriorContacts } from './history'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { isDiscountCode } from './catalog'
import { classifyText, spamSummary } from './classify'
import { guardDraft, type GroundChunk } from './ground'
import { companyFrom } from './compose'
import { maskedUnsubscribeUrl, signDeskToken, unsubscribeUrl, withUnsubscribe } from './outbound'
import { enrichQuoteProposal, quoteEmailSubject } from './quote-email'
import type { DB } from './db'
import { GuardrailError } from './guardrails'
import { id } from './ids'
import { DESK_FROM, type Ports } from './ports'
import type { InquiryView, StepView } from './policy'
import { createProvider, type Provider } from './providers'
import { MalformedModelOutput } from './workers-ai'
import { redactValue } from './redact'
import { agentRuns, agentSteps, approvals, inquiries, quotes } from './schema'
import {
  getApproval,
  getInquiry,
  getInquiryByExternal,
  getQuote,
  getRun,
  hitRateLimit,
  listRunsForInquiry,
  listSteps,
  now,
  pendingApprovalForRun,
  writeAudit,
} from './store'
import { executeTool, toolRequiresApproval, toolSchemas, type ToolName } from './tools'

const MAX_TOOLS = 8
const RUN_BUDGET_MS = 60_000

function openHumanReview(db: DB, runId: string, inquiryId: string, stepIndex: number, reason: string): void {
  const approvalId = id('apr')
  const proposed = { reason, note: 'The model returned a tool call that did not match the schema. No price was invented.' }
  db.insert(approvals)
    .values({
      id: approvalId,
      runId,
      toolName: 'human_review',
      status: 'pending',
      proposedJson: JSON.stringify(proposed),
      finalJson: null,
      note: reason.slice(0, 500),
      decidedBy: null,
      createdAt: now(),
      decidedAt: null,
    })
    .run()
  addStep(db, {
    runId,
    index: stepIndex,
    kind: 'tool',
    toolName: 'human_review',
    status: 'pending_approval',
    args: proposed,
    approvalId,
  })
  db.update(agentRuns).set({ status: 'awaiting_approval' }).where(eq(agentRuns.id, runId)).run()
  db.update(inquiries).set({ status: 'awaiting_approval', updatedAt: now() }).where(eq(inquiries.id, inquiryId)).run()
  writeAudit(db, {
    actor: 'agent',
    action: 'approval.requested',
    entityType: 'approval',
    entityId: approvalId,
    detail: { tool: 'human_review', reason },
  })
}

const webInquirySchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  company: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(2).max(140),
  message: z.string().trim().min(8).max(5_000),
})

function fail(db: DB, runId: string, inquiryId: string, message: string): void {
  const at = now()
  db.update(agentRuns)
    .set({ status: 'failed', error: message.slice(0, 500), finishedAt: at })
    .where(eq(agentRuns.id, runId))
    .run()
  db.update(inquiries).set({ status: 'failed', updatedAt: at }).where(eq(inquiries.id, inquiryId)).run()
  writeAudit(db, { actor: 'agent', action: 'run.failed', entityType: 'agent_run', entityId: runId, detail: { message } })
}

function retrievedChunks(steps: { toolName: string | null; status: string; resultJson: string | null }[]): GroundChunk[] {
  const step = [...steps].reverse().find((item) => item.toolName === 'search_kb' && item.status === 'ok' && item.resultJson)
  if (!step?.resultJson) return []
  try {
    const parsed = JSON.parse(step.resultJson) as { chunks?: GroundChunk[] }
    return parsed.chunks ?? []
  } catch {
    return []
  }
}

function quoteForDraft(db: DB, quoteId: unknown) {
  if (typeof quoteId !== 'string' || !quoteId) return null
  const row = getQuote(db, quoteId)
  if (!row) return null
  return {
    number: row.quote.number,
    validUntil: row.quote.validUntil,
    lines: row.lines.map((line) => ({
      sku: line.sku,
      description: line.description,
      unit: 'each',
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    })),
    discountCode: isDiscountCode(row.quote.discountCode) ? row.quote.discountCode : null,
    discountBps: row.quote.discountBps,
    discountCents: row.quote.discountCents,
    taxBps: row.quote.taxBps,
    subtotalCents: row.quote.subtotalCents,
    taxCents: row.quote.taxCents,
    totalCents: row.quote.totalCents,
    currency: 'USD' as const,
  }
}

function viewInquiry(row: NonNullable<ReturnType<typeof getInquiry>>, steps: Parameters<typeof historyFromSteps>[0] = []): InquiryView {
  const history = historyFromSteps(steps)
  return {
    ...(history.length > 0 ? { history } : {}),
    id: row.id,
    source: row.source,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    companyName: row.companyName,
    subject: row.subject,
    body: row.body,
  }
}

function viewSteps(rows: ReturnType<typeof listSteps>): StepView[] {
  return rows
    .filter((step) => step.kind === 'tool')
    .map((step) => ({
      tool: step.toolName,
      status: step.status,
      result: step.resultJson ? (JSON.parse(step.resultJson) as unknown) : null,
    }))
}

function addStep(
  db: DB,
  input: {
    runId: string
    index: number
    kind: string
    toolName: string | null
    status: string
    args?: unknown
    result?: unknown
    approvalId?: string | null
    startedAt?: number
  },
): string {
  const stepId = id('stp')
  const startedAt = input.startedAt ?? now()
  const finishedAt = Math.max(now(), startedAt + (input.startedAt == null ? 50 : 1))
  db.insert(agentSteps)
    .values({
      id: stepId,
      runId: input.runId,
      stepIndex: input.index,
      kind: input.kind,
      toolName: input.toolName,
      status: input.status,
      argsJson: input.args === undefined ? null : JSON.stringify(input.args),
      resultJson: input.result === undefined ? null : JSON.stringify(input.result),
      redactedArgsJson: input.args === undefined ? null : JSON.stringify(redactValue(input.args)),
      redactedResultJson: input.result === undefined ? null : JSON.stringify(redactValue(input.result)),
      approvalId: input.approvalId ?? null,
      createdAt: finishedAt,
      startedAt,
      finishedAt,
    })
    .run()
  return stepId
}

function inquiryStatusFor(disposition: string): string {
  if (disposition === 'archived_spam') return 'archived'
  if (disposition === 'failed') return 'failed'
  return 'resolved'
}

export function runSnapshot(db: DB, runId: string) {
  const run = getRun(db, runId)
  if (!run) return null
  const inquiry = getInquiry(db, run.inquiryId)
  const steps = listSteps(db, runId)
  const pending = pendingApprovalForRun(db, runId)
  return { run, inquiry, steps, pending }
}

export async function runInquiry(db: DB, ports: Ports, inquiryId: string, provider: Provider = createProvider()): Promise<NonNullable<ReturnType<typeof runSnapshot>>> {
  const inquiry = getInquiry(db, inquiryId)
  if (!inquiry) throw new Error(`Inquiry ${inquiryId} was not found.`)
  const active = listRunsForInquiry(db, inquiryId).find((run) => run.status === 'running' || run.status === 'awaiting_approval')
  if (active) {
    const snapshot = runSnapshot(db, active.id)
    if (snapshot) return snapshot
  }
  const classification = classifyText(`${inquiry.subject}\n${inquiry.body}`)
  const at = now()
  const runId = id('run')
  db.insert(agentRuns)
    .values({
      id: runId,
      inquiryId,
      status: 'running',
      provider: provider.name,
      disposition: null,
      summary: null,
      error: null,
      startedAt: at,
      finishedAt: null,
    })
    .run()
  db.update(inquiries)
    .set({
      status: 'processing',
      intent: classification.intent,
      injectionFlag: classification.injection ? 1 : 0,
      updatedAt: at,
    })
    .where(eq(inquiries.id, inquiryId))
    .run()
  addStep(db, {
    runId,
    index: 0,
    kind: 'guardrail',
    toolName: 'classify',
    status: 'ok',
    result: { intent: classification.intent, injection: classification.injection, signals: classification.signals },
  })
  writeAudit(db, {
    actor: 'agent',
    action: 'inquiry.classified',
    entityType: 'inquiry',
    entityId: inquiryId,
    detail: { intent: classification.intent, injection: classification.injection, signals: classification.signals },
  })
  if (classification.intent === 'spam') {
    db.update(agentRuns)
      .set({
        status: 'completed',
        disposition: 'archived_spam',
        summary: spamSummary(classification),
        finishedAt: now(),
      })
      .where(eq(agentRuns.id, runId))
      .run()
    db.update(inquiries).set({ status: 'archived', updatedAt: now() }).where(eq(inquiries.id, inquiryId)).run()
    writeAudit(db, { actor: 'agent', action: 'inquiry.archived_spam', entityType: 'inquiry', entityId: inquiryId, detail: {} })
    return runSnapshot(db, runId)!
  }
  const prior = toPriorContacts(
    db.$client.prepare(PRIOR_CONTACT_SQL).all(...priorContactParams(inquiry)) as Record<string, unknown>[],
  )
  if (prior.length > 0) {
    addStep(db, { runId, index: 1, kind: 'guardrail', toolName: HISTORY_TOOL, status: 'ok', result: { prior } })
  }
  await continueRun(db, ports, runId, provider)
  return runSnapshot(db, runId)!
}

export async function continueRun(db: DB, ports: Ports, runId: string, provider: Provider): Promise<void> {
  const run = getRun(db, runId)
  if (!run || run.status === 'completed' || run.status === 'failed') return
  const inquiryRow = getInquiry(db, run.inquiryId)
  if (!inquiryRow) return
  const started = run.startedAt
  for (let guard = 0; guard < MAX_TOOLS + 2; guard += 1) {
    if (now() - started > RUN_BUDGET_MS) {
      fail(db, runId, inquiryRow.id, 'The run exceeded its time budget.')
      return
    }
    const steps = listSteps(db, runId)
    const malformedSoFar = steps.filter((step) => step.toolName === 'model_output' && step.status === 'error').length
    if (steps.some((step) => step.status === 'pending_approval')) {
      db.update(agentRuns).set({ status: 'awaiting_approval' }).where(eq(agentRuns.id, runId)).run()
      db.update(inquiries).set({ status: 'awaiting_approval', updatedAt: now() }).where(eq(inquiries.id, inquiryRow.id)).run()
      return
    }
    const toolCount = steps.filter((step) => step.kind === 'tool').length
    let action
    const thinkStarted = now()
    try {
      action = await provider.next({ inquiry: viewInquiry(inquiryRow, steps), steps: viewSteps(steps) })
    } catch (error) {
      if (error instanceof MalformedModelOutput || (error instanceof Error && error.name === 'MalformedModelOutput')) {
        addStep(db, {
          runId,
          index: steps.length,
          kind: 'guardrail',
          toolName: 'model_output',
          status: 'error',
          result: { error: error.message },
          startedAt: thinkStarted,
        })
        if (malformedSoFar < 1) continue
        openHumanReview(db, runId, inquiryRow.id, steps.length + 1, error.message)
        return
      }
      fail(db, runId, inquiryRow.id, error instanceof Error ? error.message : 'The model request failed.')
      return
    }
    if (action.type === 'text') {
      addStep(db, {
        runId,
        index: steps.length,
        kind: 'guardrail',
        toolName: 'model_output',
        status: 'error',
        result: { error: 'The model replied with text instead of a tool call.', text: action.text, model: action.model ?? null },
        startedAt: thinkStarted,
      })
      if (malformedSoFar < 1) continue
      openHumanReview(db, runId, inquiryRow.id, steps.length + 1, 'The model replied with text instead of a tool call.')
      return
    }
    if (action.type === 'final') {
      const at = now()
      db.update(agentRuns)
        .set({ status: 'completed', disposition: action.disposition, summary: action.summary, finishedAt: at })
        .where(eq(agentRuns.id, runId))
        .run()
      db.update(inquiries)
        .set({ status: inquiryStatusFor(action.disposition), updatedAt: at })
        .where(eq(inquiries.id, inquiryRow.id))
        .run()
      writeAudit(db, {
        actor: 'agent',
        action: 'run.completed',
        entityType: 'agent_run',
        entityId: runId,
        detail: { disposition: action.disposition, summary: action.summary },
      })
      return
    }
    if (toolCount >= MAX_TOOLS) {
      fail(db, runId, inquiryRow.id, 'The run exceeded the tool step limit.')
      return
    }
    const name = action.name
    if (!toolSchemas[name]) {
      fail(db, runId, inquiryRow.id, `Unknown tool ${name}.`)
      return
    }
    let parsed: unknown
    try {
      parsed = toolSchemas[name].parse(action.args)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool arguments were rejected.'
      addStep(db, {
        runId,
        index: steps.length,
        kind: 'guardrail',
        toolName: 'model_output',
        status: 'error',
        args: action.args,
        result: { error: message },
        startedAt: thinkStarted,
      })
      if (malformedSoFar < 1) continue
      openHumanReview(db, runId, inquiryRow.id, steps.length + 1, message)
      return
    }
    if (toolRequiresApproval(name)) {
      let proposal = parsed as Record<string, unknown>
      let proposalNote: string | null = null
      if (name === 'crm_upsert' && proposal.quoteId) {
        proposal = { ...proposal, stage: 'proposal' }
      }
      if (name === 'send_email') {
        const purpose = String(proposal.purpose ?? 'answer')
        const guarded = guardDraft({
          inquiry: viewInquiry(inquiryRow, steps),
          body: String(proposal.body ?? ''),
          purpose,
          chunks: retrievedChunks(steps),
          quote: quoteForDraft(db, proposal.quoteId),
          structured: purpose === 'quote' ? proposal : null,
        })
        if (guarded.blocked) {
          openHumanReview(db, runId, inquiryRow.id, steps.length, guarded.blocked)
          return
        }
        const origin = process.env.PUBLIC_ORIGIN || 'https://sales.quvantic.com'
        // Store a masked stop link for the approval UI; the real token is attached on send.
        proposal = { ...proposal, body: withUnsubscribe(guarded.body, maskedUnsubscribeUrl(origin)) }
        if (purpose === 'quote') {
          const quote = quoteForDraft(db, proposal.quoteId)
          if (quote) {
            proposal = enrichQuoteProposal(proposal, quote)
          }
          delete proposal.opening
          delete proposal.answers
          delete proposal.closing
        }
        proposalNote = guarded.note
      }
      const approvalId = id('apr')
      db.insert(approvals)
        .values({
          id: approvalId,
          runId,
          toolName: name,
          status: 'pending',
          proposedJson: JSON.stringify(proposal),
          finalJson: null,
          note: proposalNote,
          decidedBy: null,
          createdAt: now(),
          decidedAt: null,
        })
        .run()
      addStep(db, {
        runId,
        index: steps.length,
        kind: 'tool',
        toolName: name,
        status: 'pending_approval',
        args: proposal,
        approvalId,
        startedAt: thinkStarted,
      })
      const quoteId = (proposal as { quoteId?: string | null }).quoteId
      if (name === 'send_email' && quoteId) {
        db.update(quotes).set({ status: 'pending_send' }).where(eq(quotes.id, quoteId)).run()
      }
      db.update(agentRuns).set({ status: 'awaiting_approval' }).where(eq(agentRuns.id, runId)).run()
      db.update(inquiries).set({ status: 'awaiting_approval', updatedAt: now() }).where(eq(inquiries.id, inquiryRow.id)).run()
      writeAudit(db, {
        actor: 'agent',
        action: 'approval.requested',
        entityType: 'approval',
        entityId: approvalId,
        detail: { tool: name, runId },
      })
      return
    }
    try {
      const toolStarted = thinkStarted
      const result = await executeTool({
        db,
        ports,
        name,
        raw: parsed,
        inquiry: { id: inquiryRow.id, fromEmail: inquiryRow.fromEmail },
        runId,
      })
      addStep(db, {
        runId,
        index: steps.length,
        kind: 'tool',
        toolName: name,
        status: 'ok',
        args: parsed,
        result,
        startedAt: toolStarted,
      })
      writeAudit(db, {
        actor: 'agent',
        action: 'tool.completed',
        entityType: 'agent_run',
        entityId: runId,
        detail: { tool: name },
      })
    } catch (error) {
      addStep(db, {
        runId,
        index: steps.length,
        kind: 'tool',
        toolName: name,
        status: 'error',
        args: parsed,
        result: { error: error instanceof Error ? error.message : 'Tool failed' },
        startedAt: thinkStarted,
      })
      fail(db, runId, inquiryRow.id, error instanceof Error ? error.message : 'Tool failed.')
      return
    }
  }
  fail(db, runId, inquiryRow.id, 'The run exceeded the tool step limit.')
}

function claimApproval(db: DB, approvalId: string): boolean {
  const raw = db.$client
  const claim = raw.transaction(() => {
    const row = raw.prepare('SELECT status FROM approvals WHERE id = ?').get(approvalId) as { status: string } | undefined
    if (!row || row.status !== 'pending') return false
    raw.prepare(`UPDATE approvals SET status = 'executing', decided_at = ? WHERE id = ?`).run(Date.now(), approvalId)
    return true
  })
  return claim()
}

export async function decideApproval(
  db: DB,
  ports: Ports,
  input: {
    approvalId: string
    decision: 'approved' | 'rejected'
    finalJson?: string | null
    actor: string
    provider?: Provider
  },
): Promise<NonNullable<ReturnType<typeof runSnapshot>>> {
  const approval = getApproval(db, input.approvalId)
  if (!approval) throw new GuardrailError('missing_approval', 'Approval was not found.')
  if (approval.status !== 'pending') throw new GuardrailError('approval_state', 'This approval is no longer pending.')
  const provider = input.provider ?? createProvider()
  const run = getRun(db, approval.runId)
  if (!run) throw new Error('Run was not found.')

  if (approval.toolName === 'human_review') {
    if (!claimApproval(db, approval.id)) throw new GuardrailError('approval_state', 'This approval is no longer pending.')
    const at = now()
    const closed = input.decision === 'rejected'
    const summary = closed ? 'An operator closed the review.' : 'An operator accepted the review. No customer message was sent.'
    db.update(approvals)
      .set({ status: closed ? 'rejected' : 'executed', decidedBy: input.actor, decidedAt: at, finalJson: approval.proposedJson })
      .where(eq(approvals.id, approval.id))
      .run()
    db.update(agentRuns)
      .set({ status: 'completed', disposition: 'human_review', summary, finishedAt: at })
      .where(eq(agentRuns.id, run.id))
      .run()
    db.update(inquiries).set({ status: 'resolved', updatedAt: at }).where(eq(inquiries.id, run.inquiryId)).run()
    writeAudit(db, {
      actor: input.actor,
      action: closed ? 'approval.rejected' : 'approval.approved',
      entityType: 'approval',
      entityId: approval.id,
      detail: { tool: 'human_review' },
    })
    return runSnapshot(db, run.id)!
  }

  if (input.decision === 'rejected') {
    if (!claimApproval(db, approval.id)) throw new GuardrailError('approval_state', 'This approval is no longer pending.')
    const at = now()
    db.update(approvals)
      .set({ status: 'rejected', decidedBy: input.actor, decidedAt: at, note: input.finalJson ? 'Rejected with a note.' : null })
      .where(eq(approvals.id, approval.id))
      .run()
    db.update(agentSteps)
      .set({ status: 'rejected' })
      .where(eq(agentSteps.approvalId, approval.id))
      .run()
    const proposed = JSON.parse(approval.proposedJson) as { quoteId?: string | null }
    if (approval.toolName === 'send_email' && proposed.quoteId) {
      db.update(quotes).set({ status: 'void' }).where(eq(quotes.id, proposed.quoteId)).run()
    }
    writeAudit(db, {
      actor: input.actor,
      action: 'approval.rejected',
      entityType: 'approval',
      entityId: approval.id,
      detail: { tool: approval.toolName },
    })
    await continueRun(db, ports, run.id, provider)
    return runSnapshot(db, run.id)!
  }

  const schema = toolSchemas[approval.toolName as ToolName]
  if (!schema) throw new GuardrailError('unknown_tool', 'Approval names a tool the desk does not run.')
  const rawText = input.finalJson?.trim() ? input.finalJson : approval.proposedJson
  let parsed: unknown
  try {
    parsed = schema.parse(JSON.parse(rawText))
  } catch (error) {
    throw new GuardrailError('invalid_edit', error instanceof Error ? error.message : 'The edited payload is invalid.')
  }
  const proposed = schema.parse(JSON.parse(approval.proposedJson))
  // Compare before reattaching the real unsubscribe token so masked UI edits are not treated as overrides.
  const operatorOverride = JSON.stringify(parsed) !== JSON.stringify(proposed)
  if (!claimApproval(db, approval.id)) throw new GuardrailError('approval_state', 'This approval is no longer pending.')
  const inquiry = getInquiry(db, run.inquiryId)
  if (!inquiry) throw new Error('Inquiry was not found.')
  if (approval.toolName === 'send_email' && parsed && typeof parsed === 'object') {
    const origin = process.env.PUBLIC_ORIGIN || 'https://sales.quvantic.com'
    const stop = await signDeskToken(process.env.SESSION_SECRET || 'dev-only-session-secret', {
      inquiryId: inquiry.id,
      email: inquiry.fromEmail,
      purpose: 'unsubscribe',
      exp: Date.now() + 180 * 24 * 60 * 60 * 1000,
    })
    const record = parsed as Record<string, unknown>
    record.body = withUnsubscribe(String(record.body ?? ''), unsubscribeUrl(origin, stop))
    if (String(record.purpose ?? '') === 'quote') {
      const quote = quoteForDraft(db, record.quoteId)
      if (quote) record.subject = quoteEmailSubject(quote, String(record.subject ?? ''))
    }
    parsed = schema.parse(record)
  }
  try {
    const result = await executeTool({
      db,
      ports,
      name: approval.toolName,
      raw: parsed,
      inquiry: { id: inquiry.id, fromEmail: inquiry.fromEmail },
      runId: run.id,
      grant: { approvalId: approval.id, operatorOverride, actor: input.actor },
    })
    const at = now()
    db.update(approvals)
      .set({
        status: 'executed',
        finalJson: JSON.stringify(parsed),
        decidedBy: input.actor,
        decidedAt: at,
      })
      .where(eq(approvals.id, approval.id))
      .run()
    db.update(agentSteps)
      .set({
        status: 'ok',
        argsJson: JSON.stringify(parsed),
        resultJson: JSON.stringify(result),
        redactedArgsJson: JSON.stringify(redactValue(parsed)),
        redactedResultJson: JSON.stringify(redactValue(result)),
      })
      .where(eq(agentSteps.approvalId, approval.id))
      .run()
    writeAudit(db, {
      actor: input.actor,
      action: operatorOverride ? 'approval.edited' : 'approval.approved',
      entityType: 'approval',
      entityId: approval.id,
      detail: { tool: approval.toolName },
    })
  } catch (error) {
    db.update(approvals)
      .set({ status: 'pending', note: error instanceof Error ? error.message : 'The action failed.' })
      .where(eq(approvals.id, approval.id))
      .run()
    throw error
  }
  await continueRun(db, ports, run.id, provider)
  return runSnapshot(db, run.id)!
}

export async function releaseRun(db: DB, ports: Ports, runId: string, actor: string, provider: Provider = createProvider()): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pending = pendingApprovalForRun(db, runId)
    if (!pending) return
    await decideApproval(db, ports, { approvalId: pending.id, decision: 'approved', actor, provider })
  }
}

export function createInquiry(
  db: DB,
  input: {
    source: string
    externalId: string | null
    fromName: string
    fromEmail: string
    companyName: string | null
    subject: string
    body: string
  },
) {
  const at = now()
  const row = {
    id: id('inq'),
    source: input.source,
    externalId: input.externalId,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    companyName: input.companyName,
    subject: input.subject,
    body: input.body,
    status: 'new',
    intent: null,
    injectionFlag: 0,
    createdAt: at,
    updatedAt: at,
  }
  db.insert(inquiries).values(row).run()
  return row
}

export async function submitWebInquiry(
  db: DB,
  ports: Ports,
  input: unknown,
  ip: string,
  provider: Provider = createProvider(),
): Promise<{ ok: true; id: string } | { ok: false; error: 'rate_limited' | 'invalid'; message: string }> {
  const limit = Number(process.env.FORM_RATE_LIMIT ?? 5)
  const windowMs = Number(process.env.FORM_RATE_WINDOW_MS ?? 600_000)
  const gate = hitRateLimit(db, `form:${ip}`, Number.isFinite(limit) ? limit : 5, Number.isFinite(windowMs) ? windowMs : 600_000)
  if (!gate.ok) {
    return { ok: false, error: 'rate_limited', message: 'Too many inquiries from this network. Try again in a few minutes.' }
  }
  const parsed = webInquirySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }
  const row = createInquiry(db, {
    source: 'web',
    externalId: null,
    fromName: parsed.data.name,
    fromEmail: parsed.data.email,
    companyName: parsed.data.company,
    subject: parsed.data.subject,
    body: `${parsed.data.message}\n\nCompany: ${parsed.data.company}`,
  })
  db.update(inquiries).set({ externalId: `web:${row.id}` }).where(eq(inquiries.id, row.id)).run()
  try {
    await ports.email.ingest({
      from: `${parsed.data.name} <${parsed.data.email}>`,
      to: DESK_FROM,
      subject: parsed.data.subject,
      body: `${parsed.data.message}\n\nCompany: ${parsed.data.company}`,
      clientKey: `web:${row.id}`,
    })
  } catch (error) {
    writeAudit(db, {
      actor: 'web',
      action: 'email.ingest_failed',
      entityType: 'inquiry',
      entityId: row.id,
      detail: { message: error instanceof Error ? error.message : 'ingest failed' },
    })
  }
  await runInquiry(db, ports, row.id, provider)
  return { ok: true, id: row.id }
}

function parseFrom(from: string): { name: string; email: string } {
  const match = from.match(/^\s*"?(.*?)"?\s*<([^>]+)>\s*$/)
  if (match?.[2]) {
    const email = match[2].trim()
    const name = match[1]?.trim() || email
    return { name, email }
  }
  return { name: from.trim(), email: from.trim() }
}

export async function syncInbox(db: DB, ports: Ports, provider: Provider = createProvider()): Promise<number> {
  const messages = await ports.email.listInbound()
  let imported = 0
  for (const message of messages) {
    if (message.clientKey?.startsWith('web:')) continue
    if (getInquiryByExternal(db, message.id)) continue
    const from = parseFrom(message.from)
    const row = createInquiry(db, {
      source: 'email',
      externalId: message.id,
      fromName: from.name,
      fromEmail: from.email,
      companyName: companyFrom({
        fromName: from.name,
        fromEmail: from.email,
        companyName: null,
        subject: message.subject,
        body: message.body,
      }),
      subject: message.subject,
      body: message.body,
    })
    await runInquiry(db, ports, row.id, provider)
    imported += 1
  }
  return imported
}
