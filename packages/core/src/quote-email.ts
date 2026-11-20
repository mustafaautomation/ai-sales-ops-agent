import { DISCOUNT_CODES } from './catalog'
import {
  coverQuestions,
  followUpSentence,
  inquiryQuestions,
  paraphrase,
  type InquiryLike,
} from './compose'
import { allChunks } from './kb'
import { formatMoney, type QuoteMath } from './quote'

export type QuoteAnswer = {
  question: string
  answer: string
  sourceIds: string[]
  status: 'answered' | 'will_confirm'
}

export type QuoteDraft = {
  opening: string
  answers: QuoteAnswer[]
  closing: string | null
}

type Cite = { slug: string; title: string; heading: string; content?: string; excerpt?: string }

const MONEY_WORDS = /\b(\$|usd|fees?|fee\b|priced?|subtotal|total|tax\b|discount|rate card|\$\d|\d+\.\d{2})\b/i
const RISKY_ASSERT = [
  { id: 'insurance', pattern: /\binsured\b|\binsurance\b/i },
  { id: 'background check', pattern: /\bbackground[-\s]?checked\b|\bbackground checks?\b/i },
  { id: 'guarantee', pattern: /\bguarantee[ds]?\b|\bwarrant(?:y|ies)\b/i },
  { id: 'bonded', pattern: /\bbonded\b/i },
  { id: 'licensed', pattern: /\blicen[cs]ed\b|\blicen[cs]e\b/i },
  { id: 'always on', pattern: /\b24\s*\/\s*7\b|\baround the clock\b/i },
  { id: 'certification', pattern: /\bcertifications?\b|\bcertified\b/i },
]
const NEGATION = /\b(not|no|never|cannot|can't|do not|does not|don't|doesn't|without|do not have|don't have|unable|confirm)\b/i

const UNANSWERED = [
  { id: 'insurance', pattern: /\binsured\b|\binsurance\b/i, label: 'Insurance' },
  { id: 'background check', pattern: /\bbackground/i, label: 'Background checks' },
  { id: 'guarantee', pattern: /\bguarantee|\bwarrant/i, label: 'Guarantees' },
  { id: 'bonded', pattern: /\bbonded\b/i, label: 'Bonding' },
  { id: 'licensed', pattern: /\blicen/i, label: 'Licensing' },
  { id: 'parking', pattern: /\bparking\b/i, label: 'Parking' },
]

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there'
}

function topicLabel(question: string): string {
  for (const rule of UNANSWERED) {
    if (rule.pattern.test(question)) return rule.label
  }
  if (/evening|after\s*7|18:30|nightly|crew/i.test(question)) return 'Evening crews'
  if (/green|chemical|certif|product/i.test(question)) return 'Products'
  if (/weekend/i.test(question)) return 'Weekend desk'
  if (/\bhours?\b|staffed/i.test(question)) return 'Hours'
  const short = paraphrase(question).replace(/\?$/, '')
  return short.length > 40 ? `${short.slice(0, 37)}…` : short
}

/** Compact line-item / totals block. Never invents fees. */
export function formatQuoteBlock(quote: QuoteMath & { number: string; validUntil: string }, company: string): string {
  const discountLabel = quote.discountCode
    ? `${DISCOUNT_CODES[quote.discountCode].label} (${(quote.discountBps / 100).toFixed(0)}%)`
    : null
  const lines = quote.lines
    .map(
      (line) =>
        `${line.qty} × ${line.description} (${line.sku}) @ ${formatMoney(line.unitPriceCents)} = ${formatMoney(line.lineTotalCents)}`,
    )
    .join('\n')
  const totals = [
    `Subtotal: ${formatMoney(quote.subtotalCents)}`,
    ...(discountLabel && quote.discountCents > 0
      ? [`Discount (${discountLabel}): ${formatMoney(quote.discountCents)}`]
      : []),
    `Tax (${(quote.taxBps / 100).toFixed(2)}%): ${formatMoney(quote.taxCents)}`,
    `Total: ${formatMoney(quote.totalCents)}`,
  ].join('\n')
  return [
    `Quote ${quote.number} for ${company} is below. It is valid through ${quote.validUntil}.`,
    '',
    lines,
    '',
    totals,
  ].join('\n')
}

