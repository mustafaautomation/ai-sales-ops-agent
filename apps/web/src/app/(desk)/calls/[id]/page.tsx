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
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li><Link href="/calls">Calls</Link></li>
              <li><span aria-current="page">{humanizeCallId(call.vapiCallId)}</span></li>
            </ol>
          </nav>
          <h1>{call.companyName || call.callerName || 'Sales call'}</h1>
          <p className="lede">{call.summary || 'No summary stored.'}</p>
        </div>
        <Pill value={call.status} />
      </div>
      <section className="run-hero" aria-label="Call summary">
        <div><span>Caller</span><strong>{call.callerName || 'Unknown'}</strong></div>
        <div><span>When</span><strong>{deskWhen(call.createdAt)}</strong></div>
        <div><span>Outcome</span><strong>{humanize(call.outcome)}</strong></div>
        <div><span>Lead</span><strong>{inquiry ? 'Linked' : 'Not linked yet'}</strong></div>
      </section>
      {inquiry ? <p><Link className="more" href={`/inbox/${inquiry.id}`}>Lead: {inquiry.subject}</Link></p> : <p className="muted">No lead linked yet.</p>}
      <p className="kicker" style={{ margin: '18px 0 8px' }}>Transcript</p>
      <pre className="letter message-body">{cleanTranscript(call.transcript)}</pre>
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
