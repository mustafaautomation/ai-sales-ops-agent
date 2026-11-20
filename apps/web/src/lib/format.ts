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

export function when(ms: number): string {
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms)) + ' UTC'
  )
}

export function pretty(value: string | null): string {
  if (!value) return ''
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
