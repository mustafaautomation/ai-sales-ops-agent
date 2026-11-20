import { listCompanies, listContacts, listDeals } from '@meridian/core'
import { deskDb } from '../../../lib/desk'
import { money } from '../../../lib/format'

export const metadata = { title: 'CRM' }

const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const

export default function CrmPage() {
  const db = deskDb()
  const companies = listCompanies(db)
  const contacts = listContacts(db)
  const deals = listDeals(db)
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
        {STAGES.map((stage) => (
          <section className="col" key={stage}>
            <h2>{stage}</h2>
            {deals.filter((deal) => deal.stage === stage).map((deal) => (
              <article className="deal" key={deal.id}>
                <strong>{companyName.get(deal.companyId) || 'Company'}</strong>
                <span className="muted">{deal.title}</span>
                <div>{money(deal.amountCents)}</div>
                <span className="faint">{deal.source}</span>
              </article>
            ))}
          </section>
        ))}
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Companies</h2>
        {companies.map((company) => (
          <div className="list-link" key={company.id}>
            <span>{company.name}</span>
            <span className="muted">{contacts.filter((contact) => contact.companyId === company.id).length} contacts</span>
          </div>
        ))}
      </section>
    </>
  )
}
