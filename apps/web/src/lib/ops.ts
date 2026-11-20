import { decideApproval, GuardrailError, runInquiry, setSetting, syncInbox } from '@meridian/core'
import { ensureBoot } from './boot'
import { deskDb, deskPorts } from './desk'
import { workerConfigured, workerPost } from './source'

export async function syncDesk() {
  if (workerConfigured()) return workerPost<{ continued: number }>('/api/inbox/sync')
  await ensureBoot()
  const imported = await syncInbox(deskDb(), deskPorts())
  return { imported }
}

export async function rerunDesk(inquiryId: string) {
  if (workerConfigured()) return workerPost<{ runId: string }>(`/api/inquiries/${inquiryId}/rerun`)
  await ensureBoot()
  const snapshot = await runInquiry(deskDb(), deskPorts(), inquiryId)
  return { runId: snapshot.run.id }
}

export async function saveDeskSettings(tax: number, days: number) {
  if (!Number.isInteger(tax) || tax < 0 || tax > 3000) throw new Error('Tax basis points must be 0 to 3000')
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Validity must be 1 to 90 days')
  if (workerConfigured()) return workerPost('/api/settings', { taxBps: tax, quoteValidDays: days })
  await ensureBoot()
  const db = deskDb()
  setSetting(db, 'tax_bps', String(tax))
  setSetting(db, 'quote_valid_days', String(days))
  return { ok: true }
}

export async function decideDesk(input: { id: string; decision: 'approved' | 'rejected'; finalJson: string }) {
  if (workerConfigured()) {
    return workerPost<{ runId: string }>(`/api/approvals/${input.id}/decide`, { ...input, actor: 'operator' })
  }
  await ensureBoot()
  try {
    const snapshot = await decideApproval(deskDb(), deskPorts(), {
      approvalId: input.id,
      decision: input.decision,
      finalJson: input.finalJson,
      actor: 'operator',
    })
    return { runId: snapshot.run.id }
  } catch (error) {
    if (error instanceof GuardrailError) throw error
    throw error
  }
}
