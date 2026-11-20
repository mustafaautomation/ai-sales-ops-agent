import { describe, expect, it } from 'vitest'
import { modelLabel } from './outbound'
import { deskModelProvider } from './gemini'
import { GROQ_API_URL, groqModelTag, interpretGroq } from './groq'
import { MalformedModelOutput, WORKERS_AI_PRIMARY } from './workers-ai'
import type { PolicyContext } from './policy'

const ctx: PolicyContext = {
  inquiry: {
    id: 'inq',
    source: 'email',
    fromName: 'Priya Shah',
    fromEmail: 'priya.shah@north-wharf.example',
    companyName: 'North Wharf Logistics',
    subject: 'Hours',
    body: 'What are your service hours in Cedarhaven?',
  },
  steps: [],
  requiredTool: 'search_kb',
}

const geminiSecret = 'gemini-secret-for-tests'
const groqSecret = 'groq-secret-for-tests'

function geminiOk() {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ functionCall: { name: 'search_kb', args: { query: 'hours' } } }] } }],
  }), { status: 200 })
}

function groqOk() {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        tool_calls: [{ function: { name: 'search_kb', arguments: JSON.stringify({ query: 'hours' }) } }],
      },
    }],
  }), { status: 200 })
}

describe('Groq fallback chain', () => {
  it('labels Groq models with the provider name', () => {
    expect(modelLabel(groqModelTag('openai/gpt-oss-120b'))).toBe('Groq gpt-oss-120b')
    expect(modelLabel('groq/openai/gpt-oss-20b')).toBe('Groq gpt-oss-20b')
  })

  it('reads a Groq tool_calls payload', () => {
    expect(interpretGroq({
      choices: [{ message: { tool_calls: [{ function: { name: 'search_kb', arguments: '{"query":"hours"}' } }] } }],
    })).toEqual({ kind: 'tool', name: 'search_kb', args: { query: 'hours' } })
  })

  it('prefers Groq over Gemini in the default fallback order', async () => {
    const seen: string[] = []
    const provider = deskModelProvider({
      ai: { async run() { throw new Error('4006: daily neuron limit exceeded') } },
      geminiApiKey: geminiSecret,
      geminiModel: 'gemini-3.5-flash-lite',
      groqApiKey: groqSecret,
      groqModel: 'openai/gpt-oss-120b',
      fetch: async (input) => {
        seen.push(String(input))
        if (String(input) === GROQ_API_URL) return groqOk()
        throw new Error(`unexpected ${input}`)
      },
    })
    const turn = await provider.next(ctx)
    expect(turn).toMatchObject({ type: 'tool', name: 'search_kb', model: 'groq/openai/gpt-oss-120b' })
    expect(seen.some((url) => url === GROQ_API_URL)).toBe(true)
    expect(seen.some((url) => url.includes('generativelanguage.googleapis.com'))).toBe(false)
  })

  it('falls back from Workers AI 4006 to Gemini when order puts Gemini next', async () => {
    const seen: string[] = []
    const provider = deskModelProvider({
      ai: { async run() { throw new Error('4006: daily neuron limit exceeded') } },
      geminiApiKey: geminiSecret,
      geminiModel: 'gemini-3.5-flash-lite',
      groqApiKey: groqSecret,
      fallbackOrder: 'workers-ai,gemini,groq',
      fetch: async (input) => {
        seen.push(String(input))
        if (String(input).includes('generativelanguage.googleapis.com')) return geminiOk()
        throw new Error(`unexpected ${input}`)
      },
    })
    const turn = await provider.next(ctx)
    expect(turn).toMatchObject({ type: 'tool', name: 'search_kb', model: 'gemini-3.5-flash-lite' })
    expect(seen.some((url) => url.includes('generativelanguage.googleapis.com'))).toBe(true)
    expect(seen.some((url) => url.includes('api.groq.com'))).toBe(false)
  })

  it('falls back from Workers AI 4006 and Gemini 429 to Groq', async () => {
    const seen: string[] = []
    const provider = deskModelProvider({
      ai: { async run() { throw new Error('4006: daily neuron limit exceeded') } },
      geminiApiKey: geminiSecret,
      geminiModel: 'gemini-3.5-flash-lite',
      groqApiKey: groqSecret,
      groqModel: 'openai/gpt-oss-120b',
      fallbackOrder: 'workers-ai,gemini,groq',
      fetch: async (input, init) => {
        const url = String(input)
        seen.push(url)
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })
        }
        if (url === GROQ_API_URL) {
          const headers = new Headers(init?.headers as Record<string, string>)
          expect(headers.get('authorization')).toBe(`Bearer ${groqSecret}`)
          expect(url).not.toContain(groqSecret)
          return groqOk()
        }
        throw new Error(`unexpected ${url}`)
      },
    })
    const turn = await provider.next(ctx)
    expect(turn).toMatchObject({ type: 'tool', name: 'search_kb', model: 'groq/openai/gpt-oss-120b' })
    if (turn.type === 'tool') {
      expect(turn.attempts?.some((attempt) => /4006|neuron/i.test(attempt.reason))).toBe(true)
      expect(turn.attempts?.some((attempt) => /429|rate/i.test(attempt.reason))).toBe(true)
    }
    expect(seen.some((url) => url.includes('generativelanguage.googleapis.com'))).toBe(true)
    expect(seen.some((url) => url === GROQ_API_URL)).toBe(true)
  })

  it('retries draft_quote once on the same Groq model when tool choice is missing', async () => {
    let calls = 0
    const bodies: unknown[] = []
    const { groqProvider } = await import('./groq')
    const provider = groqProvider({
      apiKey: groqSecret,
      model: 'openai/gpt-oss-120b',
      fetch: async (_input, init) => {
        calls += 1
        bodies.push(JSON.parse(String(init?.body ?? '{}')))
        if (calls === 1) {
          return new Response(JSON.stringify({ error: { message: 'Tool choice is required, but model did not call a tool' } }), { status: 400 })
        }
        return new Response(JSON.stringify({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'draft_quote',
                  arguments: JSON.stringify({
                    companyName: 'North Wharf Logistics',
                    contactName: 'Priya Shah',
                    contactEmail: 'priya.shah@north-wharf.example',
                    lines: [{ sku: 'WINDOW', qty: 10 }],
                  }),
                },
              }],
            },
          }],
        }), { status: 200 })
      },
    })
    const turn = await provider.next({ ...ctx, requiredTool: 'draft_quote' })
    expect(turn).toMatchObject({ type: 'tool', name: 'draft_quote', model: 'groq/openai/gpt-oss-120b' })
    expect(calls).toBe(2)
    expect(bodies[0]).toMatchObject({
      tool_choice: { type: 'function', function: { name: 'draft_quote' } },
    })
    const tools = (bodies[0] as { tools: { function: { name: string; parameters: Record<string, unknown> } }[] }).tools
    expect(tools).toHaveLength(1)
    expect(tools[0]?.function.name).toBe('draft_quote')
    expect(Object.keys(tools[0]?.function.parameters.properties as object)).not.toContain('discountCode')
  })

  it('accepts get_price_list with an empty object on the first Groq call', async () => {
    const { groqProvider } = await import('./groq')
    const captured: { body: { tools?: { function: { name: string; parameters: unknown } }[] } | null } = { body: null }
    const provider = groqProvider({
      apiKey: groqSecret,
      model: 'openai/gpt-oss-120b',
      fetch: async (_input, init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}'))
        return new Response(JSON.stringify({
          choices: [{ message: { tool_calls: [{ function: { name: 'get_price_list', arguments: '{}' } }] } }],
        }), { status: 200 })
      },
    })
    const turn = await provider.next({ ...ctx, requiredTool: 'get_price_list' })
    expect(turn).toMatchObject({ type: 'tool', name: 'get_price_list' })
    const tool = captured.body?.tools?.[0]
    expect(tool?.function.name).toBe('get_price_list')
    expect(tool?.function.parameters).toEqual({ type: 'object', properties: {}, required: [], additionalProperties: false })
  })

  it('throws for human review when Workers AI, Groq, and Gemini all fail', async () => {
    const provider = deskModelProvider({
      ai: { async run() { throw new Error('4006: daily neuron limit exceeded') } },
      geminiApiKey: geminiSecret,
      geminiModel: 'gemini-3.5-flash-lite',
      groqApiKey: groqSecret,
      fetch: async (input) => {
        const url = String(input)
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })
        }
        return new Response(JSON.stringify({ error: { message: 'groq down' } }), { status: 503 })
      },
    })
    await expect(provider.next(ctx)).rejects.toBeInstanceOf(MalformedModelOutput)
    try {
      await provider.next(ctx)
    } catch (error) {
      const failure = error as MalformedModelOutput
      expect(failure.attempts.some((attempt) => attempt.model.includes(WORKERS_AI_PRIMARY.split('/').pop()!) || attempt.code === '4006' || /4006/.test(attempt.error))).toBe(true)
      expect(failure.attempts.some((attempt) => /groq/i.test(attempt.model) || /503/.test(attempt.error))).toBe(true)
      expect(failure.attempts.some((attempt) => attempt.code === '429' || /Gemini|429/.test(attempt.error))).toBe(true)
      expect(failure.message).not.toContain(geminiSecret)
      expect(failure.message).not.toContain(groqSecret)
    }
  })
})