export function willConfirmAnswer(question: string): string {
  return `${topicLabel(question)}: we'll confirm the details and follow up.`
}

function stripMoneyWords(text: string): string {
  return text
    .replace(/\b(with\s+)?(total\s+)?estimated\s+taxes?\s+and\s+fees?\b[^.?!]*/gi, '')
    .replace(/\bat\s+\$[\d,.]+/gi, '')
    .replace(/\b\$[\d,]+(?:\.\d{2})?\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function answerUnsupported(answer: string, chunks: Cite[]): boolean {
  const hay = chunks.map((chunk) => `${chunk.slug}\n${chunk.heading}\n${chunk.content ?? ''}\n${chunk.excerpt ?? ''}`).join('\n').toLowerCase()
  if (MONEY_WORDS.test(answer) && !/confirm|follow up/i.test(answer)) return true
  for (const rule of RISKY_ASSERT) {
    if (rule.pattern.test(answer) && !NEGATION.test(answer) && !rule.pattern.test(hay)) return true
  }
  const terms = (answer.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((term) => term.length > 3)
  if (terms.length >= 8) {
    const hits = terms.filter((term) => hay.includes(term)).length
    if (hits / terms.length < 0.35 && !/confirm|follow up/i.test(answer)) return true
  }
  return false
}

/** Downgrade unsupported answers to will_confirm instead of discarding the draft. */
export function groundQuoteAnswers(answers: QuoteAnswer[], chunks: Cite[]): QuoteAnswer[] {
  const pool = chunks.length > 0 ? chunks : allChunks()
  return answers.map((item) => {
    if (item.status === 'will_confirm') {
      return { ...item, answer: item.answer?.trim() || willConfirmAnswer(item.question), sourceIds: [] }
    }
    const cleaned = stripMoneyWords(item.answer || '')
    if (!cleaned || answerUnsupported(cleaned, pool)) {
      return { question: item.question, answer: willConfirmAnswer(item.question), sourceIds: [], status: 'will_confirm' }
    }
    return { ...item, answer: cleaned, sourceIds: [...new Set(item.sourceIds.filter(Boolean))] }
  })
}

function questionKey(question: string): string {
  const lower = question.toLowerCase()
  for (const rule of UNANSWERED) {
    if (rule.pattern.test(lower)) return rule.id
  }
  if (/evening|after\s*7|18:30|nightly|crew window/i.test(lower)) return 'evening'
  if (/green|chemical|certif|product/i.test(lower)) return 'green'
  if (/weekend/i.test(lower)) return 'weekend'
  if (/\bhours?\b|staffed/i.test(lower)) return 'hours'
  return lower.replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40)
}

/** Exactly one answer per detected customer question; fill gaps as will_confirm. */
export function ensureQuoteQuestions(inquiry: InquiryLike, answers: QuoteAnswer[], chunks: Cite[] = []): QuoteAnswer[] {
  const detected = inquiryQuestions(inquiry.body).filter(
    (question) => !/\b(quote|sqft|square feet|panes?|restrooms?)\b/i.test(question) || /evening|insured|insurance|green|after\s*7|crew|hours|weekend|parking|certif/i.test(question),
  )
  const nonQuote = detected.filter((question) => {
    const onlyQuote = /\bquotes?\b/i.test(question) && !/evening|insured|insurance|green|after\s*7|crew|hours|weekend|parking|certif|\?/i.test(question.replace(/\bquotes?\b/gi, ''))
    return !onlyQuote
  })
  const questions = nonQuote.length > 0
    ? nonQuote
    : inquiryQuestions(inquiry.body).filter((q) => /evening|insured|insurance|green|after\s*7|crew|hours|weekend|parking|certif|\?/i.test(q) && !/^\s*please quote/i.test(q))

  const byKey = new Map<string, QuoteAnswer>()
  for (const item of answers) {
    const key = questionKey(item.question)
    if (!byKey.has(key)) byKey.set(key, item)
  }

  const ordered: QuoteAnswer[] = []
  const used = new Set<string>()
  for (const question of questions) {
    const key = questionKey(question)
    if (used.has(key)) continue
    used.add(key)
    const existing = byKey.get(key)
    if (existing) {
      ordered.push({ ...existing, question: existing.question || question })
      continue
    }
    const covered = coverQuestions([question], chunks)
    if (covered.followUps.length > 0 && covered.cited.length === 0) {
      ordered.push({ question, answer: willConfirmAnswer(question), sourceIds: [], status: 'will_confirm' })
    } else if (covered.cited[0]) {
      const prose = (covered.cited[0].content ?? covered.cited[0].excerpt ?? '').replace(/\s+/g, ' ').trim()
      let short = prose.length > 220 ? `${prose.slice(0, 217).trim()}…` : prose
      if (/evening|after\s*7|crew window|nightly/i.test(question) && /18:30/.test(prose)) {
        short = 'Yes, nightly crews start between 18:30 and 22:00 depending on building access.'
      } else if (/green|chemical|certif|product/i.test(question) && /Green Seal/i.test(prose)) {
        const sentence = prose.match(/[^.]*Green Seal[^.]*\./i)?.[0]?.trim()
        short = sentence || short
      }
      ordered.push({
        question,
        answer: short || willConfirmAnswer(question),
        sourceIds: covered.cited.map((chunk) => chunk.slug),
        status: short ? 'answered' : 'will_confirm',
      })
    } else {
      ordered.push({ question, answer: willConfirmAnswer(question), sourceIds: [], status: 'will_confirm' })
    }
  }
  return groundQuoteAnswers(ordered, chunks)
}

export function parseQuoteDraft(raw: unknown): QuoteDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const opening = typeof data.opening === 'string' ? data.opening.trim() : ''
  const closing = typeof data.closing === 'string' ? data.closing.trim() : data.closing === null ? null : ''
  const answersRaw = data.answers
  if (!Array.isArray(answersRaw)) {
    // Allow body that is itself a JSON quote draft.
    if (typeof data.body === 'string' && data.body.trim().startsWith('{')) {
      try {
        return parseQuoteDraft(JSON.parse(data.body) as unknown)
      } catch {
        return null
      }
    }
    return null
  }
  const answers: QuoteAnswer[] = []
  for (const entry of answersRaw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    if (!question) continue
    const status = row.status === 'will_confirm' ? 'will_confirm' : 'answered'
    const answer = typeof row.answer === 'string' ? row.answer.trim() : ''
    const sourceIds = Array.isArray(row.sourceIds)
      ? row.sourceIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 8)
      : Array.isArray(row.source_ids)
        ? row.source_ids.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 8)
        : []
    answers.push({ question, answer, sourceIds, status })
  }
  if (!opening && answers.length === 0) return null
  return {
    opening: opening || 'Thank you for your inquiry. The quote is below.',
    answers,
    closing: closing || null,
  }
}

