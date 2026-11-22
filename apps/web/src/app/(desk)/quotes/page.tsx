import { sourceQuotes } from '../../../lib/source'
import Link from 'next/link'
import { EmptyState, Pill } from '../../../components/ui'
import { avatarTone, initials, money, when } from '../../../lib/format'

export const metadata = { title: 'Quotes' }

export default async function QuotesPage() {
  const rows = await sourceQuotes()
  const sent = rows.filter((quote) => quote.status === 'sent')
  const drafts = rows.filter((quote) => quote.status !== 'sent' && quote.status !== 'void')
  const sum = (list: typeof rows) => list.reduce((total, quote) => total + quote.totalCents, 0)
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Quotes</h1>
          <p className="lede">Totals are computed from the rate card. The model does not do the arithmetic.</p>
        </div>
      </div>
      <section className="statline" style={{ marginBottom: 16, background: 'var(--elev)' }} aria-label="Quote totals">
        <div><span>Quotes</span><strong>{rows.length}</strong></div>
        <div><span>Sent after approval</span><strong>{sent.length} · {money(sum(sent))}</strong></div>
        <div><span>Waiting on an operator</span><strong>{drafts.length} · {money(sum(drafts))}</strong></div>
      </section>
      {rows.length === 0 ? <EmptyState title="No quotes yet" description="A quote appears here once the agent prices an inquiry from the rate card." /> : null}
      <div className="table-wrap">
        <table>
          <caption className="skip">Quotes</caption>
          <thead>
            <tr><th>Number</th><th>Company</th><th>Status</th><th>Valid</th><th className="num">Total</th><th>Drafted</th></tr>
          </thead>
          <tbody>
            {rows.map((quote) => (
              <tr key={quote.id}>
                <td className="mono"><Link href={`/quotes/${quote.id}`}>{quote.number}</Link></td>
                <td>
                  <div className="cell-who">
                    <span className={`avatar ${avatarTone(quote.companyName)}`} aria-hidden="true">{initials(quote.companyName)}</span>
                    <div>{quote.companyName}</div>
                  </div>
                </td>
                <td><Pill value={quote.status} /></td>
                <td>{quote.validUntil}</td>
                <td className="num money">{money(quote.totalCents)}</td>
                <td className="muted">{when(quote.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
