import { describe, expect, it } from 'vitest'
import { interpretWorkersAi, workersAiProvider, WORKERS_AI_FALLBACK, WORKERS_AI_PRIMARY } from './workers-ai'
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
})
