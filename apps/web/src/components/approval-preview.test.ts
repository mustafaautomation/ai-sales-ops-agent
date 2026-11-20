import { describe, expect, it } from 'vitest'
import { splitDeskEmail } from './approval-preview'

describe('email preview parsing', () => {
  it('keeps the body in order and stops the source list at the sign-off', () => {
    const body = [
      'Hello Elena,',
      '',
      'Quote MF-1103 for West Cedar Dental is below.',
      '',
      '3500 × Nightly office cleaning (OFFICE-CLEAN) @ $0.12 = $420.00',
      '',
      'Green cleaning',
      'Meridian uses a fixed list of Green Seal certified chemicals.',
      '',
      'Sources:',
      '1. Green cleaning — Chemicals (green-cleaning)',
      '',
      'Meridian Facilities sales desk',
      'Cedarhaven',
    ].join('\n')
    const parts = splitDeskEmail(body)
    expect(parts.main.indexOf('Quote MF-1103')).toBeLessThan(parts.main.indexOf('3500 ×'))
    expect(parts.main.indexOf('3500 ×')).toBeLessThan(parts.main.indexOf('Green cleaning'))
    expect(parts.main).toContain('\n\n')
    expect(parts.sources).toEqual(['Green cleaning — Chemicals (green-cleaning)'])
    expect(parts.signOff).toBe('Meridian Facilities sales desk\nCedarhaven')
    expect(parts.sources.join('\n')).not.toContain('Cedarhaven')
    expect(parts.sources.join('\n')).not.toContain('Sources:')
  })
})
