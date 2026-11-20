export type KbDoc = {
  slug: string
  title: string
  body: string
}

export type KbChunk = {
  slug: string
  title: string
  heading: string
  content: string
  ordinal: number
}

export const KB_DOCS: KbDoc[] = [
  {
    slug: 'services-overview',
    title: 'Services overview',
    body: `Meridian Facilities cleans commercial workplaces in Cedarhaven. The desk quotes from the published rate card only.

## Nightly cleaning
Night crews clean offices, kitchens, and common areas after the building closes. The nightly rate is charged per square foot of cleanable area, per visit. Desks are dusted, floors are vacuumed or damp-mopped, and trash is removed.

## Day porter
A day porter stays on site during open hours for spills, restrooms, and conference resets. Porter time is billed by the hour from the rate card.

## Projects
Floor strip and refinish, interior glass, and carpet extraction are one-time projects. They are not included in the nightly visit rate.

## What a quote includes
A quote lists each rate-card line, one discount code if the sender qualifies, Cedarhaven tax, and a validity date. The desk does not estimate a price when quantities are missing.`,
  },
  {
    slug: 'service-area-and-hours',
    title: 'Service area and hours',
    body: `Meridian Facilities works in the Cedarhaven metro only.

## Service area
Crews cover Cedarhaven proper and the inner ring: West Cedar, Old Wharf, and Lantern Hill. Sites outside that ring are declined.

## Office hours
The desk is staffed 07:00–18:00 on weekdays, Cedarhaven time. There is no weekend desk coverage.

## Crew windows
Nightly crews start between 18:30 and 22:00 depending on building access. Day porters arrive at the open of business. After-hours emergency cleans are a separate rate-card line, not a change to the nightly rate.

## Scheduling changes
Reschedules requested before 14:00 on a weekday can be applied the same night. A no-show, or a crew that did not show, is rescheduled before any other change is discussed. Later requests move to the next staffed day.`,
  },
  {
    slug: 'green-cleaning',
    title: 'Green cleaning',
    body: `Meridian uses a fixed list of Green Seal certified chemicals for routine commercial work.

## Chemicals
Glass, neutral floor cleaner, and restroom disinfectant are Green Seal certified. The desk does not accept customer-supplied chemicals on a standard visit.

## High-touch add-on
High-touch disinfection is an add-on visit line on the rate card. It uses the same disinfectant, applied to doors, switches, and shared appliances.

## What green cleaning is not
Green certification is not a claim about air quality, infection control, or medical sanitation. Those requests are outside the service.`,
  },
  {
    slug: 'contracts-billing-sla',
    title: 'Contracts, billing, and response',
    body: `Billing and response times for current customers.

## Invoices
Invoices go out on the first weekday of the month for the previous month’s visits and any project work. A copy can be sent to the billing contact on the account.

## Billing details
Address and accounts-payable contact changes are taken from the customer of record. The desk confirms the change in writing before the next invoice.

## Contract term
Standard service agreements renew month to month after the first 90 days. An annual service agreement is the only agreement that carries the annual discount on the rate card. Nonprofit organizations use the nonprofit discount instead of the annual discount. Two or more sites on one agreement use the multi-site discount when neither of the other codes applies.

## Response
The desk answers existing-customer billing and scheduling notes on the next staffed weekday. That reply window is the SLA. A complaint about a missed visit or a crew that did not show is answered there, and the visit is rescheduled before a credit is discussed. Credits are not calculated by the agent.`,
  },
  {
    slug: 'exclusions',
    title: 'Work Meridian does not do',
    body: `Some requests look similar to cleaning and are still out of scope.

## Out of scope
Meridian does not do residential cleaning, asbestos, mold remediation, biohazard, medical waste, construction final clean, or exterior high-rise glass.

## Advice Meridian does not give
The desk does not give legal advice, medical advice, or employment advice, and it does not write software or handle loans.

## How a refusal is written
A refusal names the boundary and points the sender back to commercial workplace cleaning in Cedarhaven. It does not invent a price for the declined work.`,
  },
]

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'our', 'with', 'what', 'are', 'how', 'does', 'this', 'that', 'from', 'have', 'can'])

export function chunkDocument(doc: KbDoc): KbChunk[] {
  const parts = doc.body.split(/^## /m)
  const chunks: KbChunk[] = []
  const intro = parts[0]?.trim()
  if (intro) {
    chunks.push({ slug: doc.slug, title: doc.title, heading: doc.title, content: intro, ordinal: 0 })
  }
  parts.slice(1).forEach((part, index) => {
    const [headingLine, ...rest] = part.split('\n')
    const content = rest.join('\n').trim()
    if (!content) return
    chunks.push({
      slug: doc.slug,
      title: doc.title,
      heading: headingLine.trim(),
      content,
      ordinal: index + 1,
    })
  })
  return chunks
}

export function allChunks(docs: KbDoc[] = KB_DOCS): KbChunk[] {
  return docs.flatMap((doc) => chunkDocument(doc))
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !STOP.has(term))
}

export type ScoredChunk = KbChunk & { score: number }

export function searchChunks(chunks: KbChunk[], query: string, limit = 4): ScoredChunk[] {
  const terms = tokenize(query)
  return chunks
    .map((chunk) => {
      const hay = tokenize(`${chunk.heading} ${chunk.content} ${chunk.title}`)
      let score = 0
      for (const term of terms) {
        const count = hay.filter(
        (token) => token === term || (term.length >= 5 && token.length >= 5 && (token.startsWith(term) || term.startsWith(token))),
      ).length
        const headingHit = chunk.heading.toLowerCase().includes(term) ? 2 : 0
        score += count + headingHit
      }
      return { ...chunk, score }
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug) || a.ordinal - b.ordinal)
    .slice(0, limit)
}

export function searchKb(query: string, docs: KbDoc[] = KB_DOCS, limit = 4): ScoredChunk[] {
  return searchChunks(allChunks(docs), query, limit)
}
