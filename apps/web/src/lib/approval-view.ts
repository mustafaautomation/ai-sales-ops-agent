import { toolLabel } from '@meridian/core/labels'
import { maskPayloadSecrets } from '@meridian/core/mask'
import { pretty } from './format'

const SHEET_KEYS = [
  'lines',
  'subtotalCents',
  'discountCents',
  'taxCents',
  'totalCents',
  'taxBps',
  'discountCode',
  'validUntil',
  'billingPeriod',
] as const

/** Keep quote sheet fields from proposed when final was stripped by an older schema. */
function mergeDisplay(proposed: string, final: string | null): string {
  if (!final) return proposed
  try {
    const proposedData = JSON.parse(proposed) as Record<string, unknown>
    const finalData = JSON.parse(final) as Record<string, unknown>
    const merged = { ...finalData }
    for (const key of SHEET_KEYS) {
      if (merged[key] == null && proposedData[key] != null) merged[key] = proposedData[key]
    }
    if ((!Array.isArray(merged.lines) || merged.lines.length === 0) && Array.isArray(proposedData.lines)) {
      merged.lines = proposedData.lines
    }
    return JSON.stringify(merged)
  } catch {
    return final
  }
}

/** Server-side props for the approval page — never includes a raw unsubscribe token. */
export function approvalPagePayload(proposedJson: string, finalJson?: string | null) {
  const proposed = maskPayloadSecrets(proposedJson)
  const final = finalJson ? maskPayloadSecrets(finalJson) : null
  const display = mergeDisplay(proposed, final)
  return {
    proposed,
    display,
    proposedPretty: pretty(proposed),
    displayPretty: pretty(display),
  }
}

/** Serialize page props the way RSC would embed them, for leak tests. */
export function serializeApprovalProps(input: {
  id: string
  toolName: string
  status: string
  proposedJson: string
  finalJson?: string | null
  note?: string | null
}): string {
  const payload = approvalPagePayload(input.proposedJson, input.finalJson)
  return JSON.stringify({
    id: input.id,
    toolName: input.toolName,
    status: input.status,
    note: input.note ?? null,
    proposed: payload.proposed,
    display: payload.display,
    proposedPretty: payload.proposedPretty,
    displayPretty: payload.displayPretty,
  })
}

/** Queue label for an approval. Only a send that carries a quote is called a quote email. */
export function approvalTitle(toolName: string, proposedJson?: string | null): string {
  if (toolName !== 'send_email') return toolLabel(toolName)
  try {
    const payload = JSON.parse(proposedJson || '{}') as { purpose?: string; quoteId?: string | null }
    return payload.purpose === 'quote' || Boolean(payload.quoteId) ? 'Send quote email' : 'Send reply email'
  } catch {
    return toolLabel(toolName)
  }
}
