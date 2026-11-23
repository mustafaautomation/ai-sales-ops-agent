import { describe, expect, it } from 'vitest'
import { approvalPagePayload, serializeApprovalProps } from './approval-view'
import { approvalTitle } from './approval-view'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.raw-secret-token.signature'
const RAW = JSON.stringify({
  to: 'priya.shah@north-wharf.example',
  subject: 'Quote MF-1104: Interior window cleaning',
  body: `Hello Priya,\n\nQuote below.\n\nMeridian Facilities sales desk\nCedarhaven\n\nTo stop all contact: https://sales.quvantic.com/unsubscribed?token=${TOKEN}`,
  purpose: 'quote',
  quoteId: 'quo_1',
})

describe('approval page payload masking', () => {
  it('masks the unsubscribe token before props are serialized for the page', () => {
    const payload = approvalPagePayload(RAW)
    expect(payload.proposed).not.toContain(TOKEN)
    expect(payload.proposedPretty).not.toContain(TOKEN)
    expect(payload.proposed).toContain('token=•••')
    expect(payload.display).toContain('token=•••')

    const serialized = serializeApprovalProps({
      id: 'apr_1',
      toolName: 'send_email',
      status: 'pending',
      proposedJson: RAW,
      note: null,
    })
    expect(serialized).not.toContain(TOKEN)
    expect(serialized).toContain('token=•••')
    expect(serialized).toContain('apr_1')
  })
})

describe('approvalTitle', () => {
  it('only calls a send a quote email when it carries a quote', () => {
    expect(approvalTitle('send_email', JSON.stringify({ purpose: 'quote', quoteId: 'quo_1' }))).toBe('Send quote email')
    expect(approvalTitle('send_email', JSON.stringify({ purpose: 'answer', quoteId: null }))).toBe('Send reply email')
    expect(approvalTitle('send_email', '{bad')).toBe('Send quote email')
    expect(approvalTitle('crm_upsert', null)).toBe('Update CRM deal')
  })
})
