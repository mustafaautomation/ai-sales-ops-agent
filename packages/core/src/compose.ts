import { DISCOUNT_CODES } from './catalog'
import { stripInjection } from './guardrails'
import { formatMoney, type QuoteMath } from './quote'

type Cite = {
  slug: string
  title: string
  heading: string
  content?: string
  excerpt?: string
}

function citeText(chunk: Cite): string {
  return (chunk.content ?? chunk.excerpt ?? '').trim()
}

export type InquiryLike = {
  fromName: string
  fromEmail: string
  companyName: string | null
  subject: string
  body: string
}

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0]
  return part || 'there'
}

function citationBlock(chunks: Cite[]): string {
  const seen = new Set<string>()
  const unique = chunks.filter((chunk) => {
    const key = `${chunk.slug}:${chunk.heading}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (unique.length === 0) return 'Sources:\nThe notes do not cover this.'
  return (
    'Sources:\n' +
    unique.map((chunk, index) => `${index + 1}. ${chunk.title} — ${chunk.heading} (${chunk.slug})`).join('\n')
  )
}

function paraphrase(question: string): string {
  let text = question.replace(/\s+/g, ' ').trim()
  text = text.replace(/^(hi|hello|hey)[,!\s]+/i, '')
  const tail = text.includes(',') ? (text.split(',').pop() ?? text).trim() : text
  text = (tail.length >= 8 ? tail : text).replace(/[?\s]+$/g, '').trim()
  if (text.length > 80) text = `${text.slice(0, 77).trim()}…`
  if (!text) return 'Your question'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const TOPIC = /\b(green|hours?|evening|night|weekend|parking|chemicals?|certified|products|area|sla|service)\b/i

export function inquiryQuestions(text: string): string[] {
  const pieces = text.split(/(?<=\?)/).map((part) => part.trim()).filter((part) => part.length > 6)
  const questions = pieces.filter((part) => part.includes('?') || TOPIC.test(part))
  const split: string[] = []
  for (const question of questions) {
    const bits = question.split(/,\s*and\s+|\s+and\s+/i).map((bit) => bit.trim()).filter((bit) => bit.length > 6)
    const kept = bits.filter((bit) => TOPIC.test(bit) && !(/\b(quote|sqft|square feet)\b/i.test(bit) && !/\b(green|certif|hour|evening|weekend|parking)\b/i.test(bit)))
    if (kept.length > 0) split.push(...kept)
    else if (TOPIC.test(question) || question.includes('?')) split.push(question)
  }
  return split
}

function termsFor(question: string): string[] {
  const lower = question.toLowerCase()
  const base = lower.split(/[^a-z0-9]+/).filter((term) => term.length > 2)
  const extra: string[] = []
  if (/evening|night/.test(lower)) extra.push('nightly', '18:30', 'crew', 'crews')
  if (/hour/.test(lower)) extra.push('hours', '07:00', '18:00', 'staffed')
  if (/weekend/.test(lower)) extra.push('weekend')
  if (/green|certif|product/.test(lower)) extra.push('green', 'seal', 'certified', 'chemical')
  if (/parking/.test(lower)) extra.push('parking')
  return [...base, ...extra]
}

function scoreChunk(question: string, chunk: Cite): number {
  const hay = `${chunk.title} ${chunk.heading} ${citeText(chunk)}`.toLowerCase()
  return termsFor(question).reduce((score, term) => score + (hay.includes(term) ? 1 : 0), 0)
}

function excerpt(chunk: Cite): string {
  const text = citeText(chunk).replace(/\s+/g, ' ').trim()
  return text.length > 320 ? `${text.slice(0, 320)}…` : text
}

export function coverQuestions(questions: string[], chunks: Cite[]): { text: string; cited: Cite[] } {
  const cited: Cite[] = []
  const blocks = questions.map((question) => {
    const ranked = chunks
      .map((chunk) => ({ chunk, score: scoreChunk(question, chunk) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.slug.localeCompare(b.chunk.slug))
    if (ranked.length === 0) return `${paraphrase(question)}\nThe notes do not answer this.`
    return ranked.slice(0, 2).map((item) => {
      cited.push(item.chunk)
      return `${item.chunk.heading}\n${excerpt(item.chunk)}`
    }).join('\n\n')
  })
  return { text: blocks.join('\n\n'), cited }
}

/** Greeting, body, a citation for every quoted section, and the sales-desk sign-off. */
export function formatDeskEmail(inquiry: InquiryLike, body: string, chunks: Cite[]): string {
  let text = body.replace(/\r\n/g, '\n').trim()
  text = text.replace(/^(hello|hi|hey)\b[^\n]*\n+/i, '')
  text = text.replace(/\n*Sources:\n[\s\S]*?(?=\n*Meridian Facilities|\s*$)/i, '\n')
  text = text.replace(/\n*Meridian Facilities(?: sales desk)?\nCedarhaven\s*$/i, '')
  text = text.trim()
  const cited = chunks.filter((chunk) => text.includes(chunk.heading) || text.includes(excerpt(chunk).slice(0, 48)))
  return [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    text || 'I could not find a matching note in the Meridian knowledge base.',
    '',
    citationBlock(cited),
    '',
    'Meridian Facilities sales desk',
    'Cedarhaven',
  ].join('\n')
}

export function composeAnswer(inquiry: InquiryLike, chunks: Cite[]): { subject: string; body: string; purpose: 'answer' } {
  const questions = inquiryQuestions(`${inquiry.subject}\n${inquiry.body}`)
  const covered = coverQuestions(questions.length > 0 ? questions : [inquiry.subject], chunks)
  const body = formatDeskEmail(inquiry, covered.text || 'I could not find a matching note in the Meridian knowledge base.', covered.cited.length > 0 ? covered.cited : chunks)
  return { subject: `Re: ${inquiry.subject}`.slice(0, 180), body, purpose: 'answer' }
}

export function composeRefusal(inquiry: InquiryLike, chunks: Cite[]): { subject: string; body: string; purpose: 'refusal' } {
  const body = [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    'Meridian Facilities cannot take this request. We clean commercial workplaces in Cedarhaven. We do not take residential work, asbestos, mold remediation, biohazard, medical waste, or requests for legal, medical, or software help, and we do not price work that is outside that boundary.',
    '',
    chunks[0] ? citeText(chunks[0]) : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
  return { subject: `Re: ${inquiry.subject}`.slice(0, 180), body: formatDeskEmail(inquiry, body, chunks), purpose: 'refusal' }
}

export function composeClarify(inquiry: InquiryLike): { subject: string; body: string; purpose: 'clarify' } {
  const body = [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    'I can draft a quote from the Meridian rate card once the quantities are in the note: cleanable square feet, restroom count, interior panes, porter hours, or a named project. I will not estimate a price without them.',
    '',
  ].join('\n')
  return { subject: `Re: ${inquiry.subject}`.slice(0, 180), body: formatDeskEmail(inquiry, body, []), purpose: 'clarify' }
}

export function composeQuoteEmail(
  inquiry: InquiryLike,
  quote: QuoteMath & { number: string; validUntil: string },
  chunks: Cite[] = [],
): { subject: string; body: string; purpose: 'quote' } {
  const company = inquiry.companyName?.trim() || 'your site'
  const discountLabel = quote.discountCode
    ? `${DISCOUNT_CODES[quote.discountCode].label} (${(quote.discountBps / 100).toFixed(0)}%)`
    : 'none'
  const lineText = quote.lines
    .map(
      (line) =>
        `${line.qty} × ${line.description} (${line.sku}) @ ${formatMoney(line.unitPriceCents)} = ${formatMoney(line.lineTotalCents)}`,
    )
    .join('\n')
  const body = [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    `Quote ${quote.number} for ${company} is below. It is valid through ${quote.validUntil}.`,
    '',
    lineText,
    '',
    `Subtotal: ${formatMoney(quote.subtotalCents)}`,
    `Discount (${discountLabel}): ${formatMoney(quote.discountCents)}`,
    `Tax (${(quote.taxBps / 100).toFixed(2)}%): ${formatMoney(quote.taxCents)}`,
    `Total: ${formatMoney(quote.totalCents)}`,
    '',
    'Every unit price is the current Meridian rate card. This note is sent only after a Meridian operator approves it.',
    '',
    coverQuestions(inquiryQuestions(inquiry.body).filter((question) => TOPIC.test(question) || (question.includes('?') && !/\bquotes?\b/i.test(question))), chunks).text,
  ].filter((line) => line !== '').join('\n\n')
  return { subject: `Quote ${quote.number} — ${company}`.slice(0, 180), body: formatDeskEmail(inquiry, body, chunks), purpose: 'quote' }
}

export function companyFrom(inquiry: InquiryLike): string {
  if (inquiry.companyName?.trim()) return cleanName(inquiry.companyName)
  const match = stripInjection(inquiry.body).match(/^Company:\s*(.+)$/im)
  if (match) return cleanName(match[1])
  return cleanName(inquiry.fromName) || 'Unknown company'
}

function cleanName(value: string): string {
  return value.trim().replace(/[^\w&.'’ -]/g, '').replace(/\s+/g, ' ').slice(0, 120)
}
