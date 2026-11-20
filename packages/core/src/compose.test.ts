import { describe, expect, it } from 'vitest'
import { composeAnswer, composeQuoteEmail } from './compose'
import { searchKb } from './kb'
import { computeQuote } from './quote'

const person = {
  fromName: 'Priya Shah',
  fromEmail: 'priya.shah@north-wharf.example',
  companyName: 'North Wharf Logistics',
}

describe('answers that cover each question', () => {
  it('answers evening hours from the desk hours and the night crew window', () => {
    const inquiry = { ...person, subject: 'Evening hours', body: 'What are your evening hours?' }
    const chunks = searchKb(`${inquiry.subject}\n${inquiry.body}`, undefined, 4)
    const message = composeAnswer(inquiry, chunks)
    expect(message.body).toContain('07:00')
    expect(message.body).toContain('18:30')
    expect(message.body).toContain('service-area-and-hours')
  })

  it('answers green cleaning inside a quote and says when the notes are silent', () => {
    const inquiry = { ...person, subject: 'Nightly quote and products', body: 'Please quote nightly cleaning for 8,000 sqft. Do you use green cleaning products?' }
    const chunks = searchKb(`${inquiry.subject}\n${inquiry.body}`, undefined, 4)
    const math = computeQuote({ lines: [{ sku: 'OFFICE-CLEAN', qty: 8000 }], discountCode: null, taxBps: 825 })
    const message = composeQuoteEmail(inquiry, { ...math, number: 'MF-1', validUntil: '2026-12-01' }, chunks)
    expect(message.body).toContain('Green Seal')
    expect(message.body).toContain('green-cleaning')
  })

  it('answers the weekend desk and says parking is not in the notes', () => {
    const inquiry = { ...person, subject: 'Weekend desk', body: 'Do you cover the desk on weekends, and do you validate parking?' }
    const chunks = searchKb(`${inquiry.subject}\n${inquiry.body}`, undefined, 4)
    const message = composeAnswer(inquiry, chunks)
    expect(message.body.toLowerCase()).toContain('weekend')
    expect(message.body).toContain('The notes do not answer')
  })
})
