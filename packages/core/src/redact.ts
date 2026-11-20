const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}\b/g
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g
const CARD = /\b(?:\d{4}[ -]?){3}\d{4}\b/g

export function redactText(input: string): string {
  return input
    .replace(CARD, '[card]')
    .replace(SSN, '[ssn]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]')
}

export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(inner)
    }
    return out as T
  }
  return value
}

export function logLine(message: string, meta?: unknown): void {
  if (meta === undefined) {
    console.log(redactText(message))
    return
  }
  console.log(redactText(message), redactValue(meta))
}
