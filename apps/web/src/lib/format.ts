export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export function span(ms: number): string {
  const safe = Math.max(0, Math.round(ms))
  if (safe < 1000) return `${safe}ms`
  if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`
  if (safe < 60_000) return `${Math.round(safe / 1000)}s`
  const minutes = Math.floor(safe / 60_000)
  const seconds = Math.round((safe % 60_000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

/** The step's own runtime, plus a separate approval wait. Never the gap until the next step. */
export function stepTiming(step: { startedAt?: number | null; finishedAt?: number | null; approvalDecidedAt?: number | null }): { own: string | null; wait: string | null } {
  const own = step.startedAt != null && step.finishedAt != null && step.finishedAt >= step.startedAt ? span(step.finishedAt - step.startedAt) : null
  const wait = step.approvalDecidedAt != null && step.finishedAt != null && step.approvalDecidedAt > step.finishedAt + 1000
    ? span(step.approvalDecidedAt - step.finishedAt)
    : null
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

export function humanizeAction(action: string): string {
  const known: Record<string, string> = {
    'optin.sent': 'Opt-in sent',
    'email.verified': 'Email verified',
    'contact.suppressed': 'Contact suppressed',
    'contact.unsuppressed': 'Contact unsuppressed',
    'approval.requested': 'Approval requested',
    'approval.approved': 'Approval approved',
    'approval.rejected': 'Approval rejected',
    'inquiry.classified': 'Inquiry classified',
    'call.requested': 'Call requested',
    'call.started': 'Call started',
    'call.ended': 'Call ended',
  }
  if (known[action]) return known[action]
  const words = action.replaceAll('.', ' ').replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
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
