import { describe, expect, it } from 'vitest'
import { describeStep } from './step-view'

const step = (toolName: string, status: string, args: unknown, result: unknown) => ({
  toolName,
  status,
  redactedArgsJson: JSON.stringify(args),
  redactedResultJson: JSON.stringify(result),
})

describe('describeStep', () => {
  it('explains a classification and drops generic signals', () => {
    const view = describeStep(step('classify', 'ok', null, { intent: 'spam', injection: true, signals: ['spam', 'guest post', 'default'] }))
    expect(view.say).toMatch(/spam/i)
    expect(view.facts).toEqual([
      { label: 'Signals', value: 'guest post' },
      { label: 'Injection', value: 'Instruction-like text removed' },
    ])
  })

  it('summarises knowledge hits with the top excerpt', () => {
    const view = describeStep(step('search_kb', 'ok', { query: 'green' }, {
      chunks: [
        { title: 'Green cleaning', excerpt: 'Green Seal certified.' },
        { title: 'Green cleaning', excerpt: 'Fixed list.' },
      ],
    }))
    expect(view.say).toBe('Found 2 passages in 1 knowledge note to answer from.')
    expect(view.quote).toBe('Green Seal certified.')
  })

  it('describes a follow-up recall without any money', () => {
    const view = describeStep(step('recall_history', 'ok', null, {
      prior: [{ subject: 'Nightly cleaning', at: Date.UTC(2026, 10, 19), intent: 'quote', outcome: 'completed', quoteNumber: 'MF-1001', quoteStatus: 'sent' }],
    }))
    expect(view.say).toMatch(/Recalled 1 earlier inquiry/)
    expect(view.facts).toEqual([{ label: '2026-11-19', value: 'Nightly cleaning · quote MF-1001 (sent)' }])
  })

  it('says so when the knowledge base has nothing', () => {
    expect(describeStep(step('search_kb', 'ok', {}, { chunks: [] })).say).toMatch(/no answer is invented/)
  })

  it('lists quote lines, discount, tax, and total in dollars', () => {
    const view = describeStep(step('draft_quote', 'ok', {}, {
      number: 'MF-1003',
      validUntil: '2026-12-06',
      lines: [{ sku: 'FLOOR-CARE', description: 'Floor strip and refinish', qty: 5000, lineTotalCents: 225000 }],
      discountCode: 'NONPROFIT',
      discountBps: 1000,
      discountCents: 22500,
      taxBps: 825,
      taxCents: 16706,
      totalCents: 219206,
    }))
    expect(view.say).toMatch(/Priced 1 line/)
    expect(view.facts).toContainEqual({ label: 'FLOOR-CARE', value: '5,000 × Floor strip and refinish = $2,250.00' })
    expect(view.facts).toContainEqual({ label: 'Discount', value: 'NONPROFIT 10% · −$225.00' })
    expect(view.facts).toContainEqual({ label: 'Tax', value: '8.25% · $167.06' })
    expect(view.facts).toContainEqual({ label: 'Total', value: '$2,192.06' })
  })

  it('distinguishes a held write from an executed one', () => {
    const args = { companyName: 'Pike Works', dealTitle: 'Floors', stage: 'proposal', amountCents: 100 }
    expect(describeStep(step('crm_upsert', 'pending_approval', args, null)).say).toMatch(/Nothing is written/)
    expect(describeStep(step('crm_upsert', 'ok', args, { record: {} })).say).toMatch(/after approval/)
    expect(describeStep(step('send_email', 'pending_approval', { subject: 'Hi', body: 'Hello' }, null)).say).toMatch(/has not been sent/)
  })

  it('survives null, malformed, and unknown input', () => {
    expect(describeStep({ toolName: 'classify', status: 'ok', redactedArgsJson: null, redactedResultJson: 'null' }).say).toBe('Classified the note.')
    expect(describeStep({ toolName: 'draft_quote', status: 'ok', redactedResultJson: '{bad' }).say).toMatch(/Could not price/)
    expect(describeStep({ toolName: 'mystery', status: 'ok' })).toEqual({ say: '', facts: [] })
  })
})
