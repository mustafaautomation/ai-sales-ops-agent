import { sourceInquiries } from '../../../lib/source'
import Link from 'next/link'
import { ReadOnlyButton } from '../../../components/read-only'
import { Pill } from '../../../components/ui'
import { isDemoSession } from '../../../lib/session'
import { syncNow } from '../actions'
import { RefreshCw } from 'lucide-react'
import { avatarTone, initials, when } from '../../../lib/format'

export const metadata = { title: 'Inbox' }

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const query = await searchParams
  const source = query.source
  const readOnly = await isDemoSession()
  const all = await sourceInquiries()
  const rows = all.filter((row) => !source || row.source === source)
  const count = (value: string) => all.filter((row) => row.source === value).length
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="lede">Mail from the mock inbox and the public form. Each new note is classified before anyone replies.</p>
        </div>
        {readOnly ? (
          <ReadOnlyButton className="btn">Sync inbox</ReadOnlyButton>
        ) : (
          <form action={syncNow}>
            <button className="btn" type="submit"><RefreshCw aria-hidden="true" />Sync inbox</button>
          </form>
        )}
      </div>
      <nav className="filters" aria-label="Filter by source">
        <Link className={!source ? 'active' : undefined} href="/inbox">All <b>{all.length}</b></Link>
        <Link className={source === 'email' ? 'active' : undefined} href="/inbox?source=email">Email <b>{count('email')}</b></Link>
        <Link className={source === 'web' ? 'active' : undefined} href="/inbox?source=web">Web form <b>{count('web')}</b></Link>
      </nav>
      <div className="table-wrap stack-cards" data-stack="inbox">
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
                <td data-label="From">
                  <div className="cell-who">
                    <span className={`avatar ${avatarTone(row.companyName || row.fromName)}`} aria-hidden="true">{initials(row.companyName || row.fromName)}</span>
                    <div>
                      <Link href={`/inbox/${row.id}`}><strong>{row.companyName || row.fromName}</strong></Link>
                      <div className="muted">{row.fromName}</div>
                    </div>
                  </div>
                </td>
                <td data-label="Subject">{row.subject}</td>
                <td data-label="Source" className={row.source === 'email' ? 'source-email' : undefined}>{row.source === 'web' ? 'Web form' : row.source === 'email' ? 'Email' : row.source}</td>
                <td data-label="Intent"><Pill value={row.intent} /></td>
                <td data-label="Status"><Pill value={row.status} /></td>
                <td className="muted" data-label="When">{when(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
