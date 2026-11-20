import { describe, expect, it } from 'vitest'
import { buildWorkersAiMessages, interpretWorkersAi, workersAiProvider, WORKERS_AI_FALLBACK, WORKERS_AI_PRIMARY } from './workers-ai'
import type { PolicyContext } from './policy'

const ctx: PolicyContext = {
  inquiry: {
    id: 'inq',
    source: 'email',
    fromName: 'Priya Shah',
    fromEmail: 'priya.shah@north-wharf.example',
    companyName: 'North Wharf Logistics',
    subject: 'Quote',
    body: 'Please quote 10,000 sqft.',
  },
  steps: [],
}

describe('Workers AI tool-call fixtures', () => {
  it('reads the binding tool_calls shape', () => {
    const parsed = interpretWorkersAi({
      tool_calls: [{ name: 'draft_quote', arguments: { lines: [{ sku: 'OFFICE-CLEAN', qty: 10000 }] } }],
    })
    expect(parsed).toMatchObject({ kind: 'tool', name: 'draft_quote' })
  })

  it('reads the chat-completions shape used by gpt-oss-120b', () => {
    const parsed = interpretWorkersAi({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'search_kb', arguments: '{"query":"hours"}' } },
            ],
          },
        },
      ],
    })
    expect(parsed).toEqual({ kind: 'tool', name: 'search_kb', args: { query: 'hours' } })
  })

  it('reads a tool call that leaked into content text', () => {
    const parsed = interpretWorkersAi({
      choices: [{ message: { content: '{"name":"get_price_list","arguments":{}}', tool_calls: [] }, finish_reason: 'stop' }],
    })
    expect(parsed).toMatchObject({ kind: 'tool', name: 'get_price_list' })
  })

  it('falls back to the second model when the first reply is malformed', async () => {
    const calls: string[] = []
    const provider = workersAiProvider({
      async run(model) {
        calls.push(model)
        if (model === WORKERS_AI_PRIMARY) return { response: '' }
        return { tool_calls: [{ name: 'search_kb', arguments: { query: 'services overview' } }] }
      },
    })
    await expect(provider.next(ctx)).resolves.toMatchObject({ type: 'tool', name: 'search_kb' })
    expect(calls).toEqual([WORKERS_AI_PRIMARY, WORKERS_AI_FALLBACK])
  })

  it('coerces numeric strings on the primary model', async () => {
    const calls: string[] = []
    const provider = workersAiProvider({
      async run(model) {
        calls.push(model)
        return { tool_calls: [{ name: 'search_kb', arguments: { query: 'services overview', limit: '5' } }] }
      },
    })
    await expect(provider.next(ctx)).resolves.toMatchObject({ type: 'tool', name: 'search_kb', args: { limit: 5 } })
    expect(calls).toEqual([WORKERS_AI_PRIMARY])
  })

  it('tries the fallback model when tool arguments fail validation', async () => {
    const calls: string[] = []
    const provider = workersAiProvider({
      async run(model) {
        calls.push(model)
        if (model === WORKERS_AI_PRIMARY) return { tool_calls: [{ name: 'search_kb', arguments: { query: 'hours', limit: 'five' } }] }
        return { tool_calls: [{ name: 'draft_quote', arguments: { companyName: 'North Wharf Logistics', contactName: 'Priya Shah', contactEmail: 'priya.shah@north-wharf.example', lines: [{ sku: 'WINDOW', quantity: '24' }] } }] }
      },
    })
    await expect(provider.next(ctx)).resolves.toMatchObject({
      type: 'tool',
      name: 'draft_quote',
      args: { lines: [{ sku: 'WINDOW', qty: 24 }] },
    })
    expect(calls).toEqual([WORKERS_AI_PRIMARY, WORKERS_AI_PRIMARY, WORKERS_AI_FALLBACK])
  })

  it('replays earlier tools as tool_calls instead of narration', () => {
    const messages = buildWorkersAiMessages({
      ...ctx,
      steps: [{ id: 'stp_1', tool: 'draft_quote', status: 'ok', args: { lines: [{ sku: 'WINDOW', qty: 24 }] }, result: { quoteId: 'quo_1' } }],
    })
    expect(messages.map((message) => message.content)).not.toContain('Called draft_quote.')
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_stp_1', type: 'function', function: { name: 'draft_quote' } }],
    })
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_stp_1', name: 'draft_quote' })
  })
})
