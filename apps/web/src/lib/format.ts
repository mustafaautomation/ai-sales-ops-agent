import { toolLabel } from '@meridian/core/labels'

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

/** Format a duration. Returns null for under 1ms so the UI can hide the chip. */
export function span(ms: number): string | null {
  const safe = Math.max(0, ms)
  if (safe < 1) return null
  if (safe < 1000) return `${Math.round(safe)} ms`
  if (safe < 10_000) return `${(safe / 1000).toFixed(1)} s`
  if (safe < 60_000) return `${Math.round(safe / 1000)} s`
  const minutes = Math.floor(safe / 60_000)
  const seconds = Math.round((safe % 60_000) / 1000)
  return seconds > 0 ? `${minutes} m ${seconds} s` : `${minutes} m`
}

/** Wall-clock agent time: first step start → last step end. Kept browser-safe (no @meridian/core). */
export function runDurationMs(steps: { startedAt?: number | null; finishedAt?: number | null }[]): number {
  let minStart: number | null = null
  let maxEnd: number | null = null
  for (const step of steps) {
    if (typeof step.startedAt === 'number') {
      minStart = minStart == null ? step.startedAt : Math.min(minStart, step.startedAt)
    }
    if (typeof step.finishedAt === 'number') {
      maxEnd = maxEnd == null ? step.finishedAt : Math.max(maxEnd, step.finishedAt)
    }
  }
  if (minStart == null || maxEnd == null || maxEnd < minStart) return 0
  return maxEnd - minStart
}

/** Runs list Duration cell: formatted wall-clock span, or an em dash. */
export function formatRunDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 1) return '—'
  return span(ms) ?? '—'
}

/** The step's own runtime, plus a separate approval wait. Never the gap until the next step. */
export function stepTiming(step: { startedAt?: number | null; finishedAt?: number | null; approvalDecidedAt?: number | null }): { own: string | null; wait: string | null } {
  const ownMs = step.startedAt != null && step.finishedAt != null && step.finishedAt >= step.startedAt ? step.finishedAt - step.startedAt : null
  const own = ownMs == null ? null : span(ownMs)
  const waitMs = step.approvalDecidedAt != null && step.finishedAt != null && step.approvalDecidedAt > step.finishedAt + 1000
    ? step.approvalDecidedAt - step.finishedAt
    : null
  const wait = waitMs == null ? null : span(waitMs)
  return { own, wait }
}

const DESK_TZ = process.env.CALL_WINDOW_TZ || 'Asia/Kuala_Lumpur'

export function when(ms: number, timeZone = DESK_TZ): string {
  const label = timeZone === 'UTC' ? 'UTC' : timeZone === 'Asia/Kuala_Lumpur' ? 'MYT' : timeZone
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms)) + ` ${label}`
  )
}

/** Outbox and call times use the desk call window timezone. */
export function deskWhen(ms: number): string {
  return when(ms)
}

export function sentenceCase(value: string): string {
  const words = value.replaceAll('_', ' ').replaceAll('.', ' ').trim()
  if (!words) return value
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

const INTENT_LABELS: Record<string, string> = {
  quote: 'Quote request',
  product_question: 'Product question',
  support: 'Support request',
  spam: 'Spam',
  out_of_scope: 'Out of scope',
  new: 'New',
  processing: 'Processing',
  awaiting_approval: 'Awaiting approval',
  resolved: 'Resolved',
  archived: 'Archived',
  archived_spam: 'Archived spam',
  pending: 'Pending',
  executed: 'Executed',
  rejected: 'Rejected',
  completed: 'Completed',
  failed: 'Failed',
  running: 'Running',
  draft: 'Draft',
  sent: 'Sent',
  pending_send: 'Pending send',
  proposal: 'Proposal',
  lead: 'Lead',
  qualified: 'Qualified',
  won: 'Won',
  lost: 'Lost',
  ok: 'Ok',
  void: 'Void',
}

export function statusLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return INTENT_LABELS[value] ?? sentenceCase(value)
}

export function humanizeAction(action: string): string {
  const known: Record<string, string> = {
    'optin.sent': 'Opt-in sent',
    'email.verified': 'Email verified',
    'contact.suppressed': 'Contact suppressed',
    'contact.unsuppressed': 'Contact unsuppressed',
    'approval.requested': 'Approval requested',
    'approval.approved': 'Approval approved',
    'approval.rejected': 'Approval rejected',
    'approval.edited': 'Approval edited',
    'inquiry.classified': 'Inquiry classified',
    'inquiry.archived_spam': 'Inquiry archived as spam',
    'call.requested': 'Call requested',
    'call.started': 'Call started',
    'call.ended': 'Call ended',
    'tool.completed': 'Tool completed',
    'run.completed': 'Run completed',
    'run.failed': 'Run failed',
  }
  if (known[action]) return known[action]
  return sentenceCase(action)
}

