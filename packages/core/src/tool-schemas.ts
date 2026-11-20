import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

export const TOOL_NAMES = ['search_kb', 'get_price_list', 'crm_lookup', 'draft_quote', 'crm_upsert', 'send_email', 'request_callback'] as const
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
    description: 'Build a quote from catalog SKUs. Each line uses sku and qty (integer). The tool computes totals. It does not send anything.',
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
    description:
      'Send a customer email. Requires operator approval. For purpose=quote: do not write prices or the full body. Pass opening (short, no money), answers (one per non-quote customer question: question, answer, sourceIds from search_kb slugs, status answered|will_confirm), and optional closing. The desk assembles the quote block, sign-off, and sources. Never invent fees or insurance. For other purposes, pass body as the email text.',
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
    // Groq strict schemas send null for optional fields; accept null on the first try.
    category: z.string().max(80).nullable().optional(),
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
  send_email: z
    .object({
      to: z.string().email(),
      subject: z.string().min(1).max(180),
      body: z.string().max(20_000).optional().default(''),
      purpose: z.enum(['answer', 'refusal', 'support', 'quote', 'clarify', 'follow_up']),
      quoteId: z.string().nullable().optional(),
      opening: z.string().max(500).optional(),
      answers: z
        .array(
          z.object({
            question: z.string().min(1).max(300),
            answer: z.string().max(1000).optional().default(''),
            sourceIds: z.array(z.string().max(80)).max(8).optional().default([]),
            status: z.enum(['answered', 'will_confirm']),
          }),
        )
        .max(12)
        .optional(),
      closing: z.string().max(500).nullable().optional(),
      // Quote sheet fields for the approval UI (assembled by the desk, not the model).
      lines: z
        .array(
          z.object({
            sku: z.string().optional(),
            description: z.string().optional(),
            qty: z.number().optional(),
            unit: z.string().optional(),
            unitPriceCents: z.number().optional(),
            lineTotalCents: z.number().optional(),
          }),
        )
        .max(20)
        .optional(),
      subtotalCents: z.number().optional(),
      discountCents: z.number().optional(),
      taxCents: z.number().optional(),
      totalCents: z.number().optional(),
      taxBps: z.number().optional(),
      discountCode: z.string().nullable().optional(),
      validUntil: z.string().optional(),
      billingPeriod: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.purpose === 'quote') return
      if (!data.body || data.body.trim().length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'body is required', path: ['body'] })
      }
    }),
  request_callback: z.object({
    inquiryId: z.string().min(1),
    phone: z.string().min(8).max(20),
    companyName: z.string().max(160).nullable().optional(),
    subject: z.string().max(180).nullable().optional(),
  }),
} as const

export function jsonSchemaFor(schema: z.ZodTypeAny, target: 'jsonSchema7' | 'openApi3' = 'jsonSchema7'): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target, $refStrategy: 'none' }) as Record<string, unknown>
  delete json.$schema
  return json
}

export const WORKERS_AI_TOOLS = TOOL_DEFS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: jsonSchemaFor(toolSchemas[tool.name]),
}))

export const MCP_TOOLS = [
  { name: 'list_inbox', description: 'List recent inquiries.' },
  { name: 'get_inquiry', description: 'Read one inquiry by id.' },
  { name: 'search_kb', description: 'Search the knowledge base. Read-only.' },
  { name: 'draft_quote', description: 'Estimate a quote from the rate card. Does not send it.' },
  { name: 'list_pending_approvals', description: 'List approvals waiting on an operator.' },
  { name: 'get_lead', description: 'Read a company and its deals by name.' },
  { name: 'search_crm', description: 'Search companies and deals. Read-only.' },
  { name: 'list_calls', description: 'List stored sales-line calls.' },
  { name: 'decide_approval', description: 'Approve or reject a pending approval.' },
  { name: 'request_callback', description: 'Queue an AI callback. It waits for approval.' },
  { name: 'list_outbound', description: 'List recent outbound emails and callbacks.' },
  { name: 'suppress_contact', description: 'Stop email and calls for an address.' },
] as const

type ZodDef = {
  typeName?: string
  innerType?: z.ZodTypeAny
  schema?: z.ZodTypeAny
  type?: z.ZodTypeAny
  shape?: () => Record<string, z.ZodTypeAny>
}

function zodDef(schema: z.ZodTypeAny): ZodDef {
  return (schema as unknown as { _def: ZodDef })._def
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  const typeName = zodDef(schema).typeName
  if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
    return unwrap(zodDef(schema).innerType as z.ZodTypeAny)
  }
  if (typeName === 'ZodEffects') return unwrap(zodDef(schema).schema as z.ZodTypeAny)
  return schema
}

function coerceInteger(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) return value
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : value
}

function parseJsonContainer(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

export function coerceToolArgs(schema: z.ZodTypeAny, value: unknown): unknown {
  if (value == null) return value
  const decoded = parseJsonContainer(value)
  const inner = unwrap(schema)
  const typeName = zodDef(inner).typeName
  if (typeName === 'ZodNumber') return coerceInteger(decoded)
  if (typeName === 'ZodArray') {
    const list = parseJsonContainer(decoded)
    if (!Array.isArray(list)) return decoded
    const item = zodDef(inner).type as z.ZodTypeAny
    return list.map((entry) => coerceToolArgs(item, entry))
  }
  if (typeName === 'ZodObject' && typeof decoded === 'object' && !Array.isArray(decoded)) {
    const shape = zodDef(inner).shape?.() ?? {}
    const record = { ...(decoded as Record<string, unknown>) }
    if ('qty' in shape && (record.qty == null || record.qty === '') && record.quantity != null) record.qty = record.quantity
    for (const [key, child] of Object.entries(shape)) {
      if (key in record) record[key] = coerceToolArgs(child, record[key])
    }
    return record
  }
  return value
}

export function parseToolArgs(
  name: string,
  args: unknown,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!TOOL_NAMES.includes(name as ToolName)) return { ok: false, error: `Unknown tool ${name}.` }
  const schema = toolSchemas[name as ToolName]
  const decoded = typeof args === 'string' ? parseJsonContainer(args) : args
  const coerced = coerceToolArgs(schema, decoded && typeof decoded === 'object' ? decoded : {})
  const parsed = schema.safeParse(coerced)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`).join('; ') }
  }
  return { ok: true, data: parsed.data as Record<string, unknown> }
}
