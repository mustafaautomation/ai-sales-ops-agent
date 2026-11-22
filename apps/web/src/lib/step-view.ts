import { money } from './format'

/**
 * Plain-language view of one logged agent step. Reads only the redacted
 * argument and result JSON, so nothing here can surface an address or number
 * the audit log does not already show.
 */
export type StepFact = { label: string; value: string }
export type StepView = { say: string; facts: StepFact[]; quote?: string }

type Json = Record<string, unknown>

const INTENT_SAY: Record<string, string> = {
  quote: 'Read as a quote request.',
  product_question: 'Read as a product question.',
  support: 'Read as a support request.',
  spam: 'Read as spam. No reply will be drafted.',
  out_of_scope: 'Read as out of scope. The desk declines instead of quoting.',
}

const GENERIC_SIGNALS = new Set(['quote', 'question', 'default', 'support'])

function parse(raw: string | null | undefined): Json {
  if (!raw || raw === 'null') return {}
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
  } catch {
    return {}
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((item): item is Json => Boolean(item) && typeof item === 'object') : []
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function percent(bps: unknown): string {
  const value = typeof bps === 'number' ? bps / 100 : 0
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`
}

function clip(value: string, max = 420): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
}

export function describeStep(step: {
  toolName: string | null
  status: string
  redactedArgsJson?: string | null
  redactedResultJson?: string | null
}): StepView {
  const args = parse(step.redactedArgsJson)
  const result = parse(step.redactedResultJson)
  const held = step.status === 'pending_approval' || step.status === 'pending'
  const facts: StepFact[] = []
  const fact = (label: string, value: unknown) => {
    const shown = typeof value === 'number' ? String(value) : text(value)
    if (shown) facts.push({ label, value: shown })
  }

  switch (step.toolName) {
    case 'classify': {
      const intent = text(result.intent)
      const signals = (Array.isArray(result.signals) ? result.signals : []).map(String).filter((signal) => !GENERIC_SIGNALS.has(signal) && signal !== intent)
      if (signals.length > 0) fact('Signals', signals.join(', '))
      if (result.injection === true) fact('Injection', 'Instruction-like text removed')
      return { say: INTENT_SAY[intent] ?? 'Classified the note.', facts }
    }
    case 'search_kb': {
      const chunks = list(result.chunks)
      const titles = [...new Set(chunks.map((chunk) => text(chunk.title)).filter(Boolean))]
      if (titles.length > 0) fact('Notes', titles.join(', '))
      const top = chunks[0]
      return {
        say: chunks.length > 0 ? `Found ${plural(chunks.length, 'passage')} in ${plural(titles.length, 'knowledge note')} to answer from.` : 'Nothing in the knowledge base matched, so no answer is invented.',
        facts,
        quote: top ? clip(text(top.excerpt)) : undefined,
      }
    }
    case 'get_price_list': {
      const items = list(result.items)
      fact('Currency', result.currency)
      return { say: `Loaded the published rate card (${plural(items.length, 'SKU')}). Prices can only come from here.`, facts }
    }
    case 'crm_lookup':
    case 'search_crm': {
      const records = list(result.records)
      fact('Searched for', args.query)
      return { say: records.length > 0 ? `Found ${plural(records.length, 'existing record')} for this company.` : 'No existing record. This is a new company for the desk.', facts }
    }
    case 'draft_quote': {
      const lines = list(result.lines)
      fact('Quote', result.number)
      for (const line of lines) {
        const qty = typeof line.qty === 'number' ? line.qty.toLocaleString('en-US') : ''
        const total = typeof line.lineTotalCents === 'number' ? money(line.lineTotalCents) : ''
        fact(text(line.sku) || 'Line', [qty && `${qty} × ${text(line.description) || text(line.unit)}`, total].filter(Boolean).join(' = '))
      }
      if (typeof result.discountCents === 'number' && result.discountCents > 0) {
        fact('Discount', `${text(result.discountCode) || 'Applied'} ${percent(result.discountBps)} · −${money(result.discountCents)}`)
      }
      if (typeof result.taxCents === 'number') fact('Tax', `${percent(result.taxBps)} · ${money(result.taxCents)}`)
      if (typeof result.totalCents === 'number') fact('Total', money(result.totalCents))
      fact('Valid until', result.validUntil)
      if (lines.length === 0) return { say: 'Could not price this request from the rate card.', facts }
      return { say: `Priced ${plural(lines.length, 'line')} from the rate card. Totals are computed in code, in whole cents.`, facts }
    }
    case 'crm_upsert': {
      const record = parse(JSON.stringify(result.record ?? {}))
      fact('Company', args.companyName ?? record.companyName)
      fact('Deal', args.dealTitle ?? record.dealTitle)
      fact('Stage', args.stage ?? record.stage)
      const amount = args.amountCents ?? record.amountCents
      if (typeof amount === 'number') fact('Amount', money(amount))
      fact('Quote', args.quoteNumber ?? record.quoteNumber)
      return { say: held ? 'Proposed a CRM update. Nothing is written until an operator approves.' : 'Wrote the company, contact, and deal to the CRM after approval.', facts }
    }
    case 'send_email': {
      fact('Subject', args.subject)
      const purpose = text(result.purpose) || text(args.purpose)
      if (purpose) fact('Purpose', purpose.replaceAll('_', ' '))
      return {
        say: held ? 'Drafted the reply. It is held for an operator and has not been sent.' : 'Sent the approved reply.',
        facts,
        quote: text(args.body) ? clip(text(args.body), 600) : undefined,
      }
    }
    case 'request_callback': {
      return { say: held ? 'Proposed a callback. No call is placed until an operator approves.' : 'Placed the approved callback.', facts }
    }
    case 'human_review': {
      fact('Reason', result.reason ?? args.reason)
      return { say: 'Handed the note to a person instead of guessing.', facts }
    }
    case 'desk_fallback': {
      return { say: 'The model was unavailable, so the desk rules finished this step.', facts }
    }
    default:
      return { say: '', facts }
  }
}
