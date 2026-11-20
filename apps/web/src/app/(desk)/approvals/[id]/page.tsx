import { getApproval, getInquiry, getRun } from '@meridian/core'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ApprovalEditor } from '../../../../components/approval-editor'
import { JsonBlock, Notice, Pill } from '../../../../components/ui'
import { deskDb } from '../../../../lib/desk'

export const metadata = { title: 'Approval' }

export default async function ApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const approval = getApproval(deskDb(), id)
  if (!approval) notFound()
  const run = getRun(deskDb(), approval.runId)
  const inquiry = run ? getInquiry(deskDb(), run.inquiryId) : null
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{inquiry?.subject}</p>
          <h1>{approval.toolName}</h1>
          <p className="lede">The audit log stores a redacted copy. This screen keeps the address so you can review the send.</p>
        </div>
        <Pill value={approval.status} />
      </div>
      {query.error ? <Notice tone="warn">{query.error}</Notice> : null}
      {approval.note ? <Notice tone="warn">{approval.note}</Notice> : null}
      {approval.status === 'pending' ? (
        <ApprovalEditor id={approval.id} proposed={approval.proposedJson} />
      ) : (
        <JsonBlock value={approval.finalJson || approval.proposedJson} />
      )}
      {run ? <p><Link href={`/runs/${run.id}`}>Back to the run</Link></p> : null}
    </>
  )
}
