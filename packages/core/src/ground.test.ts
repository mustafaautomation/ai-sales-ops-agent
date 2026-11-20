import { describe, expect, it } from 'vitest'
import { composeAnswer, composeQuoteEmail } from './compose'
import { guardDraft, unsupportedClaims } from './ground'
import { allChunks, searchKb } from './kb'
import { computeQuote } from './quote'

const person = {
  fromName: 'Elena Marsh',
  fromEmail: 'elena.marsh@westcedar-dental.example',
  companyName: 'West Cedar Dental',
  subject: 'Crew credentials',
  body: 'Are your crews insured and background-checked? Do you guarantee the work? Do you hold an ISSA CIMS certification?',
}

describe('grounding', () => {
  it('flags insurance, guarantees, and certifications that are not in the notes', () => {
    const chunks = searchKb('green cleaning chemicals', undefined, 4)
    const draft = [
      'Our crews are insured and background-checked.',
      'The work is guaranteed for 30 days.',
      'Every technician holds an ISSA CIMS certification.',
      'We are licensed and bonded, and someone is on call 24/7.',
    ].join('\n')
    const claims = unsupportedClaims(draft, chunks)
    expect(claims).toEqual(expect.arrayContaining(['insurance', 'background check', 'guarantee', 'licensed', 'bonded', 'always on']))
    expect(claims.join(' ')).not.toContain('Green Seal')
  })

  it('allows Green Seal certification when that section was retrieved', () => {
    const chunks = searchKb('green cleaning certified chemicals', undefined, 4)
    expect(unsupportedClaims('Glass cleaner is Green Seal certified.', chunks)).not.toContain('certification')
  })

  it('rewrites an unsupported draft from the retrieved notes', () => {
    const chunks = searchKb(`${person.subject}\n${person.body}`, undefined, 4)
    const guarded = guardDraft({
      inquiry: person,
      body: 'Our crews are insured and background-checked, and the work is guaranteed.',
      purpose: 'answer',
      chunks,
    })
    expect(guarded.blocked).toBeNull()
    expect(guarded.note).toMatch(/Grounding: unsupported claim/)
    expect(guarded.body.toLowerCase()).not.toContain('are insured')
    expect(guarded.body.toLowerCase()).not.toContain('is guaranteed')
    expect(guarded.body).toContain("I'll confirm that and follow up.")
    expect(guarded.body).toContain('Meridian Facilities sales desk')
  })

  it('routes a quote draft to review when there is no quote to rebuild from', () => {
    const chunks = searchKb('office cleaning', undefined, 2)
    const guarded = guardDraft({
      inquiry: person,
      body: 'Crews are insured and background-checked.',
      purpose: 'quote',
      chunks,
      quote: null,
    })
    expect(guarded.blocked).toMatch(/Routed to review/)
    expect(guarded.claims).toContain('insurance')
  })

  it('leaves a composed answer and quote alone', () => {
    const chunks = searchKb(`${person.subject}\n${person.body}`, undefined, 4)
    const answer = composeAnswer(person, chunks)
    expect(unsupportedClaims(answer.body, allChunks())).toEqual([])
    const math = computeQuote({ lines: [{ sku: 'OFFICE-CLEAN', qty: 3500 }], discountCode: null, taxBps: 825 })
    const quote = composeQuoteEmail(person, { ...math, number: 'MF-1103', validUntil: '2026-12-04' }, chunks)
    expect(unsupportedClaims(quote.body, allChunks())).toEqual([])
    const again = guardDraft({ inquiry: person, body: quote.body, purpose: 'quote', chunks: allChunks(), quote: { ...math, number: 'MF-1103', validUntil: '2026-12-04' } })
    expect(again.note).toBeNull()
    expect(again.body).toBe(quote.body)
  })
})
