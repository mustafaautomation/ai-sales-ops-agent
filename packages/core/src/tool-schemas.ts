import { z } from 'zod'

export const TOOL_NAMES = ['search_kb', 'get_price_list', 'crm_lookup', 'draft_quote', 'crm_upsert', 'send_email'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export const TOOL_DEFS = [
  {
    name: 'search_kb',
    requiresApproval: false,
    sideEffect: 'Reads the knowledge base',
    description: 'Search Meridian notes and return excerpts with citations.',
  },
  {
    name: 'get_price_list',
    requiresApproval: false,
    sideEffect: 'Reads the rate card',
    description: 'Return the published rate card. This is the only source of prices.',
  },
  {
    name: 'crm_lookup',
    requiresApproval: false,
    sideEffect: 'Reads CRM records',
    description: 'Look up companies, contacts, and deals. Does not write.',
  },
  {
    name: 'draft_quote',
    requiresApproval: false,
    sideEffect: 'Writes an internal quote draft',
    description: 'Build a quote from catalog SKUs. The tool computes totals. It does not send anything.',
  },
  {
    name: 'crm_upsert',
    requiresApproval: true,
    sideEffect: 'Writes a company, contact, and deal to the CRM',
    description: 'Create or update the CRM deal for this inquiry. Requires operator approval before it runs.',
  },
  {
    name: 'send_email',
    requiresApproval: true,
    sideEffect: 'Sends an email',
    description: 'Send a customer email. Requires operator approval before it runs. Refuses a recipient that is not the inquiry sender unless the operator edited the approval.',
  },
] as const

export function toolRequiresApproval(name: string): boolean {
  const tool = TOOL_DEFS.find((item) => item.name === name)
  if (!tool) return true
  return tool.requiresApproval
}

export const toolSchemas = {
  search_kb: z.object({
    query: z.string().min(2).max(500),
    limit: z.number().int().min(1).max(8).optional(),
  }),
  get_price_list: z.object({
    category: z.string().max(80).optional(),
  }),
  crm_lookup: z.object({
    query: z.string().min(1).max(200),
  }),
  draft_quote: z.object({
    companyName: z.string().min(1).max(120),
    contactName: z.string().min(1).max(120),
    contactEmail: z.string().email(),
    lines: z.array(z.object({ sku: z.string().min(1), qty: z.number().int().positive().max(1_000_000) })).min(1).max(12),
    discountCode: z.enum(['ANNUAL', 'NONPROFIT', 'MULTISITE']).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }),
  crm_upsert: z.object({
    companyName: z.string().min(1).max(120),
    contactName: z.string().min(1).max(120),
    contactEmail: z.string().email(),
    dealTitle: z.string().min(1).max(160),
    stage: z.enum(['lead', 'qualified', 'proposal', 'won', 'lost']),
    amountCents: z.number().int().nonnegative(),
    quoteId: z.string().nullable().optional(),
    quoteNumber: z.string().nullable().optional(),
    inquiryId: z.string().nullable().optional(),
  }),
  send_email: z.object({
    to: z.string().email(),
    subject: z.string().min(1).max(180),
    body: z.string().min(1).max(20_000),
    purpose: z.enum(['answer', 'refusal', 'support', 'quote', 'clarify']),
    quoteId: z.string().nullable().optional(),
  }),
} as const

export const WORKERS_AI_TOOLS = TOOL_DEFS.map((tool) => {
  const schema = toolSchemas[tool.name]
  const json = zodToLoose(schema)
  return {
    name: tool.name,
    description: tool.description,
    parameters: json,
  }
})

function zodToLoose(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = schema as unknown as { _def?: { shape?: () => Record<string, z.ZodTypeAny> } }
  const shape = raw._def?.shape?.() ?? {}
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = { type: zodKind(value) }
    if (!value.isOptional()) required.push(key)
  }
  return { type: 'object', properties, required }
}

function zodKind(schema: z.ZodTypeAny): string {
  const typeName = (schema._def as { typeName?: string }).typeName ?? ''
  if (typeName.includes('Number')) return 'number'
  if (typeName.includes('Array')) return 'array'
  if (typeName.includes('Boolean')) return 'boolean'
  if (typeName.includes('Object')) return 'object'
  return 'string'
}
