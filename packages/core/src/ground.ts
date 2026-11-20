import {
  composeAnswer,
  composeClarify,
  coverQuestions,
  followUpSentence,
  formatDeskEmail,
  inquiryQuestions,
  type InquiryLike,
} from './compose'
import { allChunks } from './kb'
import {
  assembleQuoteEmail,
  composeStructuredQuoteEmail,
  parseQuoteDraft,
  quoteDraftNote,
  templateQuoteDraft,
  type QuoteAnswer,
} from './quote-email'
import type { QuoteMath } from './quote'

export type GroundChunk = { slug: string; title: string; heading: string; content?: string; excerpt?: string }

const RISKY: { id: string; pattern: RegExp }[] = [
  { id: 'insurance', pattern: /\binsured\b|\binsurance\b/i },
  { id: 'background check', pattern: /\bbackground[-\s]?checked\b|\bbackground checks?\b/i },
  { id: 'guarantee', pattern: /\bguarantee[ds]?\b|\bwarrant(?:y|ies)\b/i },
  { id: 'bonded', pattern: /\bbonded\b/i },
  { id: 'licensed', pattern: /\blicen[cs]ed\b|\blicen[cs]e\b/i },
  { id: 'always on', pattern: /\b24\s*\/\s*7\b|\baround the clock\b/i },
  { id: 'certification', pattern: /\bcertifications?\b|\bcertified\b/i },
]

const NEGATION = /\b(not|no|never|cannot|can't|do not|does not|don't|doesn't|without|do not have|don't have|unable|unavailable|unclear|unknown)\b/i
const SAFE = /^(hello |hi |hey |thank |thanks |regards|best regards|sincerely|warm regards|sources:|meridian facilities|cedarhaven$|every unit price|this note is sent|the notes do not|i could not find|i can draft a quote|subtotal:|discount |tax \(|total:|quote |i'll confirm |we('ll| will) confirm|we do not have|we don't have|not in (our|the) (notes|knowledge|records)|i don't have|i do not have|unfortunately|please (let|find|see)|looking forward|your questions)/i
const FACTUAL = /\b(\d|\$|usd|price|priced|rate card|insured|insurance|certified|certification|guarantee|guaranteed|licensed|licence|license|bonded|24\s*\/\s*7|coverage|sq\.?\s*ft|sqft|restrooms?|valid through|discount|subtotal|tax\b)/i
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'are', 'was', 'were', 'been', 'have', 'has', 'not', 'but', 'you', 'our', 'their', 'they', 'will', 'into', 'over', 'than', 'then', 'also', 'each', 'per', 'its', 'can', 'may', 'after', 'before', 'only', 'when', 'what', 'which', 'about', 'does', 'did', 'using', 'used', 'them', 'these', 'those'])

function corpusOf(chunks: GroundChunk[]): string {
  return chunks.map((chunk) => `${chunk.title}\n${chunk.heading}\n${chunk.content ?? ''}\n${chunk.excerpt ?? ''}`).join('\n').toLowerCase()
}

function asserts(sentence: string, pattern: RegExp): boolean {
  if (!pattern.test(sentence)) return false
  return !NEGATION.test(sentence)
}

