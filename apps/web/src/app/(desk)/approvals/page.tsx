import { toolLabel } from '@meridian/core'
import { sourceApprovals } from '../../../lib/source'
import Link from 'next/link'
import { EmptyState, Pill } from '../../../components/ui'
import { when } from '../../../lib/format'

export const metadata = { title: 'Approvals' }

export default async function ApprovalsPage() {
  const rows = await sourceApprovals()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="lede">Outbound email and CRM writes stop here. Read-only tools do not.</p>
        </div>
      </div>
      {rows.length === 0 ? <EmptyState title="No approvals" description="Nothing is waiting for an operator." /> : null}
      <div className="table-wrap">
        <table>
          <caption className="skip">Approvals</caption>
          <thead>
            <tr><th>Action</th><th>Inquiry</th><th>Status</th><th>When</th></tr>
          </thead>
          <tbody>
            {rows.map((approval) => {
              return (
                <tr key={approval.id}>
                  <td>
                    <Link href={`/approvals/${approval.id}`}><strong>{toolLabel(approval.toolName)}</strong></Link>
                    {/follow-up/i.test(approval.note ?? '') ? <div className="muted">Needs a follow-up</div> : null}
                  </td>
                  <td>{approval.inquirySubject ?? '—'}</td>
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
