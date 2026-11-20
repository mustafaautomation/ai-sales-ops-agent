import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { CATALOG, findSku } from './catalog'
import type { DB } from './db'
import { GuardrailError } from './guardrails'
import { externalKey, id, slug } from './ids'
import { searchChunks } from './kb'
import { DESK_FROM, type Ports } from './ports'
import { addDaysUtc, computeQuote } from './quote'
import { crmCompanies, crmContacts, crmDeals, outboundMessages, quoteLines, quotes } from './schema'
import { getApproval, loadChunks, nextQuoteNumber, numberSetting, readIdempotent, writeIdempotent, now } from './store'

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

export type ToolGrant = {
  approvalId: string
  operatorOverride: boolean
  actor: string
}

type InquiryRef = { id: string; fromEmail: string } | null

function assertKnownTool(name: string): asserts name is ToolName {
  if (!TOOL_NAMES.includes(name as ToolName)) {
    throw new GuardrailError('unknown_tool', `Unknown tool ${name}.`)
  }
}

export async function executeTool(input: {
  db: DB
  ports: Ports
  name: string
  raw: unknown
  inquiry: InquiryRef
  runId: string | null
  grant?: ToolGrant
  now?: Date
}): Promise<unknown> {
  assertKnownTool(input.name)
  if (toolRequiresApproval(input.name)) {
    if (input.grant == null) {
      throw new GuardrailError('approval_required', `${input.name} cannot run without an approved operator decision.`)
    }
    const approval = getApproval(input.db, input.grant.approvalId)
    if (!approval || approval.toolName !== input.name || (approval.status !== 'pending' && approval.status !== 'executing')) {
      throw new GuardrailError('approval_required', `${input.name} requires a pending approval record. The prompt cannot grant this.`)
    }
  }
  const schema = toolSchemas[input.name]
  const args = schema.parse(input.raw) as z.infer<typeof schema>
  switch (input.name) {
    case 'search_kb':
      return searchKbTool(input.db, args as z.infer<typeof toolSchemas.search_kb>)
    case 'get_price_list':
      return priceTool(args as z.infer<typeof toolSchemas.get_price_list>)
    case 'crm_lookup':
      return { records: await input.ports.crm.lookup((args as z.infer<typeof toolSchemas.crm_lookup>).query) }
    case 'draft_quote':
      return draftQuoteTool(input.db, args as z.infer<typeof toolSchemas.draft_quote>, input.inquiry, input.runId, input.now ?? new Date())
    case 'crm_upsert':
      return upsertTool(input.db, input.ports, args as z.infer<typeof toolSchemas.crm_upsert>, input.grant!)
    case 'send_email':
      return sendTool(input.db, input.ports, args as z.infer<typeof toolSchemas.send_email>, input.inquiry, input.grant!)
    default:
      throw new GuardrailError('unknown_tool', `Unknown tool ${input.name}.`)
  }
}

function searchKbTool(db: DB, args: z.infer<typeof toolSchemas.search_kb>) {
  const chunks = searchChunks(loadChunks(db), args.query, args.limit ?? 4).map((chunk) => ({
    slug: chunk.slug,
    title: chunk.title,
    heading: chunk.heading,
    excerpt: chunk.content.slice(0, 700),
    score: chunk.score,
  }))
  return { query: args.query, chunks }
}

function priceTool(args: z.infer<typeof toolSchemas.get_price_list>) {
  const category = args.category?.trim().toLowerCase()
  const items = CATALOG.filter((item) => {
    if (!category) return true
    return `${item.sku} ${item.name} ${item.unit}`.toLowerCase().includes(category)
  }).map((item) => ({
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    detail: item.detail,
  }))
  return { currency: 'USD', items }
}

function draftQuoteTool(
  db: DB,
  args: z.infer<typeof toolSchemas.draft_quote>,
  inquiry: InquiryRef,
  runId: string | null,
  at: Date,
) {
  for (const line of args.lines) {
    if (!findSku(line.sku)) {
      throw new GuardrailError('unknown_sku', `Refusing unknown SKU ${line.sku}.`)
    }
  }
  const math = computeQuote({
    lines: args.lines,
    discountCode: args.discountCode ?? null,
    taxBps: numberSetting(db, 'tax_bps', 825),
  })
  const quoteId = id('quo')
  const number = nextQuoteNumber(db)
  const validUntil = addDaysUtc(at, numberSetting(db, 'quote_valid_days', 14))
  db.insert(quotes)
    .values({
      id: quoteId,
      number,
      inquiryId: inquiry?.id ?? null,
      runId,
      companyName: args.companyName,
      contactName: args.contactName,
      contactEmail: args.contactEmail,
      discountCode: math.discountCode,
      discountBps: math.discountBps,
      taxBps: math.taxBps,
      subtotalCents: math.subtotalCents,
      discountCents: math.discountCents,
      taxCents: math.taxCents,
      totalCents: math.totalCents,
      currency: math.currency,
      status: 'draft',
      validUntil,
      notes: args.notes ?? null,
      createdAt: now(),
    })
    .run()
  math.lines.forEach((line, position) => {
    db.insert(quoteLines)
      .values({
        id: id('qli'),
        quoteId,
        sku: line.sku,
        description: line.description,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        lineTotalCents: line.lineTotalCents,
        position,
      })
      .run()
  })
  return { quoteId, number, validUntil, ...math }
}

