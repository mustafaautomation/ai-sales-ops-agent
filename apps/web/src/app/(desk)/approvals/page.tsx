import { sourceApprovals } from '../../../lib/source'
import Link from 'next/link'
import { EmptyState, Pill } from '../../../components/ui'
import { StepIcon } from '../../../components/step-icon'
import { approvalTitle } from '../../../lib/approval-view'
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
      <section className="statline" style={{ marginBottom: 16, background: 'var(--elev)' }} aria-label="Approval counts">
        <div><span>Pending</span><strong>{rows.filter((row) => row.status === 'pending').length}</strong></div>
        <div><span>Executed</span><strong>{rows.filter((row) => row.status === 'executed').length}</strong></div>
        <div><span>Rejected</span><strong>{rows.filter((row) => row.status === 'rejected').length}</strong></div>
      </section>
      {rows.length === 0 ? <EmptyState title="No approvals" description="Nothing is waiting for an operator." /> : null}
      <div className="table-wrap stack-cards" data-stack="approvals">
        <table>
          <caption className="skip">Approvals</caption>
          <thead>
            <tr><th>Action</th><th>Inquiry</th><th>Status</th><th>When</th></tr>
          </thead>
          <tbody>
            {rows.map((approval) => {
              return (
                <tr key={approval.id}>
                  <td data-label="Action">
                    <div className="cell-who">
                      <span className="metric-ico"><StepIcon tool={approval.toolName} /></span>
                      <div>
                        <Link href={`/approvals/${approval.id}`}><strong>{approvalTitle(approval.toolName, approval.proposedJson)}</strong></Link>
                        {/follow-up/i.test(approval.note ?? '') ? <div className="muted">Needs a follow-up</div> : null}
                      </div>
                    </div>
                  </td>
                  <td data-label="Inquiry">{approval.inquirySubject ?? '—'}</td>
                  <td data-label="Status"><Pill value={approval.status} /></td>
                  <td className="muted" data-label="When">{when(approval.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
