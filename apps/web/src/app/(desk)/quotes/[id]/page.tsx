import { DISCOUNT_CODES, getQuote } from '@meridian/core'
import { notFound } from 'next/navigation'
import { Pill } from '../../../../components/ui'
import { deskDb } from '../../../../lib/desk'
import { money } from '../../../../lib/format'

export const metadata = { title: 'Quote' }

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = getQuote(deskDb(), id)
  if (!detail) notFound()
  const { quote, lines } = detail
  const discount = quote.discountCode && quote.discountCode in DISCOUNT_CODES
    ? DISCOUNT_CODES[quote.discountCode as keyof typeof DISCOUNT_CODES].label
    : 'None'
  return (
    <article className="sheet">
      <div className="sheet-top">
        <div>
          <p className="kicker">Meridian Facilities · Cedarhaven</p>
          <h1>{quote.number}</h1>
          <p>{quote.companyName}</p>
          <p className="muted">{quote.contactName}</p>
        </div>
        <div>
          <Pill value={quote.status} />
          <p>Valid through {quote.validUntil}</p>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 18 }}>
        <table>
          <caption className="skip">Line items</caption>
          <thead>
            <tr><th>SKU</th><th>Description</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Line</th></tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="mono">{line.sku}</td>
                <td>{line.description}</td>
                <td className="num">{line.qty.toLocaleString('en-US')}</td>
                <td className="num">{money(line.unitPriceCents)}</td>
                <td className="num">{money(line.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="totals">
        <div><span>Subtotal</span><span>{money(quote.subtotalCents)}</span></div>
        <div><span>Discount · {discount}</span><span>{money(quote.discountCents)}</span></div>
        <div><span>Tax {(quote.taxBps / 100).toFixed(2)}%</span><span>{money(quote.taxCents)}</span></div>
        <div className="grand"><span>Total</span><strong>{money(quote.totalCents)}</strong></div>
      </div>
      {quote.notes ? <p className="muted">{quote.notes}</p> : null}
    </article>
  )
}
