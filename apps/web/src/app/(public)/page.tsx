import Link from 'next/link'
import { enterDemoDesk } from './actions'
import stats from '../../generated/repo-stats.json'

export const metadata = {
  title: 'Meridian',
  description: 'Synthetic sales operations desk for commercial cleaning inquiries.',
}

const CI_JOBS = ['lint', 'typecheck', 'unit', 'contract', 'evals', 'e2e', 'docker'] as const

export default function LandingPage() {
  return (
    <main className="public-wrap landing">
      <div className="public-hero">
        <p className="kicker">Synthetic demo · Meridian Facilities</p>
        <h1>Meridian</h1>
        <p className="lede" style={{ marginInline: 'auto' }}>
          A desk that turns inbound cleaning inquiries into drafted quotes, human approvals, and outbound mail—with
          auditable agent steps.
        </p>
        <span className="demo-label" style={{ marginTop: 16 }}>
          All companies, mail, and CRM records in this repo are fictional.
        </span>
        <div className="row-actions" style={{ marginTop: 20, justifyContent: 'center' }}>
          <form action={enterDemoDesk}>
            <button className="btn primary" type="submit">
              Open demo desk
            </button>
          </form>
          <Link className="btn" href="/inquire">
            Send a test inquiry
          </Link>
          <a className="btn ghost" href="https://github.com/mustafaautomation/ai-sales-ops-agent" target="_blank" rel="noreferrer">
            View source on GitHub
          </a>
        </div>
      </div>

      <figure className="desk-preview">
        <img
          src="/media/desk-preview.png"
          alt="Meridian desk overview with open inquiries, approval queue, and recent runs"
          width={1440}
          height={900}
        />
        <figcaption className="muted">Live desk overview from the running app</figcaption>
      </figure>

      <div className="public-card wide">
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>How a quote moves through the desk</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          A visitor submits an inquiry. The agent classifies intent, searches the knowledge base, pulls rate-card
          prices, and drafts a quote with code-computed line totals. A human approves the send on the desk; only then
          does outbound email leave the system.
        </p>

        <div className="pipeline" aria-label="Inquiry pipeline">
          <div className="pipeline-step active">
            <span>Step 1</span>
            Inquiry received
          </div>
          <div className="pipeline-step active">
            <span>Step 2</span>
            Classify &amp; search KB
          </div>
          <div className="pipeline-step active">
            <span>Step 3</span>
            Draft quote (computed totals)
          </div>
          <div className="pipeline-step active">
            <span>Step 4</span>
            Human approval → email
          </div>
        </div>

        <h2 style={{ margin: '24px 0 8px', fontSize: 16, fontWeight: 600 }}>How it&apos;s tested</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          GitHub Actions CI runs {CI_JOBS.length} jobs on every push and pull request: {CI_JOBS.join(', ')}.
        </p>
        <div className="test-grid">
          <article>
            <span className="kicker">Unit tests</span>
            <strong>{stats.unitFiles} files</strong>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {stats.unitTests} unit tests across core, worker, and web (plus a separate OpenAPI contract suite).
            </p>
          </article>
          <article>
            <span className="kicker">Eval scenarios</span>
            <strong>{stats.evalScenarios}</strong>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Catalog-grounded agent scenarios in <code className="mono">evals/scenarios.ts</code>.
            </p>
          </article>
          <article>
            <span className="kicker">End-to-end</span>
            <strong>Playwright</strong>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Browser tests for inquiry → quote → approval → CRM paths.
            </p>
          </article>
        </div>
      </div>
    </main>
  )
}
