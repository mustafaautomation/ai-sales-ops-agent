import Link from 'next/link'
import { SalesLine } from '../../../components/sales-line'

export const metadata = { title: 'Sales line' }

export default function CallPage() {
  return (
    <main className="public-wrap">
      <div className="public-card">
        <p className="kicker">Meridian Facilities · Cedarhaven</p>
        <h1>Call our sales line</h1>
        <p className="lede">
          Ask about commercial cleaning, the service area, or a ballpark from the rate card. A formal quote is not sent on the call.
        </p>
        <SalesLine />
        <p className="muted">
          Prefer to write? Use the <Link href="/inquire">inquiry form</Link>.
        </p>
      </div>
    </main>
  )
}
