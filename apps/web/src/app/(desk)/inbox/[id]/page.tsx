import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pill } from '../../../../components/ui'
import { rerun } from '../../actions'
import { sourceInquiry } from '../../../../lib/source'
import { when } from '../../../../lib/format'

export const metadata = { title: 'Inquiry' }

export default async function InquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await sourceInquiry(id)
  if (!detail) notFound()
  const { inquiry, runs } = detail
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{inquiry.source}</p>
          <h1>{inquiry.subject}</h1>
          <p className="lede">{inquiry.companyName || inquiry.fromName} · {when(inquiry.createdAt)}</p>
        </div>
        <div className="row-actions">
          <Pill value={inquiry.intent} />
          <Pill value={inquiry.status} />
          {runs[0] ? <Link className="btn primary" href={`/runs/${runs[0].id}`}>Open run</Link> : null}
          <form action={rerun}>
            <input type="hidden" name="inquiryId" value={inquiry.id} />
            <button className="btn" type="submit">Run again</button>
          </form>
        </div>
      </div>
      {inquiry.injectionFlag ? <p className="notice warn">The body contained text that looks like an instruction to the agent. It was tagged and was not followed.</p> : null}
      <pre className="letter">{inquiry.body}</pre>
    </>
  )
}
