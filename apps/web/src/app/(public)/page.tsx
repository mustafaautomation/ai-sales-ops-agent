import {
  ArrowRight,
  BookOpen,
  Calculator,
  Check,
  ChevronRight,
  Code,
  Inbox,
  Layers,
  Mail,
  PhoneCall,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { LogoMark } from '../../components/logo'
import { enterDemoDesk } from './actions'
import stats from '../../generated/repo-stats.json'

export const metadata = {
  title: 'Meridian',
  description: 'Synthetic sales operations desk for commercial cleaning inquiries.',
}

const CI_JOBS = ['lint', 'typecheck', 'unit', 'contract', 'evals', 'e2e', 'docker'] as const
const REPO = 'https://github.com/mustafaautomation/ai-sales-ops-agent'

export default function LandingPage() {
  return (
    <main className="lp">
      <section className="lp-dark">
        <div className="lp-wrap">
          <nav className="lp-nav" aria-label="Site">
            <span className="lp-logo">
              <LogoMark />
              Meridian Desk
            </span>
            <div className="lp-links">
              <a href="#how">How it works</a>
              <a href="#guardrails">Guardrails</a>
              <a href="#tested">Testing</a>
              <Link className="cta" href="/login">Sign in</Link>
            </div>
          </nav>

          <div className="lp-hero">
            <div>
              <span className="lp-badge"><i aria-hidden="true" />Synthetic demo · fictional company, real pipeline</span>
              <h1>
                Meridian turns every inquiry into an <em>approved quote</em>.
              </h1>
              <p className="lp-sub">
                An AI sales desk for a commercial cleaning company. It reads inbound mail, web forms, and calls, answers
                from the knowledge base, prices from the rate card, and waits for a human before anything is sent.
              </p>
              <div className="lp-cta">
                <form action={enterDemoDesk}>
                  <button className="btn primary lg" type="submit">
                    Open demo desk
                    <ArrowRight aria-hidden="true" />
                  </button>
                </form>
                <Link className="btn lg" href="/inquire">
                  Send a test inquiry
                </Link>
                <a className="btn ghost lg" href={REPO} target="_blank" rel="noreferrer">
                  <Code aria-hidden="true" />
                  View source on GitHub
                </a>
              </div>
              <p className="lp-fine">No sign-up. The demo desk is read-only. All companies, mail, and CRM records are fictional.</p>
            </div>

            <div className="lp-run" aria-label="Example agent run">
              <div className="lp-run-top">
                <span><i /><i /><i /></span>
                <span>run · North Wharf Logistics</span>
              </div>
              <div className="lp-mail">
                <b>Nightly cleaning quote</b>
                <small>Priya Shah · email</small>
                <p>“Please quote nightly cleaning for 10,000 sqft and 4 restrooms on an annual contract.”</p>
              </div>
              <ul className="lp-steps">
                <li><Tags aria-hidden="true" /><span>Classified as a quote request</span><small>50 ms</small></li>
                <li><BookOpen aria-hidden="true" /><span>Searched the knowledge base</span><small>4 ms</small></li>
                <li><Calculator aria-hidden="true" /><span>Priced 2 lines from the rate card</span><small>3 ms</small></li>
                <li className="hold"><Users aria-hidden="true" /><span>Update CRM deal</span><small>Needs approval</small></li>
                <li className="hold"><Mail aria-hidden="true" /><span>Send quote email</span><small>Needs approval</small></li>
              </ul>
              <div className="lp-total">
                <span>Quote MF-1001 · annual discount 8% · tax 8.25%</span>
                <strong>$1,454.01</strong>
              </div>
            </div>
          </div>

          <div className="lp-stats">
            <div><strong>{stats.evalScenarios}</strong><span>agent eval scenarios, all passing</span></div>
            <div><strong>{stats.unitTests}</strong><span>unit tests across core, worker, and web</span></div>
            <div><strong>{CI_JOBS.length}</strong><span>CI jobs on every push</span></div>
            <div><strong>0</strong><span>prices the model can invent</span></div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="how">
        <div className="lp-wrap">
          <span className="lp-eyebrow">How it works</span>
          <h2 className="lp-h2">How a quote moves through the desk</h2>
          <p className="lp-lead">
            A visitor submits an inquiry. The agent classifies intent, searches the knowledge base, pulls rate-card
            prices, and drafts a quote with code-computed line totals. A human approves the send on the desk; only then
            does outbound email leave the system.
          </p>
          <div className="pipeline" aria-label="Inquiry pipeline">
            <div className="pipeline-step">
              <div className="metric-ico"><Inbox aria-hidden="true" /></div>
              <span>Step 1</span>
              <b>Inquiry received</b>
              Email, the public web form, or the voice line. Instruction-like text is stripped before the model sees it.
            </div>
            <div className="pipeline-step">
              <div className="metric-ico"><Tags aria-hidden="true" /></div>
              <span>Step 2</span>
              <b>Classify &amp; search KB</b>
              Quote, question, support, spam, or out of scope. Answers cite the note they came from.
            </div>
            <div className="pipeline-step">
              <div className="metric-ico"><Calculator aria-hidden="true" /></div>
              <span>Step 3</span>
              <b>Draft quote (computed totals)</b>
              The model picks SKUs and quantities. Code looks up prices and computes discount, tax, and total.
            </div>
            <div className="pipeline-step gate">
              <div className="metric-ico"><ShieldCheck aria-hidden="true" /></div>
              <span>Step 4</span>
              <b>Human approval → email</b>
              CRM writes and outbound mail stop in a queue until an operator approves, edits, or rejects.
            </div>
          </div>

          <figure className="desk-preview">
            <div className="chrome" aria-hidden="true"><i /><i /><i /><span>sales.quvantic.com/overview</span></div>
            <img
              src="/media/desk-preview.png"
              alt="Meridian desk overview with open inquiries, approval queue, and recent runs"
              width={1440}
              height={900}
            />
            <figcaption className="muted">Live desk overview from the running app</figcaption>
          </figure>
        </div>
      </section>

      <section className="lp-section tight" id="guardrails">
        <div className="lp-wrap">
          <span className="lp-eyebrow">Guardrails</span>
          <h2 className="lp-h2">Built so the model cannot go off script</h2>
          <p className="lp-lead">
            The interesting part is not that an LLM drafts a reply. It is everything around it that keeps a wrong reply
            from reaching a customer.
          </p>
          <div className="bento">
            <article className="wide">
              <div className="metric-ico"><Calculator aria-hidden="true" /></div>
              <h3>Prices come from the rate card, never the model</h3>
              <p>
                <code>draft_quote</code> looks up every SKU and does the arithmetic in integer cents. An unknown SKU is
                rejected. There is no code path that accepts a unit price from the model.
              </p>
              <div className="bento-demo">
{'OFFICE-CLEAN  10,000 sqft × $0.12   '}<b>$1,200.00</b>{'\n'}
{'RESTROOM           4 × $65.00       '}<b>$260.00</b>{'\n'}
{'ANNUAL −8%   '}<span className="ok">−$116.80</span>{'   tax 8.25%  $110.81\n'}
{'GOLD-PLATED-MOP   '}<span className="no">rejected: unknown SKU</span>
              </div>
            </article>
            <article className="wide">
              <div className="metric-ico"><ShieldCheck aria-hidden="true" /></div>
              <h3>Nothing leaves without an operator</h3>
              <p>
                <code>crm_upsert</code> and <code>send_email</code> require a pending approval row before they can
                execute. The check lives in the tool executor, so no prompt can talk its way past it.
              </p>
              <div className="bento-demo">
{'classify        '}<span className="ok">ok</span>{'\n'}
{'draft_quote     '}<span className="ok">ok</span>{'\n'}
{'crm_upsert      '}<span className="hold">held · waiting for approval</span>{'\n'}
{'send_email      '}<span className="hold">held · waiting for approval</span>
              </div>
            </article>
            <article>
              <div className="metric-ico"><BookOpen aria-hidden="true" /></div>
              <h3>Grounded answers</h3>
              <p>Replies are assembled from knowledge-base passages and list their sources. If nothing matches, the desk says so instead of guessing.</p>
            </article>
            <article>
              <div className="metric-ico"><ShieldAlert aria-hidden="true" /></div>
              <h3>Injection stripped</h3>
              <p>Lines that read like instructions to the agent are removed before classification and flagged on the inquiry for the operator.</p>
            </article>
            <article>
              <div className="metric-ico"><PhoneCall aria-hidden="true" /></div>
              <h3>Voice and MCP</h3>
              <p>The same tools serve a Vapi sales line and a remote MCP server, with opt-in outbound mail, daily caps, and one-click unsubscribe.</p>
            </article>
            <article className="wide" style={{ gridColumn: '1 / -1' }}>
              <div className="metric-ico"><Layers aria-hidden="true" /></div>
              <h3>A fallback for every failure</h3>
              <p>
                If a model times out, rate-limits, or returns a malformed tool call, the run moves down the cascade. If
                every model is down, deterministic desk rules finish the job and the step is labelled as a fallback.
              </p>
              <div className="cascade" aria-label="Model fallback order">
                <span>Workers AI</span><ChevronRight aria-hidden="true" />
                <span>Groq</span><ChevronRight aria-hidden="true" />
                <span>Gemini</span><ChevronRight aria-hidden="true" />
                <span>Desk rules</span><ChevronRight aria-hidden="true" />
                <span>Human review</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-section tight" id="tested">
        <div className="lp-wrap">
          <span className="lp-eyebrow">Evidence</span>
          <h2 className="lp-h2">How it&apos;s tested</h2>
          <p className="lp-lead">
            GitHub Actions CI runs {CI_JOBS.length} jobs on every push and pull request: {CI_JOBS.join(', ')}.
          </p>
          <ul className="ci-jobs" aria-label="CI jobs">
            {CI_JOBS.map((job) => (
              <li key={job}><Check aria-hidden="true" />{job}</li>
            ))}
          </ul>
          <div className="test-grid">
            <article>
              <span className="kicker">Unit tests</span>
              <strong>{stats.unitFiles} files</strong>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                {stats.unitTests} unit tests across core, worker, and web (plus a separate OpenAPI contract suite).
              </p>
            </article>
            <article>
              <span className="kicker">Eval scenarios</span>
              <strong>{stats.evalScenarios}</strong>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Catalog-grounded agent scenarios in <code>evals/scenarios.ts</code>.
              </p>
            </article>
            <article>
              <span className="kicker">End-to-end</span>
              <strong>Playwright</strong>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Browser tests for inquiry → quote → approval → CRM paths.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-dark">
        <div className="lp-wrap">
          <div className="lp-final">
            <h2>See a quote go from inbox to approval.</h2>
            <p>Browse the seeded desk, or submit your own inquiry and watch the agent work through it step by step.</p>
            <div className="lp-cta">
              <Link className="btn primary lg" href="/login">
                Sign in to the desk
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link className="btn lg" href="/call">Call the sales line</Link>
            </div>
          </div>
          <footer className="lp-foot">
            <span>All companies, mail, and CRM records in this repo are fictional. MIT licensed.</span>
            <span><a href={REPO} target="_blank" rel="noreferrer">GitHub</a> · <Link href="/inquire">Public form</Link> · <Link href="/login">Desk</Link></span>
          </footer>
        </div>
      </section>
    </main>
  )
}
