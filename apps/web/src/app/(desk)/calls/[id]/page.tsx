import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pill } from '../../../../components/ui'
import { sourceCall } from '../../../../lib/source'
import { cleanTranscript, deskWhen } from '../../../../lib/format'

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
          <p className="muted">{humanizeCallId(call.vapiCallId)}</p>
          <h1>{call.companyName || call.callerName || 'Sales call'}</h1>
          <p className="lede">{call.summary || 'No summary stored.'}</p>
        </div>
        <Pill value={call.status} />
      </div>
      <p className="muted">{deskWhen(call.createdAt)} · {humanize(call.outcome)}</p>
      {inquiry ? <p><Link href={`/inbox/${inquiry.id}`}>Lead: {inquiry.subject}</Link></p> : <p className="muted">No lead linked yet.</p>}
      <pre className="letter">{cleanTranscript(call.transcript)}</pre>
    </>
  )
}

function humanizeCallId(value: string | null): string {
  if (!value) return 'Sales call'
  if (/^[0-9a-f-]{16,}$/i.test(value)) return 'Web call'
  const words = value.replaceAll('_', ' ').replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function humanize(value: string | null): string {
  if (!value) return 'No outcome yet'
  const words = value.replaceAll('_', ' ').replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
