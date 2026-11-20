import { getInquiry, getRun } from '@meridian/core'
import { sourceApprovals } from '../../../lib/source'
import Link from 'next/link'
import { Pill } from '../../../components/ui'
import { deskDb } from '../../../lib/desk'
import { when } from '../../../lib/format'

export const metadata = { title: 'Approvals' }

export default async function ApprovalsPage() {
  const db = deskDb()
  const rows = await sourceApprovals()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="lede">Outbound email and CRM writes stop here. Read-only tools do not.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="skip">Approvals</caption>
          <thead>
            <tr><th>Tool</th><th>Inquiry</th><th>Status</th><th>When</th></tr>
          </thead>
          <tbody>
            {rows.map((approval) => {
              const run = getRun(db, approval.runId)
              const inquiry = run ? getInquiry(db, run.inquiryId) : null
              return (
                <tr key={approval.id}>
                  <td><Link href={`/approvals/${approval.id}`}><strong>{approval.toolName}</strong></Link></td>
                  <td>{inquiry?.subject ?? '—'}</td>
                  <td><Pill value={approval.status} /></td>
                  <td className="muted">{when(approval.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
