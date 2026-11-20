/** Browser-safe masking helpers — no Node built-ins or DB imports. */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}\b/g
const E164ish = /^\+?\d{8,15}$/

/** Mask the token query value for desk previews. The sent email keeps the real link. */
export function maskUnsubscribeUrl(url: string): string {
  return url.replace(/([?&]token=)[^&\s#]+/i, '$1•••')
}

/** Mask unsubscribe tokens inside approval JSON shown in the UI. */
export function maskPayloadSecrets(raw: string): string {
  return raw.replace(/([?&]token=)[^"&\s\\]+/gi, '$1•••')
}

/** Restore masked tokens in an edited payload from the original proposed JSON. */
export function restorePayloadSecrets(edited: string, original: string): string {
  if (!edited.includes('token=•••')) return edited
  const originals = [...original.matchAll(/([?&]token=)([^"&\s\\]+)/gi)].map((match) => match[0])
  let index = 0
  return edited.replace(/([?&]token=)•••/gi, () => originals[index++] ?? '$1•••')
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function looksLikePhone(value: string): boolean {
  const trimmed = value.trim()
  if (E164ish.test(trimmed)) return true
  return /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}/.test(trimmed)
}

export function maskEmail(email: string): string {
  const trimmed = email.trim()
  const at = trimmed.indexOf('@')
  if (at <= 0) return '***'
  const name = trimmed.slice(0, at)
  const host = trimmed.slice(at + 1)
  if (!host) return '***'
  const head = name.slice(0, 1) || '*'
  return `${head}***@${host}`
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '***'
  const ccLen = digits.length > 10 ? digits.length - 10 : 0
  const prefix = ccLen > 0 ? `+${digits.slice(0, ccLen)}` : '+'
  return `${prefix}***${digits.slice(-4)}`
}

/** Mask emails and phones inside free text for audit/log storage. */
export function maskPiiText(input: string): string {
  return input
    .replace(EMAIL, (match) => maskEmail(match))
    .replace(PHONE, (match) => maskPhone(match))
}

/** Deep-mask emails and phones in JSON-like values before audit storage. */
export function maskPiiValue<T>(value: T): T {
  if (typeof value === 'string') {
    if (looksLikeEmail(value)) return maskEmail(value) as T
    if (looksLikePhone(value)) return maskPhone(value) as T
    return maskPiiText(value) as T
  }
  if (Array.isArray(value)) return value.map((item) => maskPiiValue(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = maskPiiValue(inner)
    }
    return out as T
  }
  return value
}

/** Stable short hash for putting emails/phones into audit entity_id. */
export async function hashPiiRef(value: string): Promise<string> {
  const normalized = value.trim().toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`meridian-audit|${normalized}`))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `pii_${hex.slice(0, 16)}`
}

/** Opaque entity id for audit rows: hash emails/phones, pass through real ids. */
export async function auditEntityId(value: string): Promise<string> {
  const trimmed = value.trim()
  if (!trimmed) return 'unknown'
  if (looksLikeEmail(trimmed) || looksLikePhone(trimmed)) return hashPiiRef(trimmed)
  return trimmed
}

/** JSON detail string safe for audit_log.detail. */
export function auditDetailJson(detail: unknown): string {
  return JSON.stringify(maskPiiValue(detail))
}
