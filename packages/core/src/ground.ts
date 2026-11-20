import {
  composeAnswer,
  composeClarify,
  composeQuoteEmail,
  coverQuestions,
  followUpSentence,
  formatDeskEmail,
  inquiryQuestions,
  type InquiryLike,
} from './compose'
import { allChunks } from './kb'
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
/** Greetings, thanks, sign-offs, and honest unknowns — never treated as factual claims. */
const SAFE = /^(hello |hi |hey |thank |thanks |regards|best regards|sincerely|warm regards|sources:|meridian facilities|cedarhaven$|every unit price|this note is sent|the notes do not|i could not find|i can draft a quote|subtotal:|discount |tax \(|total:|quote |i'll confirm |we('ll| will) confirm|we do not have|we don't have|not in (our|the) (notes|knowledge|records)|i don't have|i do not have|unfortunately|please (let|find|see)|looking forward)/i
/** Only these sentences need grounding against the notes. */
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
  if (/^\d[\d,]*\s×\s/.test(sentence) || /^\d+\.\s/.test(sentence) || /\?\s*$/.test(sentence)) return true
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
    // Token overlap only on factual lines (prices, coverage, schedules, numbers).
    if (!FACTUAL.test(sentence)) continue
    const terms = tokens(sentence)
    if (terms.length >= 6) {
      const hits = terms.filter((term) => hay.includes(term)).length
      if (hits / terms.length < 0.45) found.push(sentence.slice(0, 90))
    }
  }
  return [...new Set(found)]
}

/** Drop or neutralize only the unsupported factual lines; keep the rest of the draft. */
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
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { body: cleaned, removed: [...new Set(removed)] }
}

function questionCovered(question: string, body: string): boolean {
  const lower = body.toLowerCase()
  if (/i'll confirm|we('ll| will) confirm|follow up/i.test(body) && UNANSWERED_HINT.test(question)) {
    for (const rule of [
      { id: 'insurance', pattern: /\binsured\b|\binsurance\b/i },
      { id: 'background check', pattern: /\bbackground/i },
      { id: 'guarantee', pattern: /\bguarantee|\bwarrant/i },
      { id: 'bonded', pattern: /\bbonded\b/i },
      { id: 'licensed', pattern: /\blicen/i },
      { id: 'parking', pattern: /\bparking\b/i },
    ]) {
      if (rule.pattern.test(question) && (rule.pattern.test(body) || lower.includes("i'll confirm") || lower.includes('follow up'))) {
        if (rule.id === 'insurance' && /confirm our insurance|confirm .*insurance|insurance and follow/i.test(body)) return true
        if (rule.id !== 'insurance' && new RegExp(rule.id.split(' ')[0]!, 'i').test(body)) return true
      }
    }
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
  // Generic: confirm phrase or shared content words
  if (/i'll confirm|we('ll| will) confirm|follow up|do not have|don't have|not in (our|the) notes/i.test(body)) {
    const words = tokens(question).filter((term) => term.length > 4)
    if (words.some((term) => lower.includes(term))) return true
  }
  const words = tokens(question).filter((term) => term.length > 4)
  const hits = words.filter((term) => lower.includes(term)).length
  return words.length > 0 && hits / words.length >= 0.4
}

const UNANSWERED_HINT = /\binsured\b|\binsurance\b|\bbackground|\bguarantee|\bbonded\b|\blicen|\bparking\b/i

/** Questions from the inquiry that the draft does not yet answer or mark for follow-up. */
export function uncoveredQuestions(inquiry: InquiryLike, body: string): string[] {
  const questions = inquiryQuestions(inquiry.body)
  const fallback = questions.length > 0 ? questions : inquiryQuestions(inquiry.subject)
  return fallback.filter((question) => !questionCovered(question, body))
}

function appendCoverage(body: string, inquiry: InquiryLike, missing: string[], chunks: GroundChunk[]): string {
  if (missing.length === 0) return body
  const covered = coverQuestions(missing, chunks)
  let text = body.replace(/\r\n/g, '\n').trim()
  text = text.replace(/\n*Sources:\n[\s\S]*?(?=\n*Meridian Facilities|\s*$)/i, '\n').trim()
  text = text.replace(/\n*Meridian Facilities(?: sales desk)?\nCedarhaven\s*$/i, '').trim()
  const addition = covered.text.trim()
  if (!addition) return body
  return `${text}\n\n${addition}`
}

function isUsableDraft(body: string, purpose: string): boolean {
  const text = body
    .replace(/^(hello|hi|hey)\b[^\n]*\n+/i, '')
    .replace(/\n*Sources:\n[\s\S]*$/i, '')
    .replace(/\n*Meridian Facilities(?: sales desk)?\nCedarhaven\s*$/i, '')
    .replace(/\n*To stop all contact:[\s\S]*$/i, '')
    .trim()
  if (text.length < 40) return false
  const substance = text.split(/\n+/).map((line) => line.trim()).filter((line) => line && !isSafeLine(line) || /confirm|18:30|07:00|quote |subtotal|total:|crew/i.test(line))
  if (substance.length === 0) return false
  if (purpose === 'quote' && !/quote |subtotal|total:|\d[\d,]*\s×/i.test(text)) return false
  return true
}

export type Grounding = {
  body: string
  note: string | null
  blocked: string | null
  claims: string[]
}

/**
 * Format the draft the operator will approve.
 * Unsupported factual sentences are removed; the rest of the model draft is kept.
 * Template fallback runs only when the remaining draft is unusable.
 */
export function guardDraft(input: {
  inquiry: InquiryLike
  body: string
  purpose: string
  chunks: GroundChunk[]
  quote?: (QuoteMath & { number: string; validUntil: string }) | null
}): Grounding {
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
    working = appendCoverage(working, input.inquiry, missing, input.chunks)
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

  const rewritten = rewrite(input)
  if (!rewritten) {
    // Refusal/clarify have no template rebuild — keep a still-usable body, otherwise review.
    if ((input.purpose === 'refusal' || input.purpose === 'clarify') && isUsableDraft(input.body, input.purpose)) {
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
  const still = unsupportedClaims(rewritten, [...input.chunks, ...allChunks()])
  if (still.length > 0) {
    return {
      body: input.body,
      note: null,
      blocked: `Unsupported claim not in the knowledge base: ${removed.join(', ') || still.join(', ')}. Routed to review.`,
      claims: removed,
    }
  }
  const followUps = input.purpose === 'quote' || input.purpose === 'clarify' || input.purpose === 'refusal'
    ? []
    : composeAnswer(input.inquiry, input.chunks).followUps
  const note = [
    removed.length > 0 || claims.length > 0
      ? `Grounding: unsupported claim (${(removed.length ? removed : claims).join(', ')}). Rewritten from the retrieved notes.`
      : 'Grounding: draft was unusable after repair. Rewritten from the retrieved notes.',
    followUps.length > 0 ? `Follow-up: ${followUpSentence(followUps)}` : null,
  ].filter(Boolean).join(' ')
  return { body: rewritten, note: note || null, blocked: null, claims: removed }
}

function rewrite(input: { inquiry: InquiryLike; purpose: string; chunks: GroundChunk[]; quote?: (QuoteMath & { number: string; validUntil: string }) | null }): string | null {
  if (input.purpose === 'quote') {
    if (!input.quote) return null
    return composeQuoteEmail(input.inquiry, input.quote, input.chunks).body
  }
  if (input.purpose === 'clarify') return composeClarify(input.inquiry).body
  if (input.purpose === 'refusal') return null
  return composeAnswer(input.inquiry, input.chunks).body
}
