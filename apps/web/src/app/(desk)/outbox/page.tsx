import Link from 'next/link'
import { CopyLink } from '../../../components/copy-link'
import { sourceOutbox } from '../../../lib/source'
import { maskEmail, maskPhone } from '@meridian/core'
import { deskWhen } from '../../../lib/format'

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
        <div className="table-wrap">
          <table className="outbox-table">
            <thead><tr><th>To</th><th>Subject</th><th>Status</th><th>Provider</th><th>Message id</th><th>When</th></tr></thead>
            <tbody>
              {data.email.map((row) => (
                <tr key={row.id}>
                  <td>{maskEmail(row.toEmail)}{row.inquiryId ? <> · <Link href={`/inbox/${row.inquiryId}`}>inquiry</Link></> : null}</td>
                  <td>{row.subject}</td>
                  <td className="nowrap">{row.status}{row.error ? <div className="muted">{row.error}</div> : null}</td>
                  <td>{providerName(row.provider)}</td>
                  <td className="mono" title={row.providerMessageId || undefined}>{row.providerMessageId || '—'}</td>
                  <td className="muted nowrap">{deskWhen(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Calls</h2>
        <div className="table-wrap">
          <table className="outbox-table">
            <thead><tr><th>Number</th><th>Mode</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {data.calls.map((row) => (
                <tr key={row.id}>
                  <td className="nowrap">{maskPhone(row.phone)}{row.inquiryId ? <> · <Link href={`/inbox/${row.inquiryId}`}>inquiry</Link></> : null}</td>
                  <td className="nowrap">{row.mode}</td>
                  <td className="nowrap">{row.status}{row.summary ? <div>{callSummary(row.summary)}</div> : null}</td>
                  <td className="muted nowrap">{deskWhen(row.createdAt)}</td>
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
  if (provider === 'sandbox') return 'sandbox'
  return provider
}

function callSummary(summary: string) {
  if (/^https?:\/\//i.test(summary)) return <CopyLink url={summary} />
  return <span className="muted">{summary}</span>
}
