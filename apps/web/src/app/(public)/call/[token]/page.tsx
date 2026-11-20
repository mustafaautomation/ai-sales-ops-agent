import Link from 'next/link'
import { SalesLine } from '../../../../components/sales-line'
import { voiceMode } from '../../../../lib/source'

export const metadata = { title: 'Talk to Meridian' }
export const dynamic = 'force-dynamic'

export default async function LeadCallPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const mode = await voiceMode()
  const context = await loadContext(token)
  return (
    <main className="public-wrap">
      <div className="public-card">
        <p className="kicker">Meridian Facilities · Cedarhaven</p>
        <h1>Talk to Meridian</h1>
        <p className="lede">
          {context ? `${context.name} at ${context.company || 'your company'}. ${context.subject}` : 'This link is not valid or it has expired.'}
        </p>
        {context ? <SalesLine mode={mode} variableValues={{ name: context.name, company: context.company, subject: context.subject }} /> : null}
        <p className="muted">
          Prefer to write? Use the <Link href="/inquire">inquiry form</Link>.
        </p>
      </div>
    </main>
  )
}

async function loadContext(token: string): Promise<{ name: string; company: string; subject: string } | null> {
  if (!process.env.WORKER_URL) return null
  const response = await fetch(`${process.env.WORKER_URL}/api/public/call-context?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
  if (!response.ok) return null
  return response.json() as Promise<{ name: string; company: string; subject: string }>
}
