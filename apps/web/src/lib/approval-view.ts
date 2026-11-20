import { maskPayloadSecrets } from '@meridian/core/mask'
import { pretty } from './format'

/** Server-side props for the approval page — never includes a raw unsubscribe token. */
export function approvalPagePayload(proposedJson: string, finalJson?: string | null) {
  const proposed = maskPayloadSecrets(proposedJson)
  const final = finalJson ? maskPayloadSecrets(finalJson) : null
  const display = final || proposed
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