function defaultOpening(inquiry: InquiryLike): string {
  const company = inquiry.companyName?.trim()
  return company
    ? `Thank you for contacting Meridian Facilities about ${company}.`
    : 'Thank you for contacting Meridian Facilities.'
}

/** Template structured draft when the model output is missing or unusable. */
export function templateQuoteDraft(inquiry: InquiryLike, chunks: Cite[] = []): QuoteDraft {
  const answers = ensureQuoteQuestions(inquiry, [], chunks)
  return {
    opening: defaultOpening(inquiry),
    answers,
    closing: 'Please let us know if you would like to proceed with this quote.',
  }
}

function formatAnswersBlock(answers: QuoteAnswer[]): string {
  if (answers.length === 0) return ''
  const lines = answers.map((item) => {
    const text = item.status === 'will_confirm'
      ? (item.answer || willConfirmAnswer(item.question))
      : item.answer
    return `- ${text}`
  })
  return ['Your questions', ...lines].join('\n')
}

function sourcesFor(answers: QuoteAnswer[], chunks: Cite[]): string {
  const wanted = new Set(answers.flatMap((item) => item.sourceIds))
  const pool = chunks.length > 0 ? chunks : allChunks()
  const cited: Cite[] = []
  const seen = new Set<string>()
  for (const chunk of pool) {
    if (wanted.size > 0 && !wanted.has(chunk.slug)) continue
    const key = `${chunk.slug}:${chunk.heading}`
    if (seen.has(key)) continue
    // Prefer the section that matches the answer content when multiple share a slug.
    if (wanted.size === 0) continue
    seen.add(key)
    cited.push(chunk)
  }
  // If slug matched multiple headings, keep unique slugs with best heading.
  const bySlug = new Map<string, Cite>()
  for (const chunk of cited) {
    if (!bySlug.has(chunk.slug)) bySlug.set(chunk.slug, chunk)
  }
  const unique = [...bySlug.values()]
  if (unique.length === 0) return ''
  return (
    'Sources:\n' +
    unique.map((chunk, index) => `${index + 1}. ${chunk.title} — ${chunk.heading} (${chunk.slug})`).join('\n')
  )
}

