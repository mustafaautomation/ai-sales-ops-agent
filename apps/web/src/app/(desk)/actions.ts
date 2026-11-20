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

export async function decide(formData: FormData) {
  const id = String(formData.get('id') || '')
  const decision = formData.get('decision') === 'rejected' ? 'rejected' : 'approved'
  try {
    const result = await decideDesk({ id, decision, finalJson: String(formData.get('finalJson') || '') })
    redirect(`/runs/${result.runId}?notice=${decision}`)
  } catch (error) {
    const digest = typeof error === 'object' && error && 'digest' in error ? String((error as { digest: unknown }).digest) : ''
    if (digest.startsWith('NEXT_REDIRECT')) throw error
    const message = error instanceof Error ? error.message : 'Could not apply that decision.'
    redirect(`/approvals/${id}?error=${encodeURIComponent(message)}`)
  }
}
