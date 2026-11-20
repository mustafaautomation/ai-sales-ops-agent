import { sourceInquiries } from '../../../lib/source'
import Link from 'next/link'
import { Pill } from '../../../components/ui'
import { syncNow } from '../actions'
import { when } from '../../../lib/format'

export const metadata = { title: 'Inbox' }

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const query = await searchParams
  const source = query.source
  const rows = (await sourceInquiries()).filter((row) => !source || row.source === source)
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="lede">Mail from the mock inbox and the public form. Each new note is classified before anyone replies.</p>
        </div>
        <form action={syncNow}>
          <button className="btn" type="submit">Sync inbox</button>
        </form>
      </div>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <Link className="btn small" href="/inbox">All</Link>
        <Link className="btn small" href="/inbox?source=email">Email</Link>
        <Link className="btn small" href="/inbox?source=web">Web form</Link>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="skip">Inquiries</caption>
          <thead>
            <tr>
              <th>From</th>
              <th>Subject</th>
              <th>Source</th>
              <th>Intent</th>
              <th>Status</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/inbox/${row.id}`}><strong>{row.companyName || row.fromName}</strong></Link>
                  <div className="muted">{row.fromName}</div>
                </td>
                <td>{row.subject}</td>
                <td>{row.source}</td>
                <td><Pill value={row.intent} /></td>
                <td><Pill value={row.status} /></td>
                <td className="muted">{when(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