function detailObject(detail: string | null | undefined): Record<string, unknown> {
  if (!detail) return {}
  try {
    const parsed = JSON.parse(detail) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** One human sentence for an audit row. */
export function auditEventLabel(row: {
  action: string
  entityType?: string | null
  entityId?: string | null
  detail?: string | null
}): string {
  const detail = detailObject(row.detail)
  const tool = typeof detail.tool === 'string' ? detail.tool : typeof detail.toolName === 'string' ? detail.toolName : null
  const quoteNumber = typeof detail.quoteNumber === 'string'
    ? detail.quoteNumber
    : typeof detail.number === 'string'
      ? detail.number
      : null
  const email = typeof detail.to === 'string'
    ? detail.to
    : typeof detail.email === 'string'
      ? detail.email
      : typeof detail.maskedEmail === 'string'
        ? detail.maskedEmail
        : null

  if (row.action === 'approval.approved') {
    if (tool === 'send_email' || detail.purpose === 'quote') {
      return quoteNumber ? `Quote email approved for ${quoteNumber}` : 'Quote email approved'
    }
    if (tool === 'crm_upsert') return quoteNumber ? `CRM update approved for ${quoteNumber}` : 'CRM update approved'
    if (tool) return `${toolLabel(tool)} approved`
    return 'Approval approved'
  }
  if (row.action === 'approval.rejected') {
    return tool ? `${toolLabel(tool)} rejected` : 'Approval rejected'
  }
  if (row.action === 'approval.requested') {
    return tool ? `${toolLabel(tool)} requested` : 'Approval requested'
  }
  if (row.action === 'tool.completed') {
    if (tool === 'crm_upsert') return 'CRM record updated'
    if (tool === 'send_email') return quoteNumber ? `Quote email sent for ${quoteNumber}` : 'Email sent'
    if (tool) return `${toolLabel(tool)} completed`
    return 'Tool completed'
  }
  if (row.action === 'optin.sent') {
    return email ? `Opt-in email sent to ${email}` : 'Opt-in email sent'
  }
  if (row.action === 'contact.suppressed') {
    return email ? `Contact suppressed (${email})` : 'Contact suppressed'
  }
  if (row.action === 'inquiry.classified') {
    const intent = typeof detail.intent === 'string' ? statusLabel(detail.intent) : null
    return intent ? `Inquiry classified as ${intent.toLowerCase()}` : 'Inquiry classified'
  }
  return humanizeAction(row.action)
}

/** Null-safe step result reader. JSON "null" and missing values become {}. */
export function readStepResult(raw: string | null | undefined): {
  fallback?: boolean
  attempts?: { model: string; outcome: string; reason: string; detail?: string }[]
} {
  if (!raw || raw === 'null') return {}
  try {
    const parsed = JSON.parse(raw) as { fallback?: boolean; attempts?: { model: string; outcome: string; reason: string; detail?: string }[] } | null
    return parsed ?? {}
  } catch {
    return {}
  }
}

export function pretty(value: string | null): string {
  if (!value) return ''
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

/** Plain call transcript text: unwrap JSON quotes and turn literal \\n into real newlines. */
export function cleanTranscript(value: string | null | undefined): string {
  if (!value) return ''
  let text = value
  const trimmed = text.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || trimmed.includes('\\n')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (typeof parsed === 'string') text = parsed
    } catch {
      text = trimmed.replace(/^"|"$/g, '')
    }
  }
  return text.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim()
}

export function providerDisplayName(raw: string | null | undefined): string {
  const value = String(raw || 'mock')
  if (/^mock$/i.test(value) || /^fixture$/i.test(value)) return 'Scripted demo model'
  if (/workers-ai/i.test(value)) return 'Workers AI'
  if (/gemini/i.test(value)) return 'Gemini'
  if (/groq/i.test(value)) return 'Groq'
  if (/sandbox/i.test(value)) return 'Sandbox'
  return value
}

/** Two-letter initials for an avatar. */
export function initials(name: string | null | undefined): string {
  const parts = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
}

/** Stable avatar tone class for a name, so the same sender keeps one colour. */
export function avatarTone(name: string | null | undefined): string {
  let hash = 0
  for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return ['', 'h1', 'h2', 'h3', 'h4', 'h5'][hash % 6]
}

/** "3 min ago" style label for recent events, falling back to the desk timestamp. */
export function ago(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d ago`
  return when(ms)
}
