import { describe, expect, it } from 'vitest'
import { composeAnswer, composeQuoteEmail } from './compose'
import { guardDraft, stripUnsupportedSentences, uncoveredQuestions, unsupportedClaims } from './ground'
import { allChunks, searchKb } from './kb'
import { computeQuote } from './quote'

const person = {
  fromName: 'Elena Marsh',
  fromEmail: 'elena.marsh@westcedar-dental.example',
  companyName: 'West Cedar Dental',
  subject: 'Crew credentials',
  body: 'Are your crews insured and background-checked? Do you guarantee the work? Do you hold an ISSA CIMS certification?',
}

const eveningInsurance = {
  fromName: 'Priya Shah',
  fromEmail: 'priya.shah@north-wharf.example',
  companyName: 'North Wharf Logistics',
  subject: 'Quote, evening crews, and insurance',
  body: 'Please quote nightly cleaning for 5,000 sqft. Can your nightly crews work in the evening after 7pm? Are the crews insured?',
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

  it('allows pleasantries and honest unknowns without flagging them', () => {
    const chunks = searchKb('evening crews after 7pm', undefined, 4)
    const draft = [
      'Thank you for contacting Meridian Facilities.',
      'Nightly crews start between 18:30 and 22:00 depending on building access.',
      'We do not have specific insurance details in our notes; we will confirm and follow up.',
      'Best regards,',
    ].join('\n')
    expect(unsupportedClaims(draft, chunks)).toEqual([])
  })

  it('removes only unsupported sentences and keeps the rest of the model draft', () => {
    const chunks = searchKb('evening after 7pm insurance', undefined, 4)
    const draft = [
      'Thank you for contacting Meridian Facilities.',
      'Nightly crews start between 18:30 and 22:00 depending on building access.',
      'Our crews are fully insured for every job.',
      'Please let me know if you would like the quote adjusted.',
    ].join('\n')
    const stripped = stripUnsupportedSentences(draft, chunks)
    expect(stripped.removed).toContain('insurance')
    expect(stripped.body).toContain('Thank you for contacting Meridian Facilities')
    expect(stripped.body).toContain('18:30')
    expect(stripped.body).toContain('Please let me know')
    expect(stripped.body.toLowerCase()).not.toContain('fully insured')
  })

  it('keeps a model-written evening+insurance quote draft and covers both questions', () => {
    const chunks = searchKb(`${eveningInsurance.subject}\n${eveningInsurance.body}`, undefined, 4)
    const math = computeQuote({ lines: [{ sku: 'OFFICE-CLEAN', qty: 5000 }], discountCode: null, taxBps: 825 })
    const draft = [
      'Thank you for contacting Meridian Facilities.',
      '',
      'Quote MF-2201 for North Wharf Logistics is below. It is valid through 2026-12-04.',
      '',
      '5000 × Nightly office cleaning (OFFICE-CLEAN) @ $0.12 = $600.00',
      '',
      'Subtotal: $600.00',
      'Tax (8.25%): $49.50',
      'Total: $649.50',
      '',
      'Nightly crews start between 18:30 and 22:00 depending on building access.',
      'We do not have specific insurance details in our notes; we will confirm and follow up.',
    ].join('\n')
    const guarded = guardDraft({
      inquiry: eveningInsurance,
      body: draft,
      purpose: 'quote',
      chunks,
      quote: { ...math, number: 'MF-2201', validUntil: '2026-12-04' },
    })
    expect(guarded.blocked).toBeNull()
    expect(guarded.body).toContain('Thank you for contacting Meridian Facilities')
    expect(guarded.body).toContain('18:30')
    expect(guarded.body.toLowerCase()).toMatch(/insurance/)
    expect(guarded.body.toLowerCase()).toMatch(/confirm|follow up|do not have/)
    expect(guarded.body.toLowerCase()).not.toMatch(/\bare insured\b/)
    expect(guarded.body).not.toContain('Office hours')
    expect(guarded.body).not.toContain('staffed 07:00')
    expect(guarded.body).not.toContain('Discount (none)')
    expect(uncoveredQuestions(eveningInsurance, guarded.body)).toEqual([])
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
    expect(guarded.body).toContain("I'll confirm our insurance, background-check details and guarantees and follow up.")
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
