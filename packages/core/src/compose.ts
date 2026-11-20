import { DISCOUNT_CODES } from './catalog'
import { stripInjection } from './guardrails'
import { allChunks, type KbChunk } from './kb'
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
  if (unique.length === 0) return ''
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

const TOPIC = /\b(green|hours?|evening|nightly|weekend|parking|chemicals?|certified|products|area|sla|service)\b/i

const UNANSWERED: { id: string; pattern: RegExp }[] = [
  { id: 'insurance', pattern: /\binsured\b|\binsurance\b/i },
  { id: 'background check', pattern: /\bbackground[-\s]?checked\b|\bbackground checks?\b/i },
  { id: 'guarantee', pattern: /\bguarantee[ds]?\b|\bwarrant(?:y|ies)\b/i },
  { id: 'bonded', pattern: /\bbonded\b/i },
  { id: 'licensed', pattern: /\blicen[cs]ed\b|\blicen[cs]e\b/i },
  { id: 'parking', pattern: /\bparking\b/i },
]

const TOPIC_PHRASE: Record<string, string> = {
  insurance: 'insurance',
  'background check': 'background-check details',
  guarantee: 'guarantees',
  bonded: 'bonding',
  licensed: 'licensing',
  parking: 'parking',
}

/** Names only the topics the notes do not cover. It does not invent an answer. */
export function followUpSentence(topics: string[]): string {
  const words = [...new Set(topics.map((topic) => TOPIC_PHRASE[topic]).filter((word): word is string => Boolean(word)))]
  if (words.length === 0) return "I'll confirm that and follow up."
  if (words.length === 1) return `I'll confirm our ${words[0]} and follow up.`
  const last = words[words.length - 1]
  return `I'll confirm our ${words.slice(0, -1).join(', ')} and ${last} and follow up.`
}

// Evening availability / insurance cues that TOPIC alone can miss (e.g. "after 7pm").
// Do not match bare "night" — support notes like "last night" are not hours questions.
const EXTRA_TOPIC = /\bevening\b|\bafter\s*7\b|\bnightly\b|\bcrew windows?\b|\binsured\b|\binsurance\b/i

export function inquiryQuestions(text: string): string[] {
  // Split on ? and before a follow-up question sentence so a quote line does not swallow it.
  const pieces = text
    .split(/(?<=\?)|\.(?=\s+(?:Can|Could|Do|Does|Did|Are|Is|What|When|Where|Why|How)\b)/i)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter((part) => part.length > 6)
  const questions = pieces.filter(
    (part) => part.includes('?') || TOPIC.test(part) || EXTRA_TOPIC.test(part) || UNANSWERED.some((rule) => rule.pattern.test(part)),
  )
  const split: string[] = []
  for (const question of questions) {
    const bits = question.split(/,\s*and\s+|\s+and\s+/i).map((bit) => bit.trim()).filter((bit) => bit.length > 6)
    const kept = bits.filter(
      (bit) => TOPIC.test(bit) || EXTRA_TOPIC.test(bit) || UNANSWERED.some((rule) => rule.pattern.test(bit)) || bit.includes('?'),
    )
    const useful = kept.filter(
      (bit) =>
        !(
          /\b(quote|sqft|square feet|restrooms?)\b/i.test(bit)
          && !TOPIC.test(bit)
          && !EXTRA_TOPIC.test(bit)
          && !UNANSWERED.some((rule) => rule.pattern.test(bit))
        ),
    )
    if (useful.length > 1) split.push(...useful)
    else if (
      TOPIC.test(question)
      || EXTRA_TOPIC.test(question)
      || question.includes('?')
      || UNANSWERED.some((rule) => rule.pattern.test(question))
    ) {
      if (useful.length === 1 && useful[0] !== question && /\b(quote|sqft)\b/i.test(question)) split.push(useful[0]!)
      else split.push(question)
    }
  }
  return split
}

function unansweredLabels(question: string, pool: KbChunk[]): string[] {
  const hay = pool.map((chunk) => `${chunk.heading} ${chunk.content}`).join('\n')
  return UNANSWERED.filter((rule) => rule.pattern.test(question) && !rule.pattern.test(hay)).map((rule) => rule.id)
}

