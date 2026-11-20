export const TAX_BPS_DEFAULT = 825
export const QUOTE_VALID_DAYS_DEFAULT = 14
export const CURRENCY = 'USD' as const

export const DISCOUNT_CODES = {
  ANNUAL: { bps: 800, label: 'Annual contract' },
  NONPROFIT: { bps: 1000, label: 'Nonprofit' },
  MULTISITE: { bps: 500, label: 'Multi-site' },
} as const

export type DiscountCode = keyof typeof DISCOUNT_CODES

export type CatalogItem = {
  sku: string
  name: string
  unit: string
  unitPriceCents: number
  detail: string
}

/** Published rate card. Quote math reads prices from here and nowhere else. */
export const CATALOG: readonly CatalogItem[] = [
  {
    sku: 'OFFICE-CLEAN',
    name: 'Nightly office cleaning',
    unit: 'sqft',
    unitPriceCents: 12,
    detail: 'Per visit, per square foot of cleanable area. Consumables for desks and kitchens are included.',
  },
  {
    sku: 'RESTROOM',
    name: 'Restroom sanitation',
    unit: 'restroom',
    unitPriceCents: 6500,
    detail: 'Per restroom, per visit, including restock of the consumables Meridian supplies.',
  },
  {
    sku: 'DAY-PORTER',
    name: 'Day porter',
    unit: 'hour',
    unitPriceCents: 4200,
    detail: 'Porter on site during the building’s open hours.',
  },
  {
    sku: 'PORTER-OT',
    name: 'After-hours emergency clean',
    unit: 'hour',
    unitPriceCents: 7800,
    detail: 'Call-out rate outside the scheduled crew window. Two-hour minimum is not applied by this rate card.',
  },
  {
    sku: 'FLOOR-CARE',
    name: 'Floor strip and refinish',
    unit: 'sqft',
    unitPriceCents: 45,
    detail: 'Hard-floor strip and refinish. One-time project, not a per-visit rate.',
  },
  {
    sku: 'WINDOW',
    name: 'Interior glass',
    unit: 'pane',
    unitPriceCents: 800,
    detail: 'Interior pane at standard reach. Exterior glass is scheduled as its own visit.',
  },
  {
    sku: 'CARPET',
    name: 'Carpet hot-water extraction',
    unit: 'sqft',
    unitPriceCents: 28,
    detail: 'Hot-water extraction. One-time project.',
  },
  {
    sku: 'DISINFECT',
    name: 'High-touch disinfection',
    unit: 'visit',
    unitPriceCents: 9500,
    detail: 'Add-on for high-touch points during a scheduled visit.',
  },
] as const

export function findSku(sku: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.sku === sku)
}

export function isDiscountCode(value: string | null | undefined): value is DiscountCode {
  return value != null && value in DISCOUNT_CODES
}
