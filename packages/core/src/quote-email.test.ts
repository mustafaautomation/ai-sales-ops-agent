import { describe, expect, it } from 'vitest'
import { guardDraft } from './ground'
import { searchKb } from './kb'
import { computeQuote } from './quote'
import {
  assembleQuoteEmail,
  composeStructuredQuoteEmail,
  groundQuoteAnswers,
  parseQuoteDraft,
  templateQuoteDraft,
} from './quote-email'

const inquiry = {
  fromName: 'Priya Shah',
  fromEmail: 'priya.shah@north-wharf.example',
  companyName: 'North Wharf Logistics',
  subject: 'Nightly quote, evening crews, insurance',
  body: 'Please quote nightly cleaning for 5,000 sqft. Can your nightly crews work in the evening after 7pm? Are the crews insured?',
}

describe('structured quote emails', () => {
  it('assembles greeting, quote block, one answer per question, sign-off, then sources', () => {
    const math = computeQuote({ lines: [{ sku: 'OFFICE-CLEAN', qty: 5000 }], discountCode: null, taxBps: 825 })
    const chunks = searchKb(`${inquiry.subject}\n${inquiry.body}`, undefined, 4)
    const message = composeStructuredQuoteEmail(inquiry, { ...math, number: 'MF-2201', validUntil: '2026-12-04' }, chunks)
    expect(message.body).toContain('Hello Priya,')
    expect(message.subject).toMatch(/^Quote MF-2201: /)
    expect(message.subject).toContain('Nightly office cleaning')
    expect(message.body).toContain('Subtotal:')
    expect(message.body).toContain('Total:')
    expect(message.body).not.toContain('Discount (none)')
    expect(message.body).toContain('Your questions')
    expect(message.body).toContain('18:30')
    expect(message.body).toContain("Insurance: we'll confirm the details and follow up.")
    expect(message.body).not.toMatch(/\bfees?\b/i)
    expect(message.body).not.toContain('Office hours')
    expect(message.body.toLowerCase()).not.toContain('are insured')
    const eveningHits = message.body.match(/18:30/g) ?? []
    expect(eveningHits).toHaveLength(1)
    const signOffAt = message.body.indexOf('Meridian Facilities sales desk')
    const sourcesAt = message.body.indexOf('Sources:')
    expect(signOffAt).toBeGreaterThan(0)
    expect(sourcesAt).toBeGreaterThan(signOffAt)
    expect(message.body.slice(signOffAt)).not.toMatch(/Nightly crews start[\s\S]*Meridian Facilities/)
  })

  it('builds a deterministic subject from the quote number and service phrase', async () => {
    const { quoteEmailSubject } = await import('./quote-email')
    expect(quoteEmailSubject({ number: 'MF-1104', lines: [{ description: 'Interior glass panes' }] }, 'Interior window cleaning')).toBe(
      'Quote MF-1104: Interior window cleaning',
    )
    expect(quoteEmailSubject({ number: 'MF-1104', lines: [{ description: 'Interior glass panes' }] }, 'Quote MF-1104: Interior window cleaning')).toBe(
      'Quote MF-1104: Interior window cleaning',
    )
    expect(quoteEmailSubject({ number: 'MF-1104', lines: [{ description: 'Interior glass panes' }] })).toBe(
      'Quote MF-1104: Interior glass panes',
    )
  })

  it('downgrades unsupported model answers to will_confirm and keeps the draft', () => {
    const math = computeQuote({ lines: [{ sku: 'OFFICE-CLEAN', qty: 5000 }], discountCode: null, taxBps: 825 })
    const chunks = searchKb(`${inquiry.subject}\n${inquiry.body}`, undefined, 4)
    const messy = {
      opening: 'Thank you for your inquiry regarding nightly cleaning.',
      answers: [
        {
          question: 'Can your nightly crews work in the evening after 7pm?',
          answer: 'Yes, nightly crews start between 18:30 and 22:00 depending on building access.',
          sourceIds: ['service-area-and-hours'],
          status: 'answered' as const,
        },
        {
          question: 'Are the crews insured?',
          answer: 'Our crews are fully insured for every job with no fees.',
          sourceIds: [],
          status: 'answered' as const,
        },
      ],
      closing: 'Please let us know if you would like to proceed.',
    }
    const grounded = groundQuoteAnswers(messy.answers, chunks)
    expect(grounded[1]?.status).toBe('will_confirm')
    expect(grounded[1]?.answer).toContain("we'll confirm")
    const assembled = assembleQuoteEmail(inquiry, { ...math, number: 'MF-2201', validUntil: '2026-12-04' }, messy, chunks)
    expect(assembled.body).toContain('18:30')
    expect(assembled.body).toContain("Insurance: we'll confirm the details and follow up.")
    expect(assembled.body).not.toContain('fully insured')
    expect(assembled.body).not.toMatch(/\bfees?\b/i)
    const guarded = guardDraft({
      inquiry,
      body: '',
      purpose: 'quote',
      chunks,
      quote: { ...math, number: 'MF-2201', validUntil: '2026-12-04' },
      structured: messy,
    })
    expect(guarded.blocked).toBeNull()
    expect(guarded.body).toContain('Your questions')
    expect(guarded.body).toContain('18:30')
    expect(guarded.note).toMatch(/will_confirm/)
  })

  it('falls back to the template when structured output is missing', () => {
    const math = computeQuote({ lines: [{ sku: 'OFFICE-CLEAN', qty: 5000 }], discountCode: null, taxBps: 825 })
    const guarded = guardDraft({
      inquiry,
      body: 'Thanks for writing. We can help.',
      purpose: 'quote',
      chunks: [],
      quote: { ...math, number: 'MF-2201', validUntil: '2026-12-04' },
      structured: { purpose: 'quote' },
    })
    expect(guarded.blocked).toBeNull()
    expect(guarded.note).toMatch(/template/i)
    expect(guarded.body).toContain('Subtotal:')
    expect(guarded.body).toContain("Insurance: we'll confirm the details and follow up.")
    expect(parseQuoteDraft(templateQuoteDraft(inquiry))).not.toBeNull()
  })
})
