import { listQuotes } from '@meridian/core'
import Link from 'next/link'
import { Pill } from '../../../components/ui'
import { deskDb } from '../../../lib/desk'
import { money, when } from '../../../lib/format'

export const metadata = { title: 'Quotes' }

export default function QuotesPage() {
  const rows = listQuotes(deskDb())
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Quotes</h1>
          <p className="lede">Totals are computed from the rate card. The model does not do the arithmetic.</p>
        </div>
      </div>
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
                <td>{quote.companyName}</td>
                <td><Pill value={quote.status} /></td>
                <td>{quote.validUntil}</td>
                <td className="num">{money(quote.totalCents)}</td>
                <td className="muted">{when(quote.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