function termsFor(question: string): string[] {
  const lower = question.toLowerCase()
  const base = lower.split(/[^a-z0-9]+/).filter((term) => term.length > 2)
  const extra: string[] = []
  if (/evening|night|after\s*7|work after/.test(lower)) extra.push('nightly', '18:30', 'crew', 'crews')
  if (/hour/.test(lower)) extra.push('hours', '07:00', '18:00', 'staffed')
  if (/weekend/.test(lower)) extra.push('weekend')
  if (/green|certif|product/.test(lower)) extra.push('green', 'seal', 'certified', 'chemical')
  if (/parking/.test(lower)) extra.push('parking')
  return [...base, ...extra]
}

function scoreChunk(question: string, chunk: Cite): number {
  const q = question.toLowerCase()
  const heading = `${chunk.heading} ${chunk.title}`.toLowerCase()
  const content = citeText(chunk).toLowerCase()
  const hints: [RegExp, RegExp, number][] = [
    [/evening|after\s*7|after seven|18:30|crew window|night crews|crews usually start|work after/, /crew windows/, 24],
    [/evening|after\s*7|18:30|crew window|night crews|crews usually start|work after/, /18:30/, 12],
    [/\bhours?\b|staffed|weekday/, /office hours/, 18],
    [/\bhours?\b|07:00|desk hours/, /07:00/, 10],
    [/weekend/, /weekend/, 18],
    [/green|chemical|certif|eco-?friendly|products/, /chemicals|green seal/, 18],
    [/invoice|billing/, /invoices/, 14],
    [/complaint/, /\bresponse\b/, 24],
    [/reschedule/, /scheduling changes/, 22],
    [/did not show|no-show|missed night/, /scheduling changes/, 18],
    [/sla|response time|missed visit/, /\bresponse\b/, 14],
    [/what services|services do you|offer for offices/, /services overview|nightly cleaning/, 16],
    [/out of scope|do not do|what work/, /out of scope/, 18],
    [/porter/, /day porter/, 16],
    [/carpet|refinish|project work/, /projects/, 12],
    [/service area|cedarhaven|west cedar|where do you/, /service area/, 14],
  ]
  let score = 0
  for (const [questionPattern, sectionPattern, weight] of hints) {
    if (!questionPattern.test(q)) continue
    if (sectionPattern.test(heading)) score += weight
    else if (sectionPattern.test(content)) score += Math.round(weight / 2)
  }
  const terms = termsFor(q).filter((term) => term.length > 3 && !GENERIC.has(term))
  for (const term of terms) {
    if (heading.includes(term)) score += 4
    else if (content.includes(term)) score += 1
  }
  return score
}

const GENERIC = new Set(['crew', 'crews', 'clean', 'cleaning', 'office', 'offices', 'night', 'nightly', 'service', 'services', 'meridian', 'desk', 'work', 'staff'])

function excerpt(chunk: Cite): string {
  const text = citeText(chunk).replace(/\s+/g, ' ').trim()
  return text.length > 320 ? `${text.slice(0, 320)}…` : text
}

/** Natural prose from a KB section — no raw heading dump. */
function proseFromChunk(chunk: Cite): string {
  const text = excerpt(chunk)
  if (!text) return ''
  // Keep the heading available for Sources matching without a standalone heading block.
  if (text.toLowerCase().startsWith(chunk.heading.toLowerCase())) return text
  return text
}

export function citedSections(query: string, limit = 4): Cite[] {
  const questions = inquiryQuestions(query)
  return coverQuestions(questions.length > 0 ? questions : [query]).cited.slice(0, limit)
}

