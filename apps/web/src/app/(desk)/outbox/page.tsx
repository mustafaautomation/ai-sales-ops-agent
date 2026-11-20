import Link from 'next/link'
import { sourceOutbox } from '../../../lib/source'
import { maskEmail, maskPhone } from '@meridian/core'
import { when } from '../../../lib/format'

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
          <table>
            <thead><tr><th>To</th><th>Subject</th><th>Status</th><th>Provider</th><th>When</th></tr></thead>
            <tbody>
              {data.email.map((row) => (
                <tr key={row.id}>
                  <td>{maskEmail(row.toEmail)}{row.inquiryId ? <> · <Link href={`/inbox/${row.inquiryId}`}>inquiry</Link></> : null}</td>
                  <td>{row.subject}</td>
                  <td>{row.status}{row.error ? <div className="muted">{row.error}</div> : null}</td>
                  <td className="mono">{row.providerMessageId || row.provider || '—'}</td>
                  <td className="muted">{when(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Calls</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Number</th><th>Mode</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {data.calls.map((row) => (
                <tr key={row.id}>
                  <td>{maskPhone(row.phone)}{row.inquiryId ? <> · <Link href={`/inbox/${row.inquiryId}`}>inquiry</Link></> : null}</td>
                  <td>{row.mode}</td>
                  <td>{row.status}{row.summary ? <div className="muted wrap">{row.summary}</div> : null}</td>
                  <td className="muted">{when(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
