import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ApprovalEditor } from '../../../../components/approval-editor'
import { ApprovalPreview } from '../../../../components/approval-preview'
import { JsonBlock, Notice, PageHeader, Pill } from '../../../../components/ui'
import { approvalPagePayload, approvalTitle } from '../../../../lib/approval-view'
import { isDemoSession } from '../../../../lib/session'
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
  const readOnly = await isDemoSession()
  const mode = approval.toolName === 'request_callback' ? (await sourceIntegrations()).callMode : undefined
  const title = approvalTitle(approval.toolName, approval.proposedJson)
  const view = approvalPagePayload(approval.proposedJson, approval.finalJson)
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Approvals', href: '/approvals' },
          { label: title },
        ]}
        kicker={inquiry?.subject}
        title={title}
        description={
          approval.toolName === 'request_callback'
            ? 'Approving places the callback. The number stays on this screen so you can check it.'
            : 'The audit log stores a redacted copy. This screen keeps the address so you can review the send.'
        }
        actions={<Pill value={approval.status} />}
      />
      {query.error ? <Notice tone="warn">{query.error}</Notice> : null}
      {approval.note ? <Notice tone="warn">{approval.note}</Notice> : null}
      <ApprovalPreview tool={approval.toolName} payload={view.display} mode={mode} />
      {approval.status === 'pending' ? (
        <ApprovalEditor id={approval.id} proposed={view.proposed} readOnly={readOnly} />
      ) : (
        <JsonBlock value={view.display} label="Raw payload" />
      )}
      {run ? <p><Link href={`/runs/${run.id}`}>Back to the run</Link></p> : null}
    </>
  )
}
