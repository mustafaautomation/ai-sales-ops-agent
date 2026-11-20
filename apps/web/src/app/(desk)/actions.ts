'use server'

import { decideApproval, GuardrailError, runInquiry, setSetting, syncInbox } from '@meridian/core'
import { redirect } from 'next/navigation'
import { ensureBoot } from '../../lib/boot'
import { deskDb, deskPorts } from '../../lib/desk'

export async function syncNow() {
  await ensureBoot()
  await syncInbox(deskDb(), deskPorts())
  redirect('/inbox')
}

export async function rerun(formData: FormData) {
  await ensureBoot()
  const inquiryId = String(formData.get('inquiryId') || '')
  const snapshot = await runInquiry(deskDb(), deskPorts(), inquiryId)
  redirect(`/runs/${snapshot.run.id}`)
}

export async function saveSettings(formData: FormData) {
  await ensureBoot()
  const tax = Number(formData.get('tax_bps'))
  const days = Number(formData.get('quote_valid_days'))
  if (!Number.isInteger(tax) || tax < 0 || tax > 3000) redirect('/settings?error=Tax+basis+points+must+be+0+to+3000')
  if (!Number.isInteger(days) || days < 1 || days > 90) redirect('/settings?error=Validity+must+be+1+to+90+days')
  const db = deskDb()
  setSetting(db, 'tax_bps', String(tax))
  setSetting(db, 'quote_valid_days', String(days))
  redirect('/settings?notice=saved')
}

export async function decide(formData: FormData) {
  await ensureBoot()
  const id = String(formData.get('id') || '')
  const decision = formData.get('decision') === 'rejected' ? 'rejected' : 'approved'
  try {
    const snapshot = await decideApproval(deskDb(), deskPorts(), {
      approvalId: id,
      decision,
      finalJson: String(formData.get('finalJson') || ''),
      actor: 'operator',
    })
    redirect(`/runs/${snapshot.run.id}?notice=${decision}`)
  } catch (error) {
    const digest = typeof error === 'object' && error && 'digest' in error ? String((error as { digest: unknown }).digest) : ''
    if (digest.startsWith('NEXT_REDIRECT')) throw error
    const message = error instanceof GuardrailError ? error.message : error instanceof Error ? error.message : 'Could not apply that decision.'
    redirect(`/approvals/${id}?error=${encodeURIComponent(message)}`)
  }
}
