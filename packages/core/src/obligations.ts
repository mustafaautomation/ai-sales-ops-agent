import { companyFrom, composeAnswer, composeClarify, composeQuoteEmail, type InquiryLike } from './compose'
import { classifyText, spamSummary } from './classify'
import type { KbChunk } from './kb'
import { pickQuote } from './picker'
import type { PolicyContext, StepView } from './policy'
import type { QuoteMath } from './quote'
import type { ToolName } from './tool-schemas'

export type Proposal = { name: ToolName; args: Record<string, unknown> }

export type Obligation =
  | { type: 'stop'; disposition: string; summary: string }
  | { type: 'act'; name: ToolName; args: Record<string, unknown>; reason: string }
  | { type: 'queue'; proposals: Proposal[]; reason: string }
  | { type: 'wait' }
  | { type: 'done'; summary: string }

type Draft = QuoteMath & { quoteId: string; number: string; validUntil: string }

function done(steps: StepView[], tool: string): boolean {
  return steps.some((step) => step.tool === tool && step.status === 'ok')
}

function proposed(steps: StepView[], tool: string): boolean {
  return steps.some((step) => step.tool === tool && ['ok', 'pending_approval', 'rejected', 'executed'].includes(step.status))
}

function pending(steps: StepView[]): boolean {
  return steps.some((step) => step.status === 'pending_approval')
}

function rejected(steps: StepView[]): boolean {
  return steps.some((step) => step.status === 'rejected')
}

function resultOf<T>(steps: StepView[], tool: string): T | null {
  const step = [...steps].reverse().find((item) => item.tool === tool && item.status === 'ok')
  return (step?.result as T | undefined) ?? null
}

function chunksFrom(steps: StepView[]): KbChunk[] {
  return resultOf<{ chunks?: KbChunk[] }>(steps, 'search_kb')?.chunks ?? []
}

function searchAct(inquiry: InquiryLike, query: string): Obligation {
  return { type: 'act', name: 'search_kb', args: { query: query.slice(0, 400), limit: 4 }, reason: 'The knowledge base has not been searched.' }
}

/**
 * What the desk still owes on this inquiry.
 * A quote with a valid draft owes both a CRM proposal and a quote email.
 * Text from the model does not satisfy either one.
 */
