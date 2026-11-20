import { describe, expect, it } from 'vitest'
import { maskPayloadSecrets, maskUnsubscribeUrl, restorePayloadSecrets } from './mask'
import {
  callbackMode,
  callAllowed,
  chooseSender,
  shouldDraftFollowUp,
  emailAllowed,
  inCallWindow,
  listUnsubscribeHeaders,
  parseE164,
  quoteDeliverySummary,
  recipientLocked,
  resendSender,
  runProvidersLabel,
  signDeskToken,
  unsubscribeUrlFromBody,
  verifyDeskToken,
} from './outbound'

describe('outbound email', () => {
  it('names a blocked quote as not sent', () => {
    expect(quoteDeliverySummary('MF-1104', 'blocked_disabled')).toBe('Quote MF-1104 was not sent. Real sending is off.')
    expect(quoteDeliverySummary('MF-1104', 'blocked_suppressed')).toContain('suppressed')
    expect(quoteDeliverySummary('MF-1104', 'sent')).toContain('was sent')
  })

  it('sends through Resend and keeps the message id', async () => {
    const seen: { url: string; auth: string; body: Record<string, unknown> }[] = []
    const sender = resendSender(async (url, init) => {
      seen.push({
        url: String(url),
        auth: (init?.headers as { authorization: string }).authorization,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ id: 're_123' }), { status: 200 })
    }, 'secret-key')
    const stop = 'https://sales.quvantic.com/unsubscribed?token=secret-token'
    const result = await sender.send({
      to: 'a@example.com',
      from: 'Desk <desk@quvantic.com>',
      subject: 'Hi',
      text: `Hello\n\nTo stop all contact: ${stop}`,
      listUnsubscribe: stop,
    })
    expect(result).toEqual({ ok: true, id: 're_123' })
    expect(seen[0]?.url).toBe('https://api.resend.com/emails')
    expect(seen[0]?.auth).toBe('Bearer secret-key')
    expect(seen[0]?.body.headers).toEqual(listUnsubscribeHeaders(stop))
  })

  it('masks unsubscribe tokens and replaces an existing stop footer', async () => {
    const { withUnsubscribe, maskedUnsubscribeUrl } = await import('./outbound')
    const url = 'https://sales.quvantic.com/unsubscribed?token=abc.def'
    expect(maskUnsubscribeUrl(url)).toBe('https://sales.quvantic.com/unsubscribed?token=•••')
    expect(unsubscribeUrlFromBody(`Hello\n\nTo stop all contact: ${url}`)).toBe(url)
    const payload = JSON.stringify({ body: `Hi\n\nTo stop all contact: ${url}` })
    const masked = maskPayloadSecrets(payload)
    expect(masked).toContain('token=•••')
    expect(masked).not.toContain('abc.def')
    expect(restorePayloadSecrets(masked, payload)).toContain('abc.def')
    const placeholder = maskedUnsubscribeUrl('https://sales.quvantic.com')
    const preview = withUnsubscribe('Hello\n\nMeridian Facilities sales desk\nCedarhaven', placeholder)
    expect(preview).toContain('token=•••')
    const sent = withUnsubscribe(preview, url)
    expect(sent).toContain('token=abc.def')
    expect(sent).not.toContain('token=•••')
    expect(sent.match(/To stop all contact:/g)).toHaveLength(1)
    expect(runProvidersLabel(['gemini-3.5-flash-lite', 'groq/openai/gpt-oss-120b'])).toBe('Gemini + Groq (fallback)')
    expect(runProvidersLabel(['@cf/openai/gpt-oss-120b'])).toBe('Workers AI')
    expect(runProvidersLabel([], 'workers-ai')).toBe('Workers AI')
  })

  it('marks a 403 as domain not verified and a 429 as rate limited', async () => {
    const forbidden = resendSender(async () => new Response('no', { status: 403 }), 'k')
    const limited = resendSender(async () => new Response('no', { status: 429 }), 'k')
    expect(await forbidden.send({ to: 'a@example.com', from: 'Desk <desk@quvantic.com>', subject: 'Hi', text: 'Hello' })).toEqual({ ok: false, status: 403, reason: 'domain not verified' })
    expect(await limited.send({ to: 'a@example.com', from: 'Desk <desk@quvantic.com>', subject: 'Hi', text: 'Hello' })).toEqual({ ok: false, status: 429, reason: 'rate limited' })
  })

  it('stays on the sandbox sender when sending is off', async () => {
    const sender = chooseSender({ enabled: false, apiKey: 'secret' })
    const result = await sender.send({ to: 'a@example.com', from: 'Desk <desk@quvantic.com>', subject: 'Hi', text: 'Hello' })
    expect(result.ok && result.id.startsWith('sandbox_')).toBe(true)
  })

  it('signs and rejects an expired opt-in token', async () => {
    const token = await signDeskToken('secret', { inquiryId: 'inq_1', email: 'a@example.com', purpose: 'opt-in', exp: 1_000 })
    expect((await verifyDeskToken('secret', token, 500)).ok).toBe(true)
    expect(await verifyDeskToken('secret', token, 2_000)).toEqual({ ok: false, reason: 'expired' })
    expect((await verifyDeskToken('other', token, 500)).ok).toBe(false)
  })

  it('refuses a changed recipient', () => {
    expect(recipientLocked('A@Example.com', 'a@example.com')).toBe(true)
    expect(recipientLocked('a@example.com', 'other@example.com')).toBe(false)
  })
})

