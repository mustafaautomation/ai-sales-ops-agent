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
    const turn = await provider.next(ctx)
    expect(turn).toMatchObject({
      type: 'tool',
      name: 'draft_quote',
      args: { lines: [{ sku: 'WINDOW', qty: 24 }] },
    })
    if (turn.type === 'tool') {
      expect(turn.attempts?.[0]?.reason).toBeTruthy()
      expect(turn.attempts?.[0]?.reason).not.toBe('rejected')
      expect((turn.attempts?.[0]?.reason.length ?? 0)).toBeLessThanOrEqual(80)
    }
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
      content: '',
      tool_calls: [{ id: 'call_stp_1', type: 'function', function: { name: 'draft_quote' } }],
    })
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_stp_1', name: 'draft_quote' })
    expect(messages.every((message) => typeof message.content === 'string')).toBe(true)
  })

  it('keeps the rejected attempt when the fallback model calls the tool', async () => {
    const provider = workersAiProvider({
      async run(model) {
        if (model === WORKERS_AI_PRIMARY) return { choices: [{ message: { content: 'I looked that up.' } }] }
        return { tool_calls: [{ name: 'search_kb', arguments: { query: 'hours' } }] }
      },
    })
    await expect(provider.next({ ...ctx, requiredTool: 'search_kb' })).resolves.toMatchObject({
      type: 'tool',
      name: 'search_kb',
      model: WORKERS_AI_FALLBACK,
      attempts: [{ model: 'gpt-oss-120b', outcome: 'no tool call', reason: 'no tool call' }],
    })
  })

  it('offers only the required tool', async () => {
    let names: string[] = []
    let text = ''
    const provider = workersAiProvider({
      async run(_model, input) {
        const body = input as { tools: { name: string }[]; messages: { content: string }[] }
        names = body.tools.map((tool) => tool.name)
        text = body.messages.map((message) => message.content).join('\n')
        return { tool_calls: [{ name: 'search_kb', arguments: { query: 'hours' } }] }
      },
    })
    await provider.next({ ...ctx, requiredTool: 'search_kb' })
    expect(names).toEqual(['search_kb'])
    expect(text).toContain('Call only the tool search_kb')
  })

  it('rejects a recorded schema failure from both models and keeps both errors', async () => {
    const recorded = '5006: oneOf at \'/\' not met, 0 matches: Type mismatch of \'/messages/2/content\', \'string\' not in \'null\', required properties at \'/messages/2\' are \'role,content\''
    const seen: { model: string; messages: { role: string; content: unknown; tool_call_id?: string }[] }[] = []
    const provider = workersAiProvider({
      async run(model, input) {
        const messages = (input as { messages: { role: string; content: unknown; tool_call_id?: string }[] }).messages
        seen.push({ model, messages })
        if (messages.some((message) => typeof message.content !== 'string')) throw new Error(recorded)
        throw new Error(recorded)
      },
    })
    await expect(provider.next({
      ...ctx,
      steps: [{ id: 'stp_1', tool: 'search_kb', status: 'ok', args: { query: 'hours' }, result: { chunks: [] } }],
    })).rejects.toThrow(/gpt-oss-120b: 5006/)
    await expect(provider.next({
      ...ctx,
      steps: [{ id: 'stp_1', tool: 'search_kb', status: 'ok', args: { query: 'hours' }, result: { chunks: [] } }],
    })).rejects.toThrow(/llama-3.3-70b/)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((call) => call.messages.every((message) => typeof message.content === 'string'))).toBe(true)
    expect(seen[0]?.messages.some((message) => message.role === 'tool' && typeof message.tool_call_id === 'string' && typeof message.content === 'string')).toBe(true)
  })
})
