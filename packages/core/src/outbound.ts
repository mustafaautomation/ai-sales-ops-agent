export type EmailMessage = {
  to: string
  from: string
  replyTo?: string | null
  subject: string
  text: string
  html?: string | null
}

export type SendResult = { ok: true; id: string } | { ok: false; status: number; reason: string }

export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>
}

export function sandboxSender(sent: EmailMessage[] = []): EmailSender {
  return {
    async send(message) {
      sent.push(message)
      return { ok: true, id: `sandbox_${sent.length}` }
    },
  }
}

export function resendSender(fetchImpl: typeof fetch, apiKey: string): EmailSender {
  return {
    async send(message) {
      let response: Response
      try {
        response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: message.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html ?? undefined,
            reply_to: message.replyTo ?? undefined,
          }),
        })
      } catch {
        return { ok: false, status: 0, reason: 'network error' }
      }
      if (response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { id?: string }
        return { ok: true, id: payload.id || 'resend' }
      }
      const reason = response.status === 403 ? 'domain not verified' : response.status === 429 ? 'rate limited' : `resend ${response.status}`
      return { ok: false, status: response.status, reason }
    },
  }
}

export function chooseSender(input: { enabled: boolean; apiKey?: string | null; fetchImpl?: typeof fetch }): EmailSender {
  if (input.enabled && input.apiKey) return resendSender(input.fetchImpl ?? fetch, input.apiKey)
  return sandboxSender()
}

type TokenPayload = { inquiryId: string; email: string; purpose: 'opt-in' | 'unsubscribe' | 'call'; exp: number }

function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function b64ToBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return bytesToB64(new Uint8Array(signed))
}

export async function signDeskToken(secret: string, payload: TokenPayload): Promise<string> {
  const body = bytesToB64(new TextEncoder().encode(JSON.stringify(payload)))
  return `${body}.${await hmac(secret, body)}`
}

export async function verifyDeskToken(secret: string, token: string, now = Date.now()): Promise<{ ok: true; payload: TokenPayload } | { ok: false; reason: string }> {
  const [body, signature] = token.split('.')
  if (!body || !signature) return { ok: false, reason: 'malformed' }
  const expected = await hmac(secret, body)
  if (expected !== signature) return { ok: false, reason: 'bad signature' }
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64ToBytes(body))) as TokenPayload
    if (!payload.exp || payload.exp < now) return { ok: false, reason: 'expired' }
    if (!payload.inquiryId || !payload.email || !payload.purpose) return { ok: false, reason: 'malformed' }
    return { ok: true, payload }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

export function parseE164(value: string): string | null {
  const compact = value.trim().replace(/[\s()-]/g, '')
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) return null
  return compact
}

export function inCallWindow(at: Date, timeZone = 'Asia/Kuala_Lumpur', startHour = 9, endHour = 20): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at))
  return hour >= startHour && hour < endHour
}

export function nextCallWindow(at: Date, timeZone = 'Asia/Kuala_Lumpur', startHour = 9): Date {
  if (inCallWindow(at, timeZone, startHour)) return at
  const probe = new Date(at.getTime())
  for (let step = 0; step < 48; step += 1) {
    probe.setTime(probe.getTime() + 30 * 60 * 1000)
    if (inCallWindow(probe, timeZone, startHour)) return probe
  }
  return probe
}

export type OutboundCaps = {
  emailsPerAddress: number
  optInsPerIp: number
  emailsGlobal: number
  callsPerNumber: number
  callsPerIp: number
  callsGlobal: number
}

export const DEFAULT_CAPS: OutboundCaps = {
  emailsPerAddress: 2,
  optInsPerIp: 3,
  emailsGlobal: 50,
  callsPerNumber: 1,
  callsPerIp: 3,
  callsGlobal: 10,
}

export function emailAllowed(input: { enabled: boolean; suppressed: boolean; verified: boolean; addressCount: number; globalCount: number; caps?: OutboundCaps }): { ok: true } | { ok: false; reason: string } {
  const caps = input.caps ?? DEFAULT_CAPS
  if (!input.enabled) return { ok: false, reason: 'sending is off' }
  if (input.suppressed) return { ok: false, reason: 'suppressed' }
  if (!input.verified) return { ok: false, reason: 'email is not verified' }
  if (input.addressCount >= caps.emailsPerAddress) return { ok: false, reason: 'address cap' }
  if (input.globalCount >= caps.emailsGlobal) return { ok: false, reason: 'daily cap' }
  return { ok: true }
}

export function callAllowed(input: { enabled: boolean; suppressed: boolean; phone: string | null; numberCount: number; ipCount: number; globalCount: number; at?: Date; timeZone?: string; caps?: OutboundCaps }): { ok: true; phone: string; when: Date } | { ok: false; reason: string } {
  const caps = input.caps ?? DEFAULT_CAPS
  if (!input.enabled) return { ok: false, reason: 'calls are off' }
  if (input.suppressed) return { ok: false, reason: 'suppressed' }
  const phone = input.phone ? parseE164(input.phone) : null
  if (!phone) return { ok: false, reason: 'invalid phone' }
  if (input.numberCount >= caps.callsPerNumber) return { ok: false, reason: 'number cap' }
  if (input.ipCount >= caps.callsPerIp) return { ok: false, reason: 'ip cap' }
  if (input.globalCount >= caps.callsGlobal) return { ok: false, reason: 'daily cap' }
  const at = input.at ?? new Date()
  const zone = input.timeZone || 'Asia/Kuala_Lumpur'
  return { ok: true, phone, when: nextCallWindow(at, zone) }
}

export function callbackMode(input: { callsEnabled: boolean; privateKey?: string | null; phoneNumberId?: string | null }): 'phone' | 'browser' {
  if (input.callsEnabled && input.privateKey && input.phoneNumberId) return 'phone'
  return 'browser'
}

export function emailHtml(text: string): string {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<pre style="font-family:sans-serif;white-space:pre-wrap">${escaped}</pre>`
}

export function recipientLocked(proposedTo: string, editedTo: string): boolean {
  return proposedTo.trim().toLowerCase() === editedTo.trim().toLowerCase()
}

export function shouldDraftFollowUp(input: { verified: boolean; suppressed: boolean; sentAt: number | null; now: number; days: number; alreadyDrafted: boolean }): boolean {
  if (!input.verified || input.suppressed || input.alreadyDrafted || input.sentAt == null) return false
  return input.now - input.sentAt >= input.days * 24 * 60 * 60 * 1000
}