describe('outbound guardrails', () => {
  it('blocks email when the switch is off, the address is unverified, suppressed, or over a cap', () => {
    expect(emailAllowed({ enabled: false, suppressed: false, verified: true, addressCount: 0, globalCount: 0 }).ok).toBe(false)
    expect(emailAllowed({ enabled: true, suppressed: true, verified: true, addressCount: 0, globalCount: 0 })).toMatchObject({ reason: 'suppressed' })
    expect(emailAllowed({ enabled: true, suppressed: false, verified: false, addressCount: 0, globalCount: 0 })).toMatchObject({ reason: 'email is not verified' })
    expect(emailAllowed({ enabled: true, suppressed: false, verified: true, addressCount: 2, globalCount: 0 })).toMatchObject({ reason: 'address cap' })
    expect(emailAllowed({ enabled: true, suppressed: false, verified: true, addressCount: 0, globalCount: 50 })).toMatchObject({ reason: 'daily cap' })
    expect(emailAllowed({ enabled: true, suppressed: false, verified: true, addressCount: 1, globalCount: 1 }).ok).toBe(true)
  })

  it('validates E.164, honors caps and suppression, and schedules outside the window', () => {
    expect(parseE164('+60 12-345 6789')).toBe('+60123456789')
    expect(parseE164('0123456789')).toBeNull()
    expect(callAllowed({ enabled: false, suppressed: false, phone: '+60123456789', numberCount: 0, ipCount: 0, globalCount: 0 })).toMatchObject({ reason: 'calls are off' })
    expect(callAllowed({ enabled: true, suppressed: true, phone: '+60123456789', numberCount: 0, ipCount: 0, globalCount: 0 })).toMatchObject({ reason: 'suppressed' })
    expect(callAllowed({ enabled: true, suppressed: false, phone: '123', numberCount: 0, ipCount: 0, globalCount: 0 })).toMatchObject({ reason: 'invalid phone' })
    expect(callAllowed({ enabled: true, suppressed: false, phone: '+60123456789', numberCount: 1, ipCount: 0, globalCount: 0 })).toMatchObject({ reason: 'number cap' })
    const night = new Date('2026-11-20T18:30:00Z')
    expect(inCallWindow(night, 'Asia/Kuala_Lumpur')).toBe(false)
    const allowed = callAllowed({ enabled: true, suppressed: false, phone: '+60123456789', numberCount: 0, ipCount: 0, globalCount: 0, at: night })
    expect(allowed.ok).toBe(true)
    if (allowed.ok) expect(allowed.when.getTime()).toBeGreaterThan(night.getTime())
  })

  it('drafts a follow-up once, only after the wait, and never for an unverified lead', () => {
    const day = 24 * 60 * 60 * 1000
    expect(shouldDraftFollowUp({ verified: true, suppressed: false, sentAt: 0, now: 2 * day, days: 2, alreadyDrafted: false })).toBe(true)
    expect(shouldDraftFollowUp({ verified: true, suppressed: false, sentAt: 0, now: 2 * day, days: 2, alreadyDrafted: true })).toBe(false)
    expect(shouldDraftFollowUp({ verified: false, suppressed: false, sentAt: 0, now: 5 * day, days: 2, alreadyDrafted: false })).toBe(false)
    expect(shouldDraftFollowUp({ verified: true, suppressed: true, sentAt: 0, now: 5 * day, days: 2, alreadyDrafted: false })).toBe(false)
  })

  it('uses the browser when the phone config is missing', () => {
    expect(callbackMode({ callsEnabled: true, privateKey: 'key', phoneNumberId: 'pn' })).toBe('phone')
    expect(callbackMode({ callsEnabled: true, privateKey: 'key', phoneNumberId: '' })).toBe('browser')
    expect(callbackMode({ callsEnabled: false, privateKey: 'key', phoneNumberId: 'pn' })).toBe('browser')
  })
})
