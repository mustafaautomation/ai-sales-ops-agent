import { sourceAudit } from '../../../lib/source'
import { auditEventLabel, when } from '../../../lib/format'

export const metadata = { title: 'Audit' }

export default async function AuditPage() {
  const rows = await sourceAudit()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit</h1>
          <p className="lede">Every classification, tool, and approval decision. Detail text is redacted before it is stored.</p>
        </div>
      </div>
      <div className="table-wrap stack-cards" data-stack="audit">
        <table>
          <caption className="skip">Audit log</caption>
          <thead>
            <tr><th>When</th><th>Actor</th><th>Event</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="muted" data-label="When">{when(row.at)}</td>
                <td data-label="Actor">{row.actor}</td>
                <td data-label="Event">{auditEventLabel(row)}</td>
                <td data-label="Details">
                  <details className="audit-details">
                    <summary>Details</summary>
                    <dl className="fields">
                      <div><dt>Action</dt><dd className="mono">{row.action}</dd></div>
                      <div><dt>Entity</dt><dd className="mono">{row.entityType}{row.entityId ? ` · ${row.entityId}` : ''}</dd></div>
                      {row.detail ? <div><dt>Payload</dt><dd><pre className="json">{prettyJson(row.detail)}</pre></dd></div> : null}
                    </dl>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
