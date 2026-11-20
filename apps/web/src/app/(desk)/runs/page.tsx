import Link from 'next/link'
import { EmptyState, Pill } from '../../../components/ui'
import { formatRunDuration, providerDisplayName, when } from '../../../lib/format'
import { sourceRuns } from '../../../lib/source'

export const metadata = { title: 'Runs' }

export default async function RunsPage() {
  const rows = await sourceRuns()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Runs</h1>
          <p className="lede">Every agent pass over an inquiry, with provider and duration.</p>
        </div>
      </div>
      {rows.length === 0 ? <EmptyState title="No runs" description="Submit an inquiry or sync the inbox to start one." /> : null}
      <div className="table-wrap stack-cards" data-stack="runs">
        <table>
          <caption className="skip">Runs</caption>
          <thead>
            <tr>
              <th>Inquiry</th>
              <th>Status</th>
              <th>Intent</th>
              <th>Provider</th>
              <th>Duration</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <tr key={run.id}>
                <td data-label="Inquiry">
                  <Link href={`/runs/${run.id}`}>
                    <strong>{run.companyName || run.fromName || 'Run'}</strong>
                  </Link>
                  <div className="muted">{run.subject || run.id}</div>
                </td>
                <td data-label="Status"><Pill value={run.status} /></td>
                <td data-label="Intent"><Pill value={run.intent} /></td>
                <td data-label="Provider">{providerDisplayName(run.provider)}</td>
                <td data-label="Duration">{formatRunDuration(run.agentMs)}</td>
                <td className="muted" data-label="When">{when(run.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
