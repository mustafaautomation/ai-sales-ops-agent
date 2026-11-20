import Link from 'next/link'
import { Pill } from '../../../components/ui'
import { sourceCalls } from '../../../lib/source'
import { when } from '../../../lib/format'

export const metadata = { title: 'Calls' }

export default async function CallsPage() {
  const rows = await sourceCalls()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calls</h1>
          <p className="lede">Sales-line calls. A formal quote or CRM write from a call still waits in the approval queue.</p>
        </div>
        <Link className="btn" href="/call">Open the public line</Link>
      </div>
      {rows.length === 0 ? <p className="muted">No calls yet.</p> : null}
      <div className="table-wrap">
        <table>
          <caption className="skip">Calls</caption>
          <thead>
            <tr><th>Caller</th><th>Status</th><th>Summary</th><th>Outcome</th><th>When</th></tr>
          </thead>
          <tbody>
            {rows.map((call) => (
              <tr key={call.id}>
                <td>
                  <Link href={`/calls/${call.id}`}><strong>{call.companyName || call.callerName || 'Caller'}</strong></Link>
                  <div className="muted">{callCaption(call)}</div>
                </td>
                <td><Pill value={call.status} /></td>
                <td>{call.summary}</td>
                <td>{call.outcome}</td>
                <td className="muted">{when(call.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function callCaption(call: { outcome: string | null; status: string; startedAt: number | null; endedAt: number | null }): string {
  const label = (call.outcome || call.status || 'Sales line').replaceAll('_', ' ').replaceAll('-', ' ')
  if (call.startedAt && call.endedAt && call.endedAt >= call.startedAt) {
    const seconds = Math.max(1, Math.round((call.endedAt - call.startedAt) / 1000))
    return `${label} · ${seconds}s`
  }
  return label
}
