import { CURRENCY, DISCOUNT_CODES, findSku, isDiscountCode, type DiscountCode } from './catalog'

export class QuoteError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'QuoteError'
    this.code = code
  }
}

export type QuoteLineInput = { sku: string; qty: number }

export type QuoteLine = {
  sku: string
  description: string
  unit: string
  qty: number
  unitPriceCents: number
  lineTotalCents: number
}

export type QuoteMath = {
  lines: QuoteLine[]
  discountCode: DiscountCode | null
  discountBps: number
  discountCents: number
  taxBps: number
  subtotalCents: number
  taxCents: number
  totalCents: number
  currency: typeof CURRENCY
}

/** Half-up integer bps. 10000 bps = 100%. */
export function roundBps(amountCents: number, bps: number): number {
  if (!Number.isInteger(amountCents) || !Number.isInteger(bps)) {
    throw new QuoteError('non_integer', 'Amounts and basis points must be integers.')
  }
  if (amountCents < 0 || bps < 0) {
    throw new QuoteError('negative', 'Amounts and basis points cannot be negative.')
  }
  return Math.round((amountCents * bps) / 10_000)
}

export function computeQuote(input: {
  lines: QuoteLineInput[]
  discountCode?: string | null
  taxBps: number
}): QuoteMath {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new QuoteError('empty', 'A quote needs at least one catalog line.')
  }
  if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 3_000) {
    throw new QuoteError('tax', 'Tax basis points must be an integer from 0 to 3000.')
  }
  const discountCode = input.discountCode ?? null
  if (discountCode != null && !isDiscountCode(discountCode)) {
    throw new QuoteError('discount', `Unknown discount code ${discountCode}.`)
  }
  const lines: QuoteLine[] = input.lines.map((line) => {
    const item = findSku(line.sku)
    if (!item) {
      throw new QuoteError('unknown_sku', `Unknown SKU ${line.sku}. Prices come only from the catalog.`)
    }
    if (!Number.isInteger(line.qty) || line.qty <= 0 || line.qty > 1_000_000) {
      throw new QuoteError('qty', `Quantity for ${line.sku} must be a positive integer.`)
    }
    return {
      sku: item.sku,
      description: item.name,
      unit: item.unit,
      qty: line.qty,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.unitPriceCents * line.qty,
    }
  })
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
  const discountBps = discountCode ? DISCOUNT_CODES[discountCode].bps : 0
  const discountCents = roundBps(subtotalCents, discountBps)
  const taxable = subtotalCents - discountCents
  const taxCents = roundBps(taxable, input.taxBps)
  return {
    lines,
    discountCode,
    discountBps,
    discountCents,
    taxBps: input.taxBps,
    subtotalCents,
    taxCents,
    totalCents: taxable + taxCents,
    currency: CURRENCY,
  }
}

export function addDaysUtc(from: Date, days: number): string {
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new QuoteError('validity', 'Validity must be a whole number of days from 1 to 90.')
  }
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}
