import { composeAnswer, composeClarify, composeQuoteEmail, followUpSentence, formatDeskEmail, type InquiryLike } from './compose'
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

const NEGATION = /\b(not|no|never|cannot|can't|do not|does not|don't|doesn't|without)\b/i
const ALLOW = /^(hello |hi |hey |sources:|meridian facilities|cedarhaven$|every unit price|this note is sent|the notes do not|i could not find|i can draft a quote|subtotal:|discount |tax \(|total:|quote )/i
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

/** Sentences that assert something the retrieved notes do not support. */
export function unsupportedClaims(body: string, chunks: GroundChunk[]): string[] {
  const hay = corpusOf(chunks)
  const found: string[] = []
  const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  for (let index = 0; index < lines.length; index += 1) {
    const sentence = lines[index] ?? ''
    const next = lines[index + 1] ?? ''
    if (ALLOW.test(sentence) || /^\d[\d,]*\s×\s/.test(sentence) || /^\d+\.\s/.test(sentence) || /\?\s*$/.test(sentence) || /^i'll confirm /i.test(sentence)) continue
    if (/^the notes do not answer/i.test(next)) continue
    for (const rule of RISKY) {
      if (asserts(sentence, rule.pattern) && !rule.pattern.test(hay)) found.push(rule.id)
    }
    const terms = tokens(sentence)
    if (terms.length >= 6) {
      const hits = terms.filter((term) => hay.includes(term)).length
      if (hits / terms.length < 0.45) found.push(sentence.slice(0, 90))
    }
  }
  return [...new Set(found)]
}

export type Grounding = {
  body: string
  note: string | null
  blocked: string | null
  claims: string[]
}

/**
 * Format the draft the operator will approve.
 * An unsupported claim is rewritten from the retrieved notes, or blocked for review.
 */
export function guardDraft(input: {
  inquiry: InquiryLike
  body: string
  purpose: string
  chunks: GroundChunk[]
  quote?: (QuoteMath & { number: string; validUntil: string }) | null
}): Grounding {
  const claims = unsupportedClaims(input.body, input.chunks)
  const composed = input.purpose === 'quote' || input.purpose === 'clarify' || input.purpose === 'refusal' ? null : composeAnswer(input.inquiry, input.chunks)
  if (claims.length === 0 && (!composed || composed.followUps.length === 0)) {
    const already = /Meridian Facilities sales desk\nCedarhaven\s*$/.test(input.body.trim())
    return {
      body: already ? input.body.trim() : formatDeskEmail(input.inquiry, input.body, input.chunks),
      note: null,
      blocked: null,
      claims: [],
    }
  }
  const rewritten = claims.length === 0 && composed ? composed.body : rewrite(input)
  if (!rewritten) {
    return {
      body: input.body,
      note: null,
      blocked: `Unsupported claim not in the knowledge base: ${claims.join(', ')}. Routed to review.`,
      claims,
    }
  }
  const still = unsupportedClaims(rewritten, [...input.chunks, ...allChunks()])
  if (still.length > 0) {
    return {
      body: input.body,
      note: null,
      blocked: `Unsupported claim not in the knowledge base: ${claims.join(', ')}. Routed to review.`,
      claims,
    }
  }
  const followUps = composed?.followUps ?? []
  const note = [
    claims.length > 0 ? `Grounding: unsupported claim (${claims.join(', ')}). Rewritten from the retrieved notes.` : null,
    followUps.length > 0 ? `Follow-up: ${followUpSentence(followUps)}` : null,
  ].filter(Boolean).join(' ')
  return { body: rewritten, note: note || null, blocked: null, claims }
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