/** Deterministic quote email from structured draft + quote math. */
export function assembleQuoteEmail(
  inquiry: InquiryLike,
  quote: QuoteMath & { number: string; validUntil: string },
  draft: QuoteDraft,
  chunks: Cite[] = [],
): { subject: string; body: string; purpose: 'quote'; draft: QuoteDraft } {
  const company = inquiry.companyName?.trim() || 'your site'
  const grounded = ensureQuoteQuestions(inquiry, draft.answers, chunks)
  const opening = stripMoneyWords(draft.opening) || defaultOpening(inquiry)
  const closing = draft.closing ? stripMoneyWords(draft.closing) : 'Please let us know if you would like to proceed with this quote.'
  const block = formatQuoteBlock(quote, company)
  const questions = formatAnswersBlock(grounded)
  const sources = sourcesFor(grounded, chunks)
  const parts = [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    opening,
    '',
    block,
    ...(questions ? ['', questions] : []),
    '',
    closing,
    '',
    'Meridian Facilities sales desk',
    'Cedarhaven',
    ...(sources ? ['', sources] : []),
  ]
  return {
    subject: `Quote ${quote.number} — ${company}`.slice(0, 180),
    body: parts.join('\n'),
    purpose: 'quote',
    draft: { opening, answers: grounded, closing },
  }
}

/** Build a template quote email (structured path, no raw KB dumps). */
export function composeStructuredQuoteEmail(
  inquiry: InquiryLike,
  quote: QuoteMath & { number: string; validUntil: string },
  chunks: Cite[] = [],
): { subject: string; body: string; purpose: 'quote' } {
  const assembled = assembleQuoteEmail(inquiry, quote, templateQuoteDraft(inquiry, chunks), chunks)
  return { subject: assembled.subject, body: assembled.body, purpose: 'quote' }
}

export function quoteDraftNote(before: QuoteAnswer[], after: QuoteAnswer[]): string | null {
  const downgraded = after.filter((item, index) => item.status === 'will_confirm' && before[index]?.status === 'answered')
  if (downgraded.length === 0) return null
  return `Grounding: ${downgraded.length} answer(s) downgraded to will_confirm.`
}

export { followUpSentence }
