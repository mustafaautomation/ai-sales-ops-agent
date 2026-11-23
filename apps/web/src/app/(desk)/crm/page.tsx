import { sourceCrm } from '../../../lib/source'
import { avatarTone, initials, money } from '../../../lib/format'

export const metadata = { title: 'CRM' }

const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const

function contactsLabel(count: number): string {
  return `${count} ${count === 1 ? 'contact' : 'contacts'}`
}

export default async function CrmPage() {
  const { companies, contacts, deals } = await sourceCrm()
  const companyName = new Map(companies.map((company) => [company.id, company.name]))
  return (
    <>
      <div className="page-head">
        <div>
          <h1>CRM</h1>
          <p className="lede">The board mixes the mock CRM’s existing book with deals the desk wrote after approval.</p>
        </div>
      </div>
      <div className="kanban">
        {STAGES.map((stage) => {
          const inStage = deals.filter((deal) => deal.stage === stage)
          return (
          <section className="col" key={stage}>
            <h2><span>{stage} · {inStage.length}</span><span className="money">{money(inStage.reduce((sum, deal) => sum + deal.amountCents, 0))}</span></h2>
            {inStage.length === 0 ? <p className="faint" style={{ margin: '4px', fontSize: 12.5 }}>No deals</p> : null}
            {inStage.map((deal) => (
              <article className="deal" key={deal.id}>
                <strong>{companyName.get(deal.companyId) || 'Company'}</strong>
                <span className="muted">{deal.title}</span>
                <div className="money">{money(deal.amountCents)}</div>
                <span className={deal.source === 'agent' ? 'chip gate' : 'chip'} style={{ marginTop: 6 }}>{deal.source === 'agent' ? 'Written by the desk' : 'Existing book'}</span>
              </article>
            ))}
          </section>
          )
        })}
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Companies</h2>
        {companies.map((company) => (
          <div className="list-link" key={company.id}>
            <span className="row-main">
              <span className={`avatar ${avatarTone(company.name)}`} aria-hidden="true">{initials(company.name)}</span>
              <span>{company.name}</span>
            </span>
            <span className="muted">{contactsLabel(contacts.filter((contact) => contact.companyId === company.id).length)}</span>
          </div>
        ))}
      </section>
    </>
  )
}
