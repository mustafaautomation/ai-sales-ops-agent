import { describe, expect, it } from 'vitest'
import { hashVisitor, networkKey } from './limits'

describe('visitor limits', () => {
  it('collapses an IPv6 address to its /64 before hashing', async () => {
    expect(networkKey('2001:db8:1:2::55')).toBe(networkKey('2001:db8:1:2::99'))
    expect(networkKey('2001:db8:1:2::55')).not.toBe(networkKey('2001:db8:1:3::55'))
    const a = await hashVisitor('2001:db8:1:2::55', 'salt')
    const b = await hashVisitor('2001:db8:1:2::99', 'salt')
    const c = await hashVisitor('203.0.113.8', 'salt')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toContain('2001')
    expect(networkKey('203.0.113.8')).toBe('203.0.113.8')
    expect(networkKey('203.0.113.8')).not.toBe(networkKey('203.0.113.9'))
    expect(networkKey('[2001:db8:1:2::55]')).toBe(networkKey('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd'))
    expect(networkKey('::ffff:203.0.113.8')).toBe('203.0.113.8')
  })
})
