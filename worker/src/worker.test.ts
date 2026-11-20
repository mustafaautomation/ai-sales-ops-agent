import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { D1Like } from './d1'
import { migrateD1 } from './d1'
import { createInquiry, stepInquiry } from './desk'
import { handleMcp, mcpTools } from './mcp'
import { authorizedVapi, handleVapiTool, recordCall } from './vapi'
import { takeDaily, takeWindow } from './limits'

function memoryD1(): D1Like {
  const db = new Database(':memory:')
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all<T>() {
              return { results: db.prepare(sql).all(...values) as T[] }
            },
            async first<T>() {
              return (db.prepare(sql).get(...values) as T) ?? null
            },
            async run() {
              const result = db.prepare(sql).run(...values)
              return { meta: { changes: result.changes } }
            },
          }
        },
      }
    },
    async exec(sql: string) {
      db.exec(sql)
    },
  }
}

const migrations = readdirSync('worker/migrations')
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ id: name.replace(/\.sql$/, ''), sql: readFileSync(`worker/migrations/${name}`, 'utf8') }))

async function ready() {
  const db = memoryD1()
  await migrateD1(db, migrations)
  return db
}

describe('D1 desk', () => {
  it('keeps an inquiry and a catalog quote after a fresh migration', async () => {
    const db = await ready()
    const inquiryId = await createInquiry(db, {
      source: 'web',
      fromName: 'Priya Shah',
      fromEmail: 'priya.shah@north-wharf.example',
      companyName: 'North Wharf Logistics',
      subject: 'Quote',
      body: 'Please quote nightly cleaning for 10,000 sqft and 4 restrooms. We want an annual contract.',
    })
    let status = 'running'
    for (let step = 0; step < 8 && status === 'running'; step += 1) {
      const result = await stepInquiry(db, { DB: db, LLM_PROVIDER: 'mock' }, inquiryId)
      status = String(result.status)
    }
    expect(status).toBe('awaiting_approval')
    const quote = await db.prepare('SELECT total_cents, discount_code FROM quotes').bind().first<{ total_cents: number; discount_code: string }>()
    expect(quote?.total_cents).toBe(145_401)
    expect(quote?.discount_code).toBe('ANNUAL')
    const again = await db.prepare('SELECT subject FROM inquiries WHERE id = ?').bind(inquiryId).first<{ subject: string }>()
    expect(again?.subject).toBe('Quote')
  })
})

describe('Vapi tools', () => {
  it('rejects a missing secret and prices from the rate card without writing a quote email', async () => {
    const db = await ready()
    const request = new Request('https://worker/vapi/tool', { headers: { 'x-vapi-secret': 'nope' } })
    expect(await authorizedVapi(request, 'expected-secret')).toBe(false)
    expect(await authorizedVapi(new Request('https://worker/vapi/tool', { headers: { 'x-vapi-secret': 'expected-secret' } }), 'expected-secret')).toBe(true)
    const result = await handleVapiTool(db, {
      message: {
        type: 'tool-calls',
        call: { id: 'call_1' },
        toolCallList: [{ id: 'tc1', function: { name: 'ballpark_quote', arguments: { request: 'Please quote 24 windows.' } } }],
      },
    })
    expect(result.results[0]?.result).toContain('207.84')
    const sent = await db.prepare('SELECT count(*) AS n FROM outbound_messages').bind().first<{ n: number }>()
    expect(sent?.n).toBe(0)
    await recordCall(db, { message: { type: 'end-of-call-report', summary: 'Asked about windows.', endedReason: 'customer-ended-call', call: { id: 'call_1' }, transcript: 'hello' } })
    const call = await db.prepare('SELECT summary FROM calls WHERE vapi_call_id = ?').bind('call_1').first<{ summary: string }>()
    expect(call?.summary).toContain('windows')
  })
})

describe('call limits', () => {
  it('stops the fourth call from the same visitor and the global daily cap', async () => {
    const db = await ready()
    for (let index = 0; index < 3; index += 1) expect(await takeWindow(db, 'call:hash', 3, 86_400_000, 1_000)).toBe(true)
    expect(await takeWindow(db, 'call:hash', 3, 86_400_000, 1_000)).toBe(false)
    for (let index = 0; index < 40; index += 1) expect(await takeDaily(db, 'calls', '2026-11-20', 40)).toBe(true)
    expect(await takeDaily(db, 'calls', '2026-11-20', 40)).toBe(false)
  })
})

describe('remote MCP', () => {
  it('requires a bearer token and lists the desk tools', async () => {
    const db = await ready()
    const denied = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }))
    expect(denied.status).toBe(401)
    const listed = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    }))
    const payload = await listed.json() as { result: { tools: { name: string; inputSchema: unknown }[] } }
    expect(payload.result.tools.map((tool) => tool.name)).toEqual(mcpTools().map((tool) => tool.name))
    expect(payload.result.tools.every((tool) => tool.inputSchema)).toBe(true)
    const quote = await handleMcp(db, 'desk-token', new Request('https://worker/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer desk-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'draft_quote', arguments: { request: 'Please quote 24 windows.' } } }),
    }))
    const quoteBody = await quote.json() as { result: { content: { text: string }[] } }
    expect(quoteBody.result.content[0]?.text).toContain('20784')
  })
})
