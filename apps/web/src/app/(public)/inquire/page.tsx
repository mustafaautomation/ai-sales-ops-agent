import Link from 'next/link'
import { submitInquiry } from '../actions'
import { Notice } from '../../../components/ui'

export const metadata = { title: 'Request a quote' }

export default async function InquirePage({ searchParams }: { searchParams: Promise<{ received?: string; error?: string }> }) {
  const query = await searchParams
  return (
    <main className="public-wrap">
      <div className="public-card">
        <p className="kicker">Meridian Facilities · Cedarhaven</p>
        <h1>Ask the desk</h1>
        <p className="lede">
          Commercial workplace cleaning. The desk can draft an answer or a quote. Nothing is emailed until an operator approves it.
        </p>
        {query.received ? <Notice>Inquiry received. Reference {query.received}.</Notice> : null}
        {query.error ? <Notice tone="warn">{query.error}</Notice> : null}
        <form action={submitInquiry}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" required minLength={2} />
          </div>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="company">Company</label>
            <input id="company" name="company" required minLength={2} />
          </div>
          <div className="field">
            <label htmlFor="subject">Subject</label>
            <input id="subject" name="subject" required minLength={2} defaultValue="Quote request" />
          </div>
          <div className="field">
            <label htmlFor="message">What do you need?</label>
            <textarea id="message" name="message" required minLength={8} rows={6} placeholder="Nightly cleaning for 8,000 sqft and 2 restrooms. Annual contract." />
          </div>
          <button className="btn primary" type="submit">Submit inquiry</button>
        </form>
        <p className="muted">
          Operators sign in at the <Link href="/login">desk</Link>.
        </p>
      </div>
    </main>
  )
}