export function coverQuestions(questions: string[], chunks: Cite[] = []): { text: string; cited: Cite[]; followUps: string[] } {
  const pool = dedupeChunks([...chunks, ...allChunks()])
  const cited: Cite[] = []
  const seen = new Set<string>()
  const followUps: string[] = []
  const blocks: string[] = []
  for (const question of questions) {
    const missing = unansweredLabels(question, pool as KbChunk[])
    // Evening/night crew availability alone should not pull the weekday desk "Office hours" note.
    // "What are your evening hours?" still scores both sections.
    const suppressOfficeHours = /evening|after\s*7|after seven|night crews?|crew window/i.test(question)
      && !/\bevening\s+hours?\b|\bdesk\s+hours?\b|\boffice\s+hours?\b|\bstaffed\b/i.test(question)
    const ranked = pool
      .map((chunk) => {
        let score = scoreChunk(question, chunk)
        if (suppressOfficeHours && /office hours/i.test(chunk.heading)) score = 0
        return { chunk, score }
      })
      .filter((item) => item.score >= 8)
      .sort((a, b) => b.score - a.score || a.chunk.slug.localeCompare(b.chunk.slug) || a.chunk.heading.localeCompare(b.chunk.heading))
    const picked = ranked.length === 0 ? [] : ranked.filter((item) => item.score >= ranked[0].score * 0.55).slice(0, 2)
    for (const item of picked) {
      const key = `${item.chunk.slug}:${item.chunk.heading}`
      if (seen.has(key)) continue
      seen.add(key)
      cited.push(item.chunk)
      const prose = proseFromChunk(item.chunk)
      if (prose) blocks.push(prose)
    }
    if (missing.length > 0 || picked.length === 0) {
      for (const label of missing.length > 0 ? missing : [paraphrase(question)]) followUps.push(label)
    }
  }
  const uniqueFollowUps = [...new Set(followUps)]
  if (uniqueFollowUps.length > 0) blocks.push(followUpSentence(uniqueFollowUps))
  return { text: blocks.join('\n\n'), cited, followUps: uniqueFollowUps }
}

function dedupeChunks(chunks: Cite[]): Cite[] {
  const seen = new Set<string>()
  return chunks.filter((chunk) => {
    const key = `${chunk.slug}:${chunk.heading}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Greeting, body, a citation for every quoted section, and the sales-desk sign-off. */
export function formatDeskEmail(
  inquiry: InquiryLike,
  body: string,
  chunks: Cite[],
  options?: { citeAll?: boolean },
): string {
  let text = body.replace(/\r\n/g, '\n').trim()
  text = text.replace(/^(hello|hi|hey)\b[^\n]*\n+/i, '')
  text = text.replace(/\n*Sources:\n[\s\S]*?(?=\n*Meridian Facilities|\s*$)/i, '\n')
  text = text.replace(/\n*Meridian Facilities(?: sales desk)?\nCedarhaven\s*$/i, '')
  text = text.trim()
  const flat = text.replace(/\s+/g, ' ')
  const cited = options?.citeAll
    ? dedupeChunks(chunks)
    : chunks.filter((chunk) => {
        const bite = excerpt(chunk).replace(/\s+/g, ' ')
        if (text.includes(chunk.heading)) return true
        if (bite.length >= 20 && flat.includes(bite.slice(0, 40))) return true
        return false
      })
  const sources = citationBlock(cited)
  return [
    `Hello ${firstName(inquiry.fromName)},`,
    '',
    text || 'I could not find a matching note in the Meridian knowledge base.',
    ...(sources ? ['', sources] : []),
    '',
    'Meridian Facilities sales desk',
    'Cedarhaven',
  ].join('\n')
}

export function composeAnswer(inquiry: InquiryLike, chunks: Cite[]): { subject: string; body: string; purpose: 'answer'; followUps: string[] } {
  const questions = inquiryQuestions(inquiry.body)
  const covered = coverQuestions(questions.length > 0 ? questions : inquiryQuestions(inquiry.subject).concat(inquiry.subject), chunks)
  const body = formatDeskEmail(inquiry, covered.text || followUpSentence(covered.followUps), covered.cited, { citeAll: true })
  return { subject: `Re: ${inquiry.subject}`.slice(0, 180), body, purpose: 'answer', followUps: covered.followUps }
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
    : null
  const lineText = quote.lines
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
  const extraQuestions = inquiryQuestions(inquiry.body).filter(
    (question) => TOPIC.test(question) || UNANSWERED.some((rule) => rule.pattern.test(question)) || (question.includes('?') && !/\bquotes?\b/i.test(question)),
  )
  const covered = coverQuestions(extraQuestions, chunks)
  const sections = [
    `Quote ${quote.number} for ${company} is below. It is valid through ${quote.validUntil}.`,
    lineText,
    totals,
    'Every unit price is the current Meridian rate card. This note is sent only after a Meridian operator approves it.',
    covered.text,
  ].filter((section) => section && section.trim())
  const body = sections.join('\n\n')
  return {
    subject: `Quote ${quote.number} — ${company}`.slice(0, 180),
    body: formatDeskEmail(inquiry, body, covered.cited.length > 0 ? covered.cited : chunks, {
      citeAll: covered.cited.length > 0,
    }),
    purpose: 'quote',
  }
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
