/** Human labels for tools and billing — used by the desk UI and seed emails. */

export const TOOL_LABELS: Record<string, string> = {
  classify: 'Classify inquiry',
  recall_history: 'Recall earlier contact',
  search_kb: 'Search knowledge base',
  get_price_list: 'Read rate card',
  crm_lookup: 'Look up CRM',
  draft_quote: 'Draft quote',
  crm_upsert: 'Update CRM deal',
  send_email: 'Send quote email',
  request_callback: 'Request callback',
  human_review: 'Human review',
  desk_fallback: 'Rule-based fallback',
  list_inbox: 'List inbox',
  get_inquiry: 'Get inquiry',
  list_pending_approvals: 'List pending approvals',
  get_lead: 'Get lead',
  search_crm: 'Search CRM',
  list_calls: 'List calls',
  decide_approval: 'Decide approval',
  list_outbound: 'List outbound',
  suppress_contact: 'Suppress contact',
}

export function toolLabel(name: string | null | undefined): string {
  if (!name) return 'Step'
  return TOOL_LABELS[name] ?? name.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Billing period derived from rate-card units and discount codes. */
export function billingPeriodLabel(input: {
  discountCode?: string | null
  lines?: { sku?: string; unit?: string }[]
}): string {
  if (input.discountCode === 'ANNUAL') return 'Annual contract (per visit rates, billed annually)'
  const units = new Set(
    (input.lines ?? [])
      .map((line) => String(line.unit || '').toLowerCase())
      .filter(Boolean),
  )
  if (units.has('visit') || units.has('sqft') || units.has('restroom') || units.has('pane')) {
    return 'Per visit'
  }
  if (units.has('hour')) return 'Hourly'
  if (units.has('month')) return 'Monthly'
  return 'As quoted'
}
