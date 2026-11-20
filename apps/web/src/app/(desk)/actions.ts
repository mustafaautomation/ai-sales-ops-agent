'use server'

import { redirect } from 'next/navigation'
import { decideDesk, rerunDesk, saveDeskSettings, syncDesk } from '../../lib/ops'

export async function syncNow() {
  await syncDesk()
  redirect('/inbox')
}

export async function rerun(formData: FormData) {
  const inquiryId = String(formData.get('inquiryId') || '')
  const result = await rerunDesk(inquiryId)
  redirect(`/runs/${result.runId}`)
}

export async function saveSettings(formData: FormData) {
  const tax = Number(formData.get('tax_bps'))
  const days = Number(formData.get('quote_valid_days'))
  try {
    await saveDeskSettings(tax, days)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save settings.'
    redirect(`/settings?error=${encodeURIComponent(message)}`)
  }
  redirect('/settings?notice=saved')
}

export async function clearSuppression(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  if (!email) redirect('/settings')
  if (process.env.WORKER_URL) {
    await fetch(`${process.env.WORKER_URL}/api/suppressions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email }),
    })
  } else {
    const { deskDb } = await import('../../lib/desk')
    const db = deskDb().$client
    const at = Date.now()
    db.prepare(`UPDATE suppressions SET cleared_at = ? WHERE kind = 'email' AND value = ? AND cleared_at IS NULL`).run(at, email)
    db.prepare(`UPDATE inquiries SET suppressed_at = NULL, updated_at = ? WHERE lower(from_email) = ?`).run(at, email)
    db.prepare(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, 'operator', 'contact.unsuppressed', 'suppression', ?, ?)`,
    ).run(`aud_${crypto.randomUUID()}`, at, email, JSON.stringify({ email }))
  }
  redirect('/settings?notice=saved')
}

export async function decide(formData: FormData) {
  const id = String(formData.get('id') || '')
  const decision = formData.get('decision') === 'rejected' ? 'rejected' : 'approved'
  try {
    // Payload may contain a masked unsubscribe token; the worker/core reattaches a real link on send.
    const finalJson = String(formData.get('finalJson') || '')
    const result = await decideDesk({ id, decision, finalJson })
    redirect(`/runs/${result.runId}?notice=${decision}`)
  } catch (error) {
    const digest = typeof error === 'object' && error && 'digest' in error ? String((error as { digest: unknown }).digest) : ''
    if (digest.startsWith('NEXT_REDIRECT')) throw error
    const message = error instanceof Error ? error.message : 'Could not apply that decision.'
    redirect(`/approvals/${id}?error=${encodeURIComponent(message)}`)
  }
}