export function nextObligation(ctx: PolicyContext): Obligation {
  const classification = classifyText(`${ctx.inquiry.subject}\n${ctx.inquiry.body}`)
  if (classification.intent === 'spam') {
    return { type: 'stop', disposition: 'archived_spam', summary: spamSummary(classification) }
  }
  if (classification.intent === 'out_of_scope') {
    return {
      type: 'stop',
      disposition: 'out_of_scope',
      summary: 'Out of scope for Meridian Facilities. No quote or customer email was drafted.',
    }
  }
  if (rejected(ctx.steps) && !pending(ctx.steps)) {
    return { type: 'stop', disposition: 'approval_rejected', summary: 'An operator rejected a proposed action. Nothing further was sent.' }
  }

  const intent = classification.intent
  if (intent === 'product_question' || intent === 'support') {
    if (!done(ctx.steps, 'search_kb')) return searchAct(ctx.inquiry, `${ctx.inquiry.subject}\n${classification.stripped}`)
    if (intent === 'support' && !done(ctx.steps, 'crm_lookup')) {
      return { type: 'act', name: 'crm_lookup', args: { query: companyFrom(ctx.inquiry) }, reason: 'The CRM has not been read.' }
    }
    if (!proposed(ctx.steps, 'send_email')) {
      const message = composeAnswer(ctx.inquiry, chunksFrom(ctx.steps))
      return {
        type: 'queue',
        reason: 'A customer reply is still owed.',
        proposals: [{
          name: 'send_email',
          args: {
            to: ctx.inquiry.fromEmail,
            subject: message.subject,
            body: message.body,
            purpose: intent === 'support' ? 'support' : 'answer',
            quoteId: null,
          },
        }],
      }
    }
    if (pending(ctx.steps)) return { type: 'wait' }
    return {
      type: 'done',
      summary: intent === 'support' ? 'Support reply sent after approval.' : 'Answer sent after approval, with citations.',
    }
  }

  if (!done(ctx.steps, 'search_kb')) return searchAct(ctx.inquiry, `${ctx.inquiry.subject}\n${ctx.inquiry.body}`.slice(0, 400))
  if (!done(ctx.steps, 'get_price_list')) {
    return { type: 'act', name: 'get_price_list', args: {}, reason: 'The rate card has not been read.' }
  }
  if (!done(ctx.steps, 'crm_lookup')) {
    return { type: 'act', name: 'crm_lookup', args: { query: companyFrom(ctx.inquiry) }, reason: 'The CRM has not been read.' }
  }
  const picked = pickQuote(`${ctx.inquiry.subject}\n${ctx.inquiry.body}`)
  if (picked.lines.length === 0) {
    if (!proposed(ctx.steps, 'send_email')) {
      const message = composeClarify(ctx.inquiry)
      return {
        type: 'queue',
        reason: 'Quantities are missing, so the desk owes a clarification instead of a price.',
        proposals: [{
          name: 'send_email',
          args: { to: ctx.inquiry.fromEmail, subject: message.subject, body: message.body, purpose: message.purpose, quoteId: null },
        }],
      }
    }
    if (pending(ctx.steps)) return { type: 'wait' }
    return { type: 'done', summary: 'Quantities were missing, so no price was drafted. A clarification email was sent after approval.' }
  }
  if (!done(ctx.steps, 'draft_quote')) {
    return {
      type: 'act',
      name: 'draft_quote',
      args: {
        companyName: companyFrom(ctx.inquiry),
        contactName: ctx.inquiry.fromName,
        contactEmail: ctx.inquiry.fromEmail,
        lines: picked.lines,
        discountCode: picked.discountCode,
        notes: picked.note,
      },
      reason: 'A quote has not been drafted from the rate card.',
    }
  }
  const draft = resultOf<Draft>(ctx.steps, 'draft_quote')
  if (!draft?.quoteId) {
    return { type: 'stop', disposition: 'failed', summary: 'The quote draft was missing from the run. No price was invented.' }
  }
  const proposals: Proposal[] = []
  if (!proposed(ctx.steps, 'crm_upsert')) {
    proposals.push({
      name: 'crm_upsert',
      args: {
        companyName: companyFrom(ctx.inquiry),
        contactName: ctx.inquiry.fromName,
        contactEmail: ctx.inquiry.fromEmail,
        dealTitle: draft.lines[0]?.description ?? 'Workplace services',
        stage: 'proposal',
        amountCents: draft.totalCents,
        quoteId: draft.quoteId,
        quoteNumber: draft.number,
        inquiryId: ctx.inquiry.id,
      },
    })
  }
  if (!proposed(ctx.steps, 'send_email')) {
    const message = composeQuoteEmail(ctx.inquiry, draft, chunksFrom(ctx.steps))
    proposals.push({
      name: 'send_email',
      args: {
        to: ctx.inquiry.fromEmail,
        subject: message.subject,
        body: message.body,
        purpose: message.purpose,
        quoteId: draft.quoteId,
      },
    })
  }
  if (proposals.length > 0) {
    return { type: 'queue', proposals, reason: 'The quote exists, so the CRM write and the quote email still have to be proposed.' }
  }
  if (pending(ctx.steps)) return { type: 'wait' }
  return { type: 'done', summary: `Quote ${draft.number} was sent after approval.` }
}

export function proposalKey(tool: string, args: Record<string, unknown>): string {
  if (tool === 'crm_upsert') return `${String(args.contactEmail ?? '').toLowerCase()}|${String(args.dealTitle ?? '')}`
  if (tool === 'send_email') return `${String(args.to ?? '').toLowerCase()}|${String(args.purpose ?? '')}|${String(args.quoteId ?? '')}`
  return tool
}
