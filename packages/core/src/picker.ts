import { isDiscountCode, type DiscountCode } from './catalog'
import { stripInjection } from './guardrails'

export type PickedLine = { sku: string; qty: number }

export type PickedQuote = {
  lines: PickedLine[]
  discountCode: DiscountCode | null
  note: string | null
}

function numberFrom(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

function skuForSqft(text: string, index: number, matchLength: number): string {
  const before = text.slice(Math.max(0, index - 70), index).toLowerCase()
  const carpetAt = before.lastIndexOf('carpet')
  const floorAt = Math.max(
    before.lastIndexOf('floor'),
    before.lastIndexOf('strip'),
    before.lastIndexOf('refinish'),
    before.lastIndexOf('wax'),
  )
  if (carpetAt === -1 && floorAt === -1) {
    const immediate = text.slice(index + matchLength, index + matchLength + 24).toLowerCase()
    if (/^\s*of carpet/.test(immediate)) return 'CARPET'
    if (/^\s*of (hard )?floor/.test(immediate)) return 'FLOOR-CARE'
    return 'OFFICE-CLEAN'
  }
  if (carpetAt > floorAt) return 'CARPET'
  return 'FLOOR-CARE'
}

export function pickDiscount(text: string): DiscountCode | null {
  if (/non-?profit|not-for-profit|501\s*\(?c\)?/i.test(text)) return 'NONPROFIT'
  if (/annual contract|annual service agreement|yearly agreement|12-month agreement/i.test(text)) return 'ANNUAL'
  if (/multi-?site|\b2 locations\b|\btwo locations\b|\b3 sites\b|\bthree sites\b|\bmultiple sites\b/i.test(text)) {
    return 'MULTISITE'
  }
  return null
}

export function pickQuote(raw: string): PickedQuote {
  const text = stripInjection(raw)
  const lines: PickedLine[] = []
  const sqftRe = /(\d{1,3}(?:,\d{3})+|\d+)\s*(?:sq\.?\s*ft|square feet|sqft)/gi
  for (const match of text.matchAll(sqftRe)) {
    const qty = numberFrom(match[1])
    if (!Number.isInteger(qty) || qty <= 0) continue
    lines.push({
      sku: skuForSqft(text, match.index ?? 0, match[0].length),
      qty,
    })
  }
  const restrooms = text.match(/(\d+)\s*restrooms?/i)
  if (restrooms) lines.push({ sku: 'RESTROOM', qty: Number(restrooms[1]) })
  const windows = text.match(/(\d+)\s*(?:windows|panes)/i)
  if (windows) lines.push({ sku: 'WINDOW', qty: Number(windows[1]) })
  const hours = text.match(/(\d+)\s*hours?/i)
  if (hours) {
    const sku = /after[- ]hours|emergency|call-?out/i.test(text) ? 'PORTER-OT' : 'DAY-PORTER'
    lines.push({ sku, qty: Number(hours[1]) })
  }
  if (/\bdisinfect/i.test(text)) lines.push({ sku: 'DISINFECT', qty: 1 })

  const merged = new Map<string, number>()
  for (const line of lines) merged.set(line.sku, (merged.get(line.sku) ?? 0) + line.qty)
  const discountCode = pickDiscount(text)
  const frequency = text.match(/\b(nightly|weekly|monthly|three nights a week|\d+\s*days?\s*(?:a|\/)\s*week)\b/i)
  return {
    lines: [...merged.entries()].map(([sku, qty]) => ({ sku, qty })),
    discountCode: discountCode && isDiscountCode(discountCode) ? discountCode : null,
    note: frequency
      ? `Frequency noted by the sender: ${frequency[1]}. Visit rates are per visit. Floor, carpet, and glass rates are one-time projects.`
      : null,
  }
}
