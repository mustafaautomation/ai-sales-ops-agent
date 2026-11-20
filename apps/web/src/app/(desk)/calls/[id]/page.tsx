import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pill } from '../../../../components/ui'
import { sourceCall } from '../../../../lib/source'
import { when } from '../../../../lib/format'

export const metadata = { title: 'Call' }

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await sourceCall(id)
  if (!detail) notFound()
  const { call, inquiry } = detail
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{call.vapiCallId}</p>
          <h1>{call.companyName || call.callerName || 'Sales call'}</h1>
          <p className="lede">{call.summary || 'No summary stored.'}</p>
        </div>
        <Pill value={call.status} />
      </div>
      <p className="muted">{when(call.createdAt)} · {call.outcome}</p>
      {inquiry ? <p><Link href={`/inbox/${inquiry.id}`}>Lead: {inquiry.subject}</Link></p> : <p className="muted">No lead linked yet.</p>}
      <pre className="letter">{call.transcript}</pre>
    </>
  )
}
