import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ApprovalEditor } from '../../../../components/approval-editor'
import { ApprovalPreview } from '../../../../components/approval-preview'
import { JsonBlock, Notice, Pill } from '../../../../components/ui'
import { sourceApproval, sourceIntegrations } from '../../../../lib/source'

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
  const detail = await sourceApproval(id)
  if (!detail) notFound()
  const { approval, run, inquiry } = detail
  const mode = approval.toolName === 'request_callback' ? (await sourceIntegrations()).callMode : undefined
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{inquiry?.subject}</p>
          <h1>{approval.toolName}</h1>
          <p className="lede">{approval.toolName === 'request_callback' ? 'Approving places the callback. The number stays on this screen so you can check it.' : 'The audit log stores a redacted copy. This screen keeps the address so you can review the send.'}</p>
        </div>
        <Pill value={approval.status} />
      </div>
      {query.error ? <Notice tone="warn">{query.error}</Notice> : null}
      {approval.note ? <Notice tone="warn">{approval.note}</Notice> : null}
      <ApprovalPreview tool={approval.toolName} payload={approval.finalJson || approval.proposedJson} mode={mode} />
      {approval.status === 'pending' ? (
        <ApprovalEditor id={approval.id} proposed={approval.proposedJson} />
      ) : (
        <JsonBlock value={approval.finalJson || approval.proposedJson} label="Raw payload" />
      )}
      {run ? <p><Link href={`/runs/${run.id}`}>Back to the run</Link></p> : null}
    </>
  )
}
