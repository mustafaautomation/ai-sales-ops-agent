import Link from 'next/link'
import { sessionSecret } from '../../../lib/token'
import { verifyDeskToken } from '@meridian/core'

export const metadata = { title: 'Unsubscribed' }
export const dynamic = 'force-dynamic'

export default async function UnsubscribedPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? ''
  const ok = await unsubscribe(token)
  return (
    <main className="public-wrap">
      <div className="public-card">
        <p className="kicker">Meridian Facilities · Cedarhaven</p>
        <h1>{ok ? 'You are unsubscribed' : 'This link is not valid'}</h1>
        <p className="lede">{ok ? 'We will not email you or call you about this desk again.' : 'The unsubscribe link could not be checked.'}</p>
        <p className="muted"><Link href="/inquire">Back to the form</Link></p>
      </div>
    </main>
  )
}

async function unsubscribe(token: string): Promise<boolean> {
  if (!token) return false
  if (process.env.WORKER_URL) {
    const response = await fetch(`${process.env.WORKER_URL}/api/public/unsubscribe?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    return response.ok
  }
  const checked = await verifyDeskToken(sessionSecret(), token)
  return checked.ok && checked.payload.purpose === 'unsubscribe'
}
