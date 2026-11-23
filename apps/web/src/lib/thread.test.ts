import { describe, expect, it } from 'vitest'
import { relatedInquiries } from './thread'

const row = (id: string, companyName: string | null, fromEmail: string, createdAt: number) => ({
  id, companyName, fromEmail, subject: id, status: 'resolved', intent: 'quote', createdAt,
})

describe('relatedInquiries', () => {
  const all = [
    row('a', 'North Wharf Logistics', 'priya@north-wharf.example', 1),
    row('b', 'north wharf  logistics', 'ops@north-wharf.example', 3),
    row('c', 'Lantern Hall', 'noor@lantern-hall.example', 2),
    row('d', null, 'priya@north-wharf.example', 4),
  ]

  it('matches the same company regardless of case and spacing, newest first, without the current row', () => {
    expect(relatedInquiries(all[0], all).map((item) => item.id)).toEqual(['d', 'b'])
  })

  it('matches by address when there is no company', () => {
    expect(relatedInquiries(all[3], all).map((item) => item.id)).toEqual(['a'])
  })

  it('never matches on a masked or missing address', () => {
    const masked = row('m', null, '[email]', 5)
    expect(relatedInquiries(masked, [...all, row('n', null, '[email]', 6)])).toEqual([])
    expect(relatedInquiries(row('x', '', '', 1), all)).toEqual([])
  })
})
