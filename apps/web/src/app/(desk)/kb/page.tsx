import { getDocumentBySlug, listDocuments, searchChunks, loadChunks } from '@meridian/core'
import Link from 'next/link'
import { deskDb } from '../../../lib/desk'

export const metadata = { title: 'Knowledge' }

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ doc?: string; q?: string }> }) {
  const query = await searchParams
  const db = deskDb()
  const docs = listDocuments(db)
  const selected = getDocumentBySlug(db, query.doc || docs[0]?.slug || '')
  const hits = query.q ? searchChunks(loadChunks(db), query.q, 6) : []
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Knowledge</h1>
          <p className="lede">Answers cite these notes. Retrieval is term overlap over the chunks, not an external embedding API.</p>
        </div>
      </div>
      <form className="row-actions" action="/kb">
        <input name="q" defaultValue={query.q || ''} placeholder="Search the notes" aria-label="Search the notes" />
        <button className="btn" type="submit">Search</button>
      </form>
      {hits.length > 0 ? (
        <section className="card">
          {hits.map((hit) => (
            <div className="hit" key={`${hit.slug}-${hit.ordinal}`}>
              <Link href={`/kb?doc=${hit.slug}`}><strong>{hit.title}</strong> — {hit.heading}</Link>
              <p>{hit.content.slice(0, 280)}</p>
            </div>
          ))}
        </section>
      ) : null}
      <div className="kb">
        <aside className="doc-card">
          {docs.map((doc) => (
            <Link key={doc.id} href={`/kb?doc=${doc.slug}`} className={selected?.doc.slug === doc.slug ? 'active' : undefined}>
              {doc.title}
            </Link>
          ))}
        </aside>
        <article className="card prose">
          {selected?.doc.body.split('\n').map((line, index) => {
            if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>
            if (!line.trim()) return <br key={index} />
            return <p key={index}>{line}</p>
          })}
        </article>
      </div>
    </>
  )
}
