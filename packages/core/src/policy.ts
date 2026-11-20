import { companyFrom, composeAnswer, composeClarify, composeQuoteEmail, composeRefusal, type InquiryLike } from './compose'
import { classifyText } from './classify'
import type { KbChunk } from './kb'
import { pickQuote } from './picker'
import type { QuoteMath } from './quote'
import type { ToolName } from './tool-schemas'

export type InquiryView = InquiryLike & { id: string; source: string }

export type StepView = {
  id?: string
  tool: string | null
  status: string
  result: unknown
  args?: unknown
}

export type AgentAction =
  | { type: 'final'; disposition: string; summary: string; model?: string }
  | { type: 'text'; text: string; model?: string }
  | { type: 'tool'; name: ToolName; args: Record<string, unknown>; model?: string; rejected?: { model: string; raw: unknown; error: string }[] }

export type PolicyContext = {
  inquiry: InquiryView
  steps: StepView[]
  nudge?: string
}

type DraftResult = QuoteMath & { quoteId: string; number: string; validUntil: string }

function ok(steps: StepView[], tool: string): boolean {
  return steps.some((step) => step.tool === tool && step.status === 'ok')
}

function resultOf<T>(steps: StepView[], tool: string): T | null {
  const step = [...steps].reverse().find((item) => item.tool === tool && item.status === 'ok')
  return (step?.result as T | undefined) ?? null
}

function chunksFrom(steps: StepView[]): KbChunk[] {
  const result = resultOf<{ chunks?: KbChunk[] }>(steps, 'search_kb')
  return result?.chunks ?? []
}

export function decideNext(ctx: PolicyContext): AgentAction {
  if (ctx.steps.some((step) => step.status === 'rejected')) {
    return {
      type: 'final',
      disposition: 'approval_rejected',
      summary: 'An operator rejected the proposed action. Nothing further was sent.',
    }
  }
  const classification = classifyText(`${ctx.inquiry.subject}\n${ctx.inquiry.body}`)
  const intent = classification.intent
  if (intent === 'spam') {
    return { type: 'final', disposition: 'archived_spam', summary: 'Marked as spam. No reply was drafted.' }
  }

  if (intent === 'out_of_scope') {
    if (!ok(ctx.steps, 'search_kb')) {
      return {
        type: 'tool',
        name: 'search_kb',
        args: { query: 'exclusions out of scope residential asbestos biohazard', limit: 3 },
      }
    }
    if (!ok(ctx.steps, 'send_email')) {
      const message = composeRefusal(ctx.inquiry, chunksFrom(ctx.steps))
      return {
        type: 'tool',
        name: 'send_email',
        args: { to: ctx.inquiry.fromEmail, subject: message.subject, body: message.body, purpose: message.purpose, quoteId: null },
      }
    }
    return {
      type: 'final',
      disposition: 'refused',
      summary: 'Out of scope. A refusal was sent after approval. No quote was drafted.',
    }
  }

  if (intent === 'product_question' || intent === 'support') {
    if (!ok(ctx.steps, 'search_kb')) {
      return {
        type: 'tool',
        name: 'search_kb',
        args: { query: `${ctx.inquiry.subject}\n${classification.stripped}`.slice(0, 400), limit: 4 },
      }
    }
    if (intent === 'support' && !ok(ctx.steps, 'crm_lookup')) {
      return { type: 'tool', name: 'crm_lookup', args: { query: companyFrom(ctx.inquiry) } }
    }
    if (!ok(ctx.steps, 'send_email')) {
      const message = composeAnswer(ctx.inquiry, chunksFrom(ctx.steps))
      return {
        type: 'tool',
        name: 'send_email',
        args: {
          to: ctx.inquiry.fromEmail,
          subject: message.subject,
          body: message.body,
          purpose: intent === 'support' ? 'support' : 'answer',
          quoteId: null,
        },
      }
    }
    return {
      type: 'final',
      disposition: 'completed',
      summary: intent === 'support' ? 'Support reply sent after approval.' : 'Answer sent after approval, with citations.',
    }
  }

  if (!ok(ctx.steps, 'search_kb')) {
    return { type: 'tool', name: 'search_kb', args: { query: 'services overview nightly cleaning quote quantities', limit: 3 } }
  }
  if (!ok(ctx.steps, 'get_price_list')) {
    return { type: 'tool', name: 'get_price_list', args: {} }
  }
  if (!ok(ctx.steps, 'crm_lookup')) {
    return { type: 'tool', name: 'crm_lookup', args: { query: companyFrom(ctx.inquiry) } }
  }
  const picked = pickQuote(`${ctx.inquiry.subject}\n${ctx.inquiry.body}`)
  if (picked.lines.length === 0) {
    if (!ok(ctx.steps, 'send_email')) {
      const message = composeClarify(ctx.inquiry)
      return {
        type: 'tool',
        name: 'send_email',
        args: { to: ctx.inquiry.fromEmail, subject: message.subject, body: message.body, purpose: message.purpose, quoteId: null },
      }
    }
    return {
      type: 'final',
      disposition: 'needs_details',
      summary: 'Quantities were missing, so no price was drafted. A clarification email was sent after approval.',
    }
  }
  if (!ok(ctx.steps, 'draft_quote')) {
    return {
      type: 'tool',
      name: 'draft_quote',
      args: {
        companyName: companyFrom(ctx.inquiry),
        contactName: ctx.inquiry.fromName,
        contactEmail: ctx.inquiry.fromEmail,
        lines: picked.lines,
        discountCode: picked.discountCode,
        notes: picked.note,
      },
    }
  }
  const draft = resultOf<DraftResult>(ctx.steps, 'draft_quote')
  if (!draft) {
    return { type: 'final', disposition: 'failed', summary: 'The quote draft was missing from the run.' }
  }
  if (!ok(ctx.steps, 'crm_upsert')) {
    return {
      type: 'tool',
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
    }
  }
  if (!ok(ctx.steps, 'send_email')) {
    const message = composeQuoteEmail(ctx.inquiry, draft)
    return {
      type: 'tool',
      name: 'send_email',
      args: { to: ctx.inquiry.fromEmail, subject: message.subject, body: message.body, purpose: message.purpose, quoteId: draft.quoteId },
    }
  }
  return {
    type: 'final',
    disposition: 'completed',
    summary: `Quote ${draft.number} was sent after approval.`,
  }
}
