import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { prepareDatabase, searchChunks, loadChunks, listApprovals, executeTool, httpPorts, listDeals, listCompanies, redactValue } from '@meridian/core'

const db = prepareDatabase()

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

const server = new McpServer({ name: 'meridian-desk', version: '1.0.0' })

server.tool(
  'list_pending_approvals',
  'List operator approvals that have not been decided. Payloads are redacted; the desk keeps the full text.',
  {},
  async () => {
    const pending = listApprovals(db)
      .filter((approval) => approval.status === 'pending')
      .map((approval) => ({
        id: approval.id,
        runId: approval.runId,
        tool: approval.toolName,
        createdAt: approval.createdAt,
        proposed: redactValue(JSON.parse(approval.proposedJson)),
      }))
    return text({ pending })
  },
)

server.tool(
  'search_kb',
  'Search Meridian Facilities notes. Read-only. Results include citation slugs.',
  { query: z.string().min(2).max(500), limit: z.number().int().min(1).max(8).optional() },
  async ({ query, limit }) => {
    const hits = searchChunks(loadChunks(db), query, limit ?? 4).map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      heading: hit.heading,
      excerpt: hit.content.slice(0, 700),
      score: hit.score,
    }))
    return text({ hits })
  },
)

server.tool(
  'draft_quote',
  'Create an internal quote draft from catalog SKUs. Totals are computed in code. This does not email anyone and does not write the CRM.',
  {
    companyName: z.string().min(1).max(120),
    contactName: z.string().min(1).max(120),
    contactEmail: z.string().email(),
    lines: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })).min(1).max(12),
    discountCode: z.enum(['ANNUAL', 'NONPROFIT', 'MULTISITE']).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  },
  async (args) => {
    const quote = await executeTool({
      db,
      ports: httpPorts({
        emailBaseUrl: process.env.EMAIL_API_URL || 'http://127.0.0.1:4001',
        crmBaseUrl: process.env.CRM_API_URL || 'http://127.0.0.1:4002',
      }),
      name: 'draft_quote',
      raw: args,
      inquiry: null,
      runId: null,
    })
    return text(quote)
  },
)

server.tool(
  'crm_lookup',
  'Read companies and deals. Tries the CRM API, then the local mirror. Does not write.',
  { query: z.string().min(1).max(200) },
  async ({ query }) => {
    const ports = httpPorts({
      emailBaseUrl: process.env.EMAIL_API_URL || 'http://127.0.0.1:4001',
      crmBaseUrl: process.env.CRM_API_URL || 'http://127.0.0.1:4002',
      attempts: 2,
      timeoutMs: 1500,
    })
    try {
      const records = await ports.crm.lookup(query)
      return text({ source: 'crm-api', records })
    } catch (error) {
      const needle = query.toLowerCase()
      const deals = listDeals(db).filter((deal) => `${deal.title} ${deal.stage}`.toLowerCase().includes(needle))
      const companies = listCompanies(db).filter((company) => company.name.toLowerCase().includes(needle))
      return text({
        source: 'local-mirror',
        warning: error instanceof Error ? error.message : 'CRM API unavailable',
        companies,
        deals,
      })
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
