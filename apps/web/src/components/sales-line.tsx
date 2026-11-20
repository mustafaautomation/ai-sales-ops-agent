'use client'

import { useState } from 'react'

export function SalesLine() {
  const [message, setMessage] = useState('The line uses a short-lived token from the desk. Nothing is written to the CRM until an operator approves it.')
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    const response = await fetch('/api/voice/session', { method: 'POST' })
    const payload = (await response.json()) as { error?: string; token?: string; publicKey?: string; assistantId?: string }
    if (!response.ok) {
      setMessage(payload.error || 'The line is unavailable.')
      setBusy(false)
      return
    }
    if (!payload.assistantId || (!payload.token && !payload.publicKey)) {
      setMessage('The sales line is not configured on this desk yet. Set the Vapi assistant id and a public key or private key.')
      setBusy(false)
      return
    }
    const sdk = await import('@vapi-ai/web')
    const Vapi = sdk.default
    const client = new Vapi(payload.token || payload.publicKey || '')
    client.on('call-end', () => setMessage('Call ended. If you left contact details, they are waiting for an operator.'))
    await client.start(payload.assistantId)
    setMessage('Connected. Ask about services, the Cedarhaven area, or a ballpark price.')
    setBusy(false)
  }

  return (
    <div className="stack">
      <p>{message}</p>
      <button className="btn primary" type="button" onClick={() => void start()} disabled={busy}>
        {busy ? 'Connecting' : 'Call our sales line'}
      </button>
    </div>
  )
}
