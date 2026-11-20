export type RunIds = {
  inquiryId: string
  quoteId?: string | null
}

/** Ids on customer-facing tools come from the run, not from the model. */
export function bindDeskIds(tool: string, args: Record<string, unknown>, state: RunIds): Record<string, unknown> {
  const next = { ...args }
  if (tool === 'crm_upsert') {
    next.inquiryId = state.inquiryId
    next.quoteId = state.quoteId ?? null
  }
  if (tool === 'send_email') {
    next.quoteId = state.quoteId ?? null
  }
  return next
}
