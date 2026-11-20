import { MCP_TOOLS } from '@meridian/core'
import { Notice } from '../../../components/ui'
import { clearSuppression, saveSettings } from '../actions'
import { demoEnabled } from '../../../lib/desk'
import { sourceIntegrations, sourceSettings, workerConfigured } from '../../../lib/source'

export const metadata = { title: 'Settings' }

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const query = await searchParams
  const settings = await sourceSettings()
  const integrations = await sourceIntegrations()
  const mcpUrl = process.env.WORKER_URL ? `${process.env.WORKER_URL.replace(/\/$/, '')}/mcp` : 'Set WORKER_URL'
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
          <input id="tax_bps" name="tax_bps" type="number" min={0} max={3000} defaultValue={settings.taxBps} />
        </div>
        <div className="field">
          <label htmlFor="quote_valid_days">Quote validity, days</label>
          <input id="quote_valid_days" name="quote_valid_days" type="number" min={1} max={90} defaultValue={settings.quoteValidDays} />
        </div>
        <button className="btn primary" type="submit">Save</button>
      </form>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Runtime</h2>
        <p>Console provider: <strong>{process.env.LLM_PROVIDER || 'mock'}</strong></p>
        <p>Model: <strong>{workerConfigured() ? 'workers-ai on the worker' : process.env.LLM_MODEL || '(provider default)'}</strong></p>
        <p>Demo sign-in: <strong>{demoEnabled() ? 'shown' : 'hidden'}</strong></p>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Integrations</h2>
        <p>Gemini fallback: <strong>{integrations.geminiConfigured ? 'configured' : 'not configured'}</strong>
          {integrations.geminiConfigured ? <> · <span className="mono">{integrations.geminiModel}</span></> : null}
        </p>
        <p className="muted">Order: Workers AI gpt-oss-120b, Workers AI Llama 3.3, then Gemini when Workers AI hits the daily limit, 5xx, or a timeout.</p>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Outbound</h2>
        <p>Resend key present: <strong>{integrations.resendKeyPresent ? 'yes' : 'no'}</strong>.</p>
        <p>From: <span className="mono">{integrations.emailFrom}</span></p>
        <p>Real sending: <strong>{integrations.emailEnabled ? 'on' : 'off'}</strong>. Phone calls: <strong>{integrations.callsEnabled ? 'on' : 'off'}</strong>. Mode if phone is on: <strong>{integrations.callMode}</strong>. Number configured: <strong>{integrations.outboundNumberConfigured ? 'yes' : 'no'}</strong>.</p>
        <p className="muted">Caps today: {integrations.caps.emailsPerAddress} emails per address, {integrations.caps.emailsGlobal} emails, {integrations.caps.callsPerNumber} call per number, {integrations.caps.callsGlobal} calls.</p>
        <h2>Suppressed addresses</h2>
        {(integrations.suppressions ?? []).length === 0 ? <p className="muted">None.</p> : null}
        {(integrations.suppressions ?? []).map((row) => (
          <form key={`${row.kind}-${row.value}`} action={clearSuppression} className="list-link">
            <span>{row.kind} · {row.value}</span>
            <input type="hidden" name="email" value={row.value} />
            <button className="btn small" type="submit">Clear</button>
          </form>
        ))}
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Connect via MCP</h2>
        <p className="lede">The remote server is the Worker at <span className="mono">/mcp</span>. The bearer token is the <span className="mono">MCP_BEARER_TOKEN</span> secret. It is not shown here.</p>
        <pre className="json">{`{
  "mcpServers": {
    "meridian": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer $MCP_BEARER_TOKEN" }
    }
  }
}`}</pre>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Tools</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tool</th><th>What it does</th><th>Side</th></tr></thead>
            <tbody>
              {MCP_TOOLS.map((tool) => (
                <tr key={tool.name}>
                  <td className="mono">{tool.name}</td>
                  <td>{tool.description}</td>
                  <td>{tool.name === 'decide_approval' || tool.name === 'request_callback' || tool.name === 'suppress_contact' ? 'Writes' : 'Reads'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
