import Link from 'next/link'
import { CopyLink } from '../../../components/copy-link'
import { sourceOutbox } from '../../../lib/source'
import { maskEmail, maskPhone } from '@meridian/core'
import { deskWhen, providerDisplayName } from '../../../lib/format'

export const metadata = { title: 'Outbox' }

export default async function OutboxPage() {
  const data = await sourceOutbox()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Outbox</h1>
          <p className="lede">Every email and callback the desk has tried to send.</p>
        </div>
      </div>
      <section className="card">
        <h2>Email</h2>
        <div className="table-wrap stack-cards" data-stack="outbox">
          <table className="outbox-table">
            <thead><tr><th>To</th><th>Subject</th><th>Status</th><th>Provider</th><th>Message id</th><th>When</th></tr></thead>
            <tbody>
              {data.email.map((row) => (
                <tr key={row.id}>
                  <td data-label="To">{maskEmail(row.toEmail)}{row.inquiryId ? <> · <Link href={`/inbox/${row.inquiryId}`}>inquiry</Link></> : null}</td>
                  <td data-label="Subject">{row.subject}</td>
                  <td data-label="Status">{row.status}{row.error ? <div className="muted">{row.error}</div> : null}</td>
                  <td data-label="Provider">{providerName(row.provider)}</td>
                  <td className="mono" data-label="Message id" title={row.providerMessageId || undefined}>{row.providerMessageId || '—'}</td>
                  <td className="muted" data-label="When">{deskWhen(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Calls</h2>
        <div className="table-wrap stack-cards" data-stack="outbox-calls">
          <table className="outbox-table">
            <thead><tr><th>Number</th><th>Mode</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {data.calls.map((row) => (
                <tr key={row.id}>
                  <td data-label="Number">{maskPhone(row.phone)}{row.inquiryId ? <> · <Link href={`/inbox/${row.inquiryId}`}>inquiry</Link></> : null}</td>
                  <td data-label="Mode">{row.mode}</td>
                  <td data-label="Status">{row.status}{row.summary ? <div>{callSummary(row.summary)}</div> : null}</td>
                  <td className="muted" data-label="When">{deskWhen(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function providerName(provider: string | null): string {
  if (!provider) return '—'
  if (provider === 'resend') return 'Resend'
  return providerDisplayName(provider)
}

function callSummary(summary: string) {
  if (/^https?:\/\//i.test(summary)) return <CopyLink url={summary} />
  return <span className="muted">{summary}</span>
}
