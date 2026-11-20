import { describe, expect, it } from 'vitest'
import {
  auditDetailJson,
  auditEntityId,
  hashPiiRef,
  maskEmail,
  maskPhone,
  maskPiiText,
  maskPiiValue,
} from './mask'

describe('audit PII masking', () => {
  it('masks emails as first-char***@host', () => {
    expect(maskEmail('maria@gmail.com')).toBe('m***@gmail.com')
    expect(maskEmail('priya.shah@north-wharf.example')).toBe('p***@north-wharf.example')
  })

  it('masks phones without leaking the middle digits', () => {
    const masked = maskPhone('+16025550199')
    expect(masked).toContain('***')
    expect(masked).toContain('0199')
    expect(masked).not.toContain('602555')
  })

  it('never leaves raw emails or phones in audit detail JSON', () => {
    const raw = {
      email: 'lead@example.com',
      phone: '+16025550199',
      nested: { note: 'Write lead@example.com or (602) 555-0199' },
    }
    const stored = auditDetailJson(raw)
    expect(stored).not.toContain('lead@example.com')
    expect(stored).not.toContain('6025550199')
    expect(stored).not.toContain('(602) 555-0199')
    expect(stored).toContain('l***@example.com')
    expect(stored).toContain('***')
  })

  it('hashes email/phone entity ids and passes through opaque ids', async () => {
    const emailId = await auditEntityId('lead@example.com')
    const phoneId = await auditEntityId('+16025550199')
    const opaque = await auditEntityId('inq_seed_pending')
    expect(emailId).toMatch(/^pii_[a-f0-9]{16}$/)
    expect(phoneId).toMatch(/^pii_[a-f0-9]{16}$/)
    expect(emailId).not.toContain('@')
    expect(phoneId).not.toContain('602')
    expect(opaque).toBe('inq_seed_pending')
    expect(await hashPiiRef('lead@example.com')).toBe(emailId)
  })

  it('masks free text and nested structures', () => {
    expect(maskPiiText('Contact ada@north-wharf.example')).toBe('Contact a***@north-wharf.example')
    expect(maskPiiValue({ to: 'ada@north-wharf.example' })).toEqual({ to: 'a***@north-wharf.example' })
  })
})
