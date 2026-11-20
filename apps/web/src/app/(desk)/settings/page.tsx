import { numberSetting, TOOL_DEFS } from '@meridian/core'
import { Notice } from '../../../components/ui'
import { saveSettings } from '../actions'
import { deskDb, demoEnabled } from '../../../lib/desk'

export const metadata = { title: 'Settings' }

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const query = await searchParams
  const db = deskDb()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">Tax and validity are read by the quote engine. The model provider is selected with an environment variable.</p>
        </div>
      </div>
      {query.notice ? <Notice>Saved.</Notice> : null}
      {query.error ? <Notice tone="warn">{query.error}</Notice> : null}
      <form action={saveSettings} className="card" style={{ maxWidth: 520 }}>
        <div className="field">
          <label htmlFor="tax_bps">Tax, basis points</label>
          <input id="tax_bps" name="tax_bps" type="number" min={0} max={3000} defaultValue={numberSetting(db, 'tax_bps', 825)} />
        </div>
        <div className="field">
          <label htmlFor="quote_valid_days">Quote validity, days</label>
          <input id="quote_valid_days" name="quote_valid_days" type="number" min={1} max={90} defaultValue={numberSetting(db, 'quote_valid_days', 14)} />
        </div>
        <button className="btn primary" type="submit">Save</button>
      </form>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Runtime</h2>
        <p>Provider: <strong>{process.env.LLM_PROVIDER || 'mock'}</strong></p>
        <p>Model: <strong>{process.env.LLM_MODEL || '(provider default)'}</strong></p>
        <p>Demo sign-in: <strong>{demoEnabled() ? 'shown' : 'hidden'}</strong></p>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Tools</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tool</th><th>Effect</th><th>Approval</th></tr></thead>
            <tbody>
              {TOOL_DEFS.map((tool) => (
                <tr key={tool.name}>
                  <td className="mono">{tool.name}</td>
                  <td>{tool.sideEffect}</td>
                  <td>{tool.requiresApproval ? 'Required' : 'Not required'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