async function upsertTool(
  db: DB,
  ports: Ports,
  args: z.infer<typeof toolSchemas.crm_upsert>,
  grant: ToolGrant,
) {
  const key = `crm:${grant.approvalId}`
  const cached = readIdempotent<Record<string, unknown>>(db, key)
  if (cached) return cached
  const payload = {
    externalKey: externalKey(args.companyName, args.dealTitle),
    companyName: args.companyName,
    contactName: args.contactName,
    contactEmail: args.contactEmail,
    dealTitle: args.dealTitle,
    stage: args.stage,
    amountCents: args.amountCents,
    quoteNumber: args.quoteNumber ?? null,
  }
  const record = await ports.crm.upsert(payload, key)
  const at = now()
  const companyExternal = slug(args.companyName)
  let company = db.select().from(crmCompanies).where(eq(crmCompanies.externalId, companyExternal)).get()
  if (!company) {
    company = {
      id: id('co'),
      externalId: companyExternal,
      name: args.companyName,
      domain: args.contactEmail.split('@')[1] ?? null,
      createdAt: at,
      updatedAt: at,
    }
    db.insert(crmCompanies).values(company).run()
  } else {
    db.update(crmCompanies).set({ name: args.companyName, updatedAt: at }).where(eq(crmCompanies.id, company.id)).run()
  }
  const contact = db
    .select()
    .from(crmContacts)
    .where(eq(crmContacts.companyId, company.id))
    .all()
    .find((row) => row.email.toLowerCase() === args.contactEmail.toLowerCase())
  if (!contact) {
    db.insert(crmContacts)
      .values({
        id: id('ctc'),
        companyId: company.id,
        name: args.contactName,
        email: args.contactEmail,
        createdAt: at,
      })
      .run()
  }
  const dealKey = payload.externalKey
  const existingDeal = db.select().from(crmDeals).where(eq(crmDeals.externalId, dealKey)).get()
  if (!existingDeal) {
    db.insert(crmDeals)
      .values({
        id: id('deal'),
        companyId: company.id,
        externalId: dealKey,
        title: args.dealTitle,
        stage: args.stage,
        amountCents: args.amountCents,
        quoteId: args.quoteId ?? null,
        inquiryId: args.inquiryId ?? null,
        source: 'agent',
        createdAt: at,
        updatedAt: at,
      })
      .run()
  } else {
    db.update(crmDeals)
      .set({
        stage: args.stage,
        amountCents: args.amountCents,
        quoteId: args.quoteId ?? existingDeal.quoteId,
        updatedAt: at,
      })
      .where(eq(crmDeals.id, existingDeal.id))
      .run()
  }
  const result = { record, localCompanyId: company.id }
  writeIdempotent(db, key, 'crm_upsert', result)
  return result
}

async function sendTool(
  db: DB,
  ports: Ports,
  args: z.infer<typeof toolSchemas.send_email>,
  inquiry: InquiryRef,
  grant: ToolGrant,
) {
  if (!inquiry) throw new GuardrailError('missing_inquiry', 'Email cannot be sent without an inquiry.')
  if (!grant.operatorOverride && args.to.toLowerCase() !== inquiry.fromEmail.toLowerCase()) {
    throw new GuardrailError(
      'recipient_mismatch',
      'The recipient does not match the inquiry sender. Change it on the approval if you mean to override that.',
    )
  }
  const key = `email:${grant.approvalId}`
  const cached = readIdempotent<Record<string, unknown>>(db, key)
  if (cached) return cached
  const message = await ports.email.send({
    to: args.to,
    from: DESK_FROM,
    subject: args.subject,
    body: args.body,
    clientKey: key,
  })
  const at = now()
  db.insert(outboundMessages)
    .values({
      id: id('out'),
      approvalId: grant.approvalId,
      inquiryId: inquiry.id,
      quoteId: args.quoteId ?? null,
      toEmail: args.to,
      subject: args.subject,
      body: args.body,
      providerMessageId: message.id,
      status: 'sent',
      createdAt: at,
    })
    .run()
  if (args.quoteId) {
    db.update(quotes).set({ status: 'sent' }).where(eq(quotes.id, args.quoteId)).run()
  }
  const result = { messageId: message.id, to: args.to, purpose: args.purpose, quoteId: args.quoteId ?? null }
  writeIdempotent(db, key, 'send_email', result)
  return result
}
