export function networkKey(ip: string): string {
  const value = ip.trim().toLowerCase()
  if (value.includes(':')) {
    const groups = expandIpv6(value)
    return groups.slice(0, 4).join(':')
  }
  return value
}

function expandIpv6(value: string): string[] {
  const [head, tail] = value.split('::')
  const headParts = head ? head.split(':').filter(Boolean) : []
  const tailParts = tail ? tail.split(':').filter(Boolean) : []
  if (!value.includes('::')) return headParts.map((part) => part.padStart(4, '0'))
  const missing = Math.max(0, 8 - headParts.length - tailParts.length)
  return [...headParts, ...Array(missing).fill('0'), ...tailParts].map((part) => String(part).padStart(4, '0'))
}

export async function hashVisitor(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${networkKey(ip)}`))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function utcDay(at = new Date()): string {
  return at.toISOString().slice(0, 10)
}

export const CALLS_PER_IP = 3
export const CALLS_PER_DAY = 40
export const CALL_WINDOW_MS = 24 * 60 * 60 * 1000
export const FORM_PER_DAY = 40
export const LLM_PER_IP_DAY = 12
export const LLM_PER_DAY = 80