function tokens(sentence: string): string[] {
  return (sentence.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((term) => !STOP.has(term))
}

function isSafeLine(sentence: string): boolean {
  if (SAFE.test(sentence)) return true
  if (/^\d[\d,]*\s×\s/.test(sentence) || /^\d+\.\s/.test(sentence) || /\?\s*$/.test(sentence) || /^- /.test(sentence)) return true
  if (/^i'll confirm /i.test(sentence) || /we('ll| will) confirm/i.test(sentence)) return true
  if (/do not have|don't have|not in (our|the) (notes|knowledge|records)|notes do not|could not find|unable to (confirm|find)/i.test(sentence)) return true
  return false
}

/** Sentences that assert something the retrieved notes do not support. */
export function unsupportedClaims(body: string, chunks: GroundChunk[]): string[] {
  const hay = corpusOf(chunks)
  const found: string[] = []
  const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  for (let index = 0; index < lines.length; index += 1) {
    const sentence = lines[index] ?? ''
    const next = lines[index + 1] ?? ''
    if (isSafeLine(sentence)) continue
    if (/^the notes do not answer/i.test(next)) continue
    for (const rule of RISKY) {
      if (asserts(sentence, rule.pattern) && !rule.pattern.test(hay)) found.push(rule.id)
    }
    if (!FACTUAL.test(sentence)) continue
    const terms = tokens(sentence)
    if (terms.length >= 6) {
      const hits = terms.filter((term) => hay.includes(term)).length
      if (hits / terms.length < 0.45) found.push(sentence.slice(0, 90))
    }
  }
  return [...new Set(found)]
}

export function stripUnsupportedSentences(body: string, chunks: GroundChunk[]): { body: string; removed: string[] } {
  const hay = corpusOf(chunks)
  const removed: string[] = []
  const kept: string[] = []
  for (const raw of body.split(/\n/)) {
    const sentence = raw.trim()
    if (!sentence) {
      kept.push(raw)
      continue
    }
    if (isSafeLine(sentence)) {
      kept.push(raw)
      continue
    }
    let bad = false
    for (const rule of RISKY) {
      if (asserts(sentence, rule.pattern) && !rule.pattern.test(hay)) {
        bad = true
        removed.push(rule.id)
        break
      }
    }
    if (!bad && FACTUAL.test(sentence)) {
      const terms = tokens(sentence)
      if (terms.length >= 6) {
        const hits = terms.filter((term) => hay.includes(term)).length
        if (hits / terms.length < 0.45) {
          bad = true
          removed.push(sentence.slice(0, 90))
        }
      }
    }
    if (!bad) kept.push(raw)
  }
  return { body: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed: [...new Set(removed)] }
}

function questionCovered(question: string, body: string): boolean {
  const lower = body.toLowerCase()
  if (/i'll confirm|we('ll| will) confirm|follow up/i.test(body) && /\binsured\b|\binsurance\b|\bbackground|\bguarantee|\bbonded\b|\blicen|\bparking\b/i.test(question)) {
    if (/\binsurance\b|\binsured\b/i.test(question) && /insurance|confirm/i.test(body)) return true
    if (/\bparking\b/i.test(question) && /parking|confirm/i.test(body)) return true
  }
  if (/\binsured\b|\binsurance\b/i.test(question)) {
    return /insurance|insured/i.test(body) && (/confirm|follow up|do not have|don't have|not in/i.test(body) || !asserts(body, /\binsured\b/i))
  }
  if (/evening|after\s*7|18:30|nightly crew|crew window/i.test(question)) {
    return /18:30|22:00|crew window|nightly crews?/i.test(body)
  }
  if (/\bhours?\b|staffed|weekday desk/i.test(question) && !/evening|after\s*7|nightly/i.test(question)) {
    return /07:00|18:00|office hours|staffed/i.test(body)
  }
  if (/weekend/i.test(question)) return /weekend/i.test(body)
  if (/green|certif|chemical|eco-?friendly|products/i.test(question)) return /green seal|certified|chemical/i.test(body)
  if (/parking/i.test(question)) return /parking|confirm/i.test(body)
  const words = tokens(question).filter((term) => term.length > 4)
  const hits = words.filter((term) => lower.includes(term)).length
  return words.length > 0 && hits / words.length >= 0.4
}

export function uncoveredQuestions(inquiry: InquiryLike, body: string): string[] {
  const questions = inquiryQuestions(inquiry.body)
  const fallback = questions.length > 0 ? questions : inquiryQuestions(inquiry.subject)
  return fallback.filter((question) => !questionCovered(question, body))
}

function isUsableDraft(body: string, purpose: string): boolean {
  const text = body
    .replace(/^(hello|hi|hey)\b[^\n]*\n+/i, '')
    .replace(/\n*Sources:\n[\s\S]*$/i, '')
    .replace(/\n*Meridian Facilities(?: sales desk)?\nCedarhaven\s*$/i, '')
    .replace(/\n*To stop all contact:[\s\S]*$/i, '')
    .trim()
  if (text.length < 40) return false
  if (purpose === 'quote' && !/quote |subtotal|total:|\d[\d,]*\s×/i.test(text)) return false
  return true
}

export type Grounding = {
  body: string
  note: string | null
  blocked: string | null
  claims: string[]
}

function guardQuote(input: {
  inquiry: InquiryLike
  body: string
  chunks: GroundChunk[]
  quote: QuoteMath & { number: string; validUntil: string }
  structured?: Record<string, unknown> | null
}): Grounding {
  const parsed = parseQuoteDraft(input.structured ?? { body: input.body }) ?? parseQuoteDraft({ body: input.body })
  if (!parsed) {
    const template = composeStructuredQuoteEmail(input.inquiry, input.quote, input.chunks)
    return {
      body: template.body,
      note: 'Grounding: structured quote draft missing or unusable. Assembled from the template.',
      blocked: null,
      claims: [],
    }
  }
  const before = parsed.answers.map((item) => ({ ...item }))
  const assembled = assembleQuoteEmail(input.inquiry, input.quote, parsed, input.chunks)
  const note = quoteDraftNote(before, assembled.draft.answers)
  return { body: assembled.body, note, blocked: null, claims: note ? ['will_confirm'] : [] }
}

/**
 * Format the draft the operator will approve.
 * Quote purpose uses structured answers; unsupported answers become will_confirm.
 */
export function guardDraft(input: {
  inquiry: InquiryLike
  body: string
  purpose: string
  chunks: GroundChunk[]
  quote?: (QuoteMath & { number: string; validUntil: string }) | null
  structured?: Record<string, unknown> | null
}): Grounding {
  if (input.purpose === 'quote') {
    if (!input.quote) {
      return {
        body: input.body,
        note: null,
        blocked: 'Unsupported claim not in the knowledge base: quote. Routed to review.',
        claims: ['quote'],
      }
    }
    return guardQuote({
      inquiry: input.inquiry,
      body: input.body,
      chunks: input.chunks,
      quote: input.quote,
      structured: input.structured,
    })
  }

  const claims = unsupportedClaims(input.body, input.chunks)
  let working = input.body
  let removed = claims
  const skipCoverage = input.purpose === 'refusal' || input.purpose === 'clarify'

  if (claims.length > 0) {
    const stripped = stripUnsupportedSentences(working, input.chunks)
    working = stripped.body
    removed = stripped.removed.length > 0 ? stripped.removed : claims
  }

  const missing = skipCoverage ? [] : uncoveredQuestions(input.inquiry, working)
  if (missing.length > 0) {
    const covered = coverQuestions(missing, input.chunks)
    working = working
      .replace(/\n*Sources:\n[\s\S]*?(?=\n*Meridian Facilities|\s*$)/i, '\n')
      .replace(/\n*Meridian Facilities(?: sales desk)?\nCedarhaven\s*$/i, '')
      .trim()
    if (covered.text.trim()) working = `${working}\n\n${covered.text.trim()}`
  }

  const stillMissing = skipCoverage ? [] : uncoveredQuestions(input.inquiry, working)
  const usable = isUsableDraft(working, input.purpose) && stillMissing.length === 0

  if (usable) {
    const already = /Meridian Facilities sales desk\nCedarhaven\s*$/.test(working.trim())
    const cite = input.chunks.length > 0 ? input.chunks : allChunks()
    const body = already ? working.trim() : formatDeskEmail(input.inquiry, working, cite)
    const noteParts = [
      removed.length > 0 ? `Grounding: unsupported claim (${removed.join(', ')}). Removed unsupported sentences; kept the rest of the draft.` : null,
      missing.length > 0 ? `Follow-up: covered ${missing.length} unanswered question(s).` : null,
    ].filter(Boolean)
    return { body, note: noteParts.join(' ') || null, blocked: null, claims: removed }
  }

  if (input.purpose === 'clarify') {
    return { body: composeClarify(input.inquiry).body, note: 'Grounding: draft was unusable after repair. Rewritten from the retrieved notes.', blocked: null, claims: removed }
  }
  if (input.purpose === 'refusal') {
    if (isUsableDraft(input.body, input.purpose)) {
      const already = /Meridian Facilities sales desk\nCedarhaven\s*$/.test(input.body.trim())
      return {
        body: already ? input.body.trim() : formatDeskEmail(input.inquiry, input.body, input.chunks),
        note: removed.length > 0 ? `Grounding: unsupported claim (${removed.join(', ')}).` : null,
        blocked: null,
        claims: removed,
      }
    }
    return {
      body: input.body,
      note: null,
      blocked: `Unsupported claim not in the knowledge base: ${removed.join(', ') || 'unusable draft'}. Routed to review.`,
      claims: removed,
    }
  }

  const rewritten = composeAnswer(input.inquiry, input.chunks)
  const still = unsupportedClaims(rewritten.body, [...input.chunks, ...allChunks()])
  if (still.length > 0) {
    return {
      body: input.body,
      note: null,
      blocked: `Unsupported claim not in the knowledge base: ${removed.join(', ') || still.join(', ')}. Routed to review.`,
      claims: removed,
    }
  }
  const note = [
    removed.length > 0 || claims.length > 0
      ? `Grounding: unsupported claim (${(removed.length ? removed : claims).join(', ')}). Rewritten from the retrieved notes.`
      : 'Grounding: draft was unusable after repair. Rewritten from the retrieved notes.',
    rewritten.followUps.length > 0 ? `Follow-up: ${followUpSentence(rewritten.followUps)}` : null,
  ].filter(Boolean).join(' ')
  return { body: rewritten.body, note: note || null, blocked: null, claims: removed }
}

export type { QuoteAnswer }
export { templateQuoteDraft, parseQuoteDraft }
