import Link from 'next/link'
import { verifyDeskToken } from '@meridian/core'
import { SalesLine } from '../../../../components/sales-line'
import { ensureBoot } from '../../../../lib/boot'
import { deskDb } from '../../../../lib/desk'
import { voiceMode } from '../../../../lib/source'
import { sessionSecret } from '../../../../lib/token'

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
        {context ? <SalesLine mode={mode} token={token} variableValues={{ name: context.name, company: context.company, subject: context.subject, inquiryId: context.inquiryId }} /> : null}
        <p className="muted">
          Prefer to write? Use the <Link href="/inquire">inquiry form</Link>.
        </p>
      </div>
    </main>
  )
}

async function loadContext(token: string): Promise<{ name: string; company: string; subject: string; inquiryId: string } | null> {
  if (process.env.WORKER_URL) {
    const response = await fetch(`${process.env.WORKER_URL}/api/public/call-context?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    if (!response.ok) return null
    const body = await response.json() as { name: string; company: string; subject: string }
    const checked = await verifyDeskToken(sessionSecret(), token)
    return { ...body, inquiryId: checked.ok ? checked.payload.inquiryId : '' }
  }
  const checked = await verifyDeskToken(sessionSecret(), token)
  if (!checked.ok || checked.payload.purpose !== 'call') return null
  await ensureBoot()
  const inquiry = deskDb().$client.prepare(`SELECT from_name, company_name, subject, suppressed_at FROM inquiries WHERE id = ?`).get(checked.payload.inquiryId) as { from_name: string; company_name: string | null; subject: string; suppressed_at: number | null } | undefined
  if (!inquiry || inquiry.suppressed_at) return null
  return { name: inquiry.from_name, company: inquiry.company_name ?? '', subject: inquiry.subject, inquiryId: checked.payload.inquiryId }
}
