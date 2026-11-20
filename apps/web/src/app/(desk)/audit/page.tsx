import { listAudit } from '@meridian/core'
import { deskDb } from '../../../lib/desk'
import { when } from '../../../lib/format'

export const metadata = { title: 'Audit' }

export default function AuditPage() {
  const rows = listAudit(deskDb())
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit</h1>
          <p className="lede">Every classification, tool, and approval decision. Detail text is redacted before it is stored.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="skip">Audit log</caption>
          <thead>
            <tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="muted">{when(row.at)}</td>
                <td>{row.actor}</td>
                <td className="mono">{row.action}</td>
                <td className="mono">{row.entityType}</td>
                <td className="mono">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
