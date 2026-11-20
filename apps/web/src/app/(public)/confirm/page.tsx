import Link from 'next/link'
import { sessionSecret } from '../../../lib/token'
import { verifyDeskToken } from '@meridian/core'

export const metadata = { title: 'Email confirmed' }
export const dynamic = 'force-dynamic'

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? ''
  const detail = await confirm(token)
  return (
    <main className="public-wrap">
      <div className="public-card">
        <p className="kicker">Meridian Facilities · Cedarhaven</p>
        <h1>{detail.ok ? "You're confirmed" : 'This link is not valid'}</h1>
        {detail.ok ? (
          <>
            <p className="lede">We can email {detail.email} about this inquiry. An operator still approves anything we send.</p>
            <p>{[detail.name, detail.company].filter(Boolean).join(' · ') || 'Your inquiry is on the desk.'}</p>
            {detail.subject ? <p>{detail.subject}</p> : null}
          </>
        ) : (
          <p className="lede">Ask the desk to send a new confirmation if you still want email.</p>
        )}
        <p className="muted"><Link href="/inquire">Back to the form</Link></p>
      </div>
    </main>
  )
}

async function confirm(token: string): Promise<{ ok: true; email: string; name: string; company: string; subject: string } | { ok: false }> {
  if (!token) return { ok: false }
  if (process.env.WORKER_URL) {
    const response = await fetch(`${process.env.WORKER_URL}/api/public/opt-in?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    if (!response.ok) return { ok: false }
    const body = (await response.json()) as { ok?: boolean; name?: string; company?: string; subject?: string; email?: string }
    if (!body.ok) return { ok: false }
    return { ok: true, email: body.email || '', name: body.name || '', company: body.company || '', subject: body.subject || '' }
  }
  const checked = await verifyDeskToken(sessionSecret(), token)
  if (!checked.ok || checked.payload.purpose !== 'opt-in') return { ok: false }
  return { ok: true, email: checked.payload.email, name: '', company: '', subject: checked.payload.inquiryId }
}
