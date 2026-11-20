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

function sources(chunks: Cite[]): string {
  if (chunks.length === 0) return 'Sources:\n1. Work Meridian does not do — Out of scope (exclusions)'
  return (
    'Sources:\n' +
    chunks
      .slice(0, 3)
      .map((chunk, index) => `${index + 1}. ${chunk.title} — ${chunk.heading} (${chunk.slug})`)
      .join('\n')
  )
}

export function composeAnswer(inquiry: InquiryLike, chunks: Cite[]): { subject: string; body: string; purpose: 'answer' } {
  const excerpts = chunks
    .slice(0, 2)
    .map((chunk) => citeText(chunk))
    .filter(Boolean)
    .join('\n\n')
  const body = [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    excerpts || 'I could not find a matching note in the Meridian knowledge base.',
    '',
    sources(chunks),
    '',
    'Meridian Facilities',
    'Cedarhaven',
  ].join('\n')
  return { subject: `Re: ${inquiry.subject}`.slice(0, 180), body, purpose: 'answer' }
}

export function composeRefusal(inquiry: InquiryLike, chunks: Cite[]): { subject: string; body: string; purpose: 'refusal' } {
  const body = [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    'Meridian Facilities cannot take this request. We clean commercial workplaces in Cedarhaven. We do not take residential work, asbestos, mold remediation, biohazard, medical waste, or requests for legal, medical, or software help, and we do not price work that is outside that boundary.',
    '',
    chunks[0] ? citeText(chunks[0]) : '',
    '',
    sources(chunks.length ? chunks : []),
    '',
    'Meridian Facilities',
    'Cedarhaven',
  ]
    .filter((line) => line !== '')
    .join('\n')
  return { subject: `Re: ${inquiry.subject}`.slice(0, 180), body, purpose: 'refusal' }
}

export function composeClarify(inquiry: InquiryLike): { subject: string; body: string; purpose: 'clarify' } {
  const body = [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    'I can draft a quote from the Meridian rate card once the quantities are in the note: cleanable square feet, restroom count, interior panes, porter hours, or a named project. I will not estimate a price without them.',
    '',
    'Meridian Facilities',
    'Cedarhaven',
  ].join('\n')
  return { subject: `Re: ${inquiry.subject}`.slice(0, 180), body, purpose: 'clarify' }
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
    chunks.length ? sources(chunks) : '',
    '',
    'Meridian Facilities',
    'Cedarhaven',
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n')
  return { subject: `Quote ${quote.number} — ${company}`.slice(0, 180), body, purpose: 'quote' }
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
