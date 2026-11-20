import { describe, expect, it } from 'vitest'
import { modelLabel } from './outbound'
import {
  deskModelProvider,
  findForbiddenSchemaKeys,
  GEMINI_API_BASE,
  GEMINI_DEFAULT_MODEL,
  GEMINI_DEFAULT_MODEL_LIST,
  geminiFunctionDeclarations,
  geminiProvider,
  interpretGemini,
  parseFallbackOrder,
  parseGeminiModels,
  PROVIDER_TIMEOUT_MS,
  scrubSchema,
  shouldFallbackToGemini,
} from './gemini'
import { MalformedModelOutput, WORKERS_AI_FALLBACK, WORKERS_AI_PRIMARY } from './workers-ai'
import { jsonSchemaFor, TOOL_DEFS, TOOL_NAMES, toolSchemas } from './tool-schemas'
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

const secret = 'gemini-test-secret-key-do-not-leak'

function geminiToolResponse(name: string, args: Record<string, unknown>) {
  return {
    candidates: [{
      content: {
        parts: [{ functionCall: { name, args } }],
      },
    }],
  }
}

describe('Gemini fallback', () => {
  it('labels Gemini models for the run timeline', () => {
    expect(modelLabel('gemini-2.5-flash')).toBe('Gemini 2.5 Flash')
    expect(modelLabel(GEMINI_DEFAULT_MODEL)).toBe('Gemini 3.5 Flash Lite')
    expect(modelLabel('gemini-3.1-flash-lite')).toBe('Gemini 3.1 Flash Lite')
  })

  it('parses a comma-separated GEMINI_MODEL list', () => {
    expect(parseGeminiModels()).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])
    expect(parseGeminiModels(GEMINI_DEFAULT_MODEL_LIST)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])
    expect(parseGeminiModels('gemini-3.5-flash-lite')).toEqual(['gemini-3.5-flash-lite'])
  })

  it('parses MODEL_FALLBACK_ORDER with Groq before Gemini by default', () => {
    expect(parseFallbackOrder()).toEqual(['workers-ai', 'groq', 'gemini'])
    expect(parseFallbackOrder('workers-ai,gemini,groq')).toEqual(['workers-ai', 'gemini', 'groq'])
    expect(PROVIDER_TIMEOUT_MS).toBe(12_000)
  })

  it('switches to Gemini after Workers AI 4006', () => {
    expect(shouldFallbackToGemini([
      { model: WORKERS_AI_PRIMARY, code: '4006', error: '4006: AI daily neuron limit reached; resets 08:00 MYT' },
      { model: WORKERS_AI_FALLBACK, code: '4006', error: '4006: AI daily neuron limit reached; resets 08:00 MYT' },
    ])).toBe(true)
    expect(shouldFallbackToGemini([
      { model: WORKERS_AI_PRIMARY, code: '5006', error: '5006: schema' },
    ])).toBe(false)
    expect(shouldFallbackToGemini([
      { model: WORKERS_AI_PRIMARY, code: '503', error: '503: unavailable' },
    ])).toBe(true)
    expect(shouldFallbackToGemini([
      { model: WORKERS_AI_PRIMARY, code: null, error: 'AbortError: The operation was aborted due to timeout' },
    ])).toBe(true)
  })

  it('falls back from Workers AI 4006 to Gemini and keeps the key out of the URL', async () => {
    const seen: { url: string; headers: Headers | Record<string, string> }[] = []
    const ai = {
      async run() {
        throw new Error('4006: daily neuron limit exceeded')
      },
    }
    const provider = deskModelProvider({
      ai,
      geminiApiKey: secret,
      geminiModel: 'gemini-3.5-flash-lite',
      fetch: async (input, init) => {
        const headers = init?.headers instanceof Headers
          ? init.headers
          : new Headers(init?.headers as Record<string, string>)
        seen.push({ url: String(input), headers })
        return new Response(JSON.stringify(geminiToolResponse('search_kb', { query: 'hours' })), { status: 200 })
      },
    })
    const turn = await provider.next(ctx)
    expect(turn).toMatchObject({ type: 'tool', name: 'search_kb', model: 'gemini-3.5-flash-lite' })
    if (turn.type === 'tool') {
      expect(turn.attempts?.some((attempt) => /4006|neuron/i.test(attempt.reason))).toBe(true)
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(`${GEMINI_API_BASE}/gemini-3.5-flash-lite:generateContent`)
    expect(seen[0]?.url).not.toContain(secret)
    expect(seen[0]?.url).not.toContain('key=')
    expect(new Headers(seen[0]?.headers).get('x-goog-api-key')).toBe(secret)
  })

  it('tries the next Gemini model after 404', async () => {
    const seen: string[] = []
    const provider = geminiProvider({
      apiKey: secret,
      model: 'gemini-2.5-flash,gemini-3.5-flash-lite',
      fetch: async (input) => {
        const url = String(input)
        seen.push(url)
        if (url.includes('gemini-2.5-flash')) {
          return new Response(JSON.stringify({ error: { message: 'no longer available to new users' } }), { status: 404 })
        }
        return new Response(JSON.stringify(geminiToolResponse('search_kb', { query: 'hours' })), { status: 200 })
      },
    })
    const turn = await provider.next(ctx)
    expect(turn).toMatchObject({ type: 'tool', name: 'search_kb', model: 'gemini-3.5-flash-lite' })
    expect(seen).toHaveLength(2)
  })

  it('sends a Gemini 429 to human-review style failures without leaking the key', async () => {
    const logs: string[] = []
    const provider = geminiProvider({
      apiKey: secret,
      model: 'gemini-3.5-flash-lite',
      fetch: async (input) => {
        logs.push(String(input))
        return new Response(JSON.stringify({ error: { message: `quota for ${secret}` } }), { status: 429 })
      },
    })
    await expect(provider.next(ctx)).rejects.toBeInstanceOf(MalformedModelOutput)
    try {
      await provider.next(ctx)
    } catch (error) {
      expect(error).toBeInstanceOf(MalformedModelOutput)
      const failure = error as MalformedModelOutput
      expect(failure.attempts[0]?.code).toBe('429')
      expect(failure.message).toContain('Gemini rate limited')
      expect(failure.message).not.toContain('08:00 MYT')
      expect(failure.message).not.toContain(secret)
      expect(JSON.stringify(failure.attempts)).not.toContain(secret)
    }
    expect(logs.every((url) => !url.includes(secret) && !url.includes('key='))).toBe(true)
  })

  it('skips Gemini when the API key is missing', async () => {
    const provider = deskModelProvider({
      ai: {
        async run() {
          throw new Error('4006: daily neuron limit exceeded')
        },
      },
    })
    await expect(provider.next(ctx)).rejects.toThrow(/4006/)
  })

  it('reads a Gemini functionCall payload', () => {
    expect(interpretGemini(geminiToolResponse('search_kb', { query: 'hours' }))).toEqual({
      kind: 'tool',
      name: 'search_kb',
      args: { query: 'hours' },
    })
  })
})

describe('scrubSchema for Gemini function parameters', () => {
  it('scrubs the real zod-to-json-schema output for every tool', () => {
    for (const name of TOOL_NAMES) {
      const raw = jsonSchemaFor(toolSchemas[name as keyof typeof toolSchemas])
      const cleaned = scrubSchema(raw)
      expect(findForbiddenSchemaKeys(cleaned), name).toEqual([])
      expect(JSON.stringify(cleaned)).not.toContain('"exclusiveMinimum"')
      expect(JSON.stringify(cleaned)).not.toContain('"additionalProperties"')
      expect(JSON.stringify(cleaned)).not.toMatch(/"type"\s*:\s*\[/)
    }
  })

  it('converts draft_quote exclusiveMinimum and null unions', () => {
    const cleaned = scrubSchema(jsonSchemaFor(toolSchemas.draft_quote))
    const lines = cleaned.properties as Record<string, Record<string, unknown>>
    const qty = (lines.lines as { items: { properties: { qty: Record<string, unknown> } } }).items.properties.qty
    expect(qty.exclusiveMinimum).toBeUndefined()
    expect(qty.minimum).toBe(1)
    expect(qty.type).toBe('integer')
    const discount = lines.discountCode
    expect(discount.type).toBe('string')
    expect(discount.nullable).toBe(true)
    expect(discount.anyOf).toBeUndefined()
  })

  it('converts send_email type arrays to nullable string', () => {
    const cleaned = scrubSchema(jsonSchemaFor(toolSchemas.send_email))
    const quoteId = (cleaned.properties as Record<string, Record<string, unknown>>).quoteId
    expect(Array.isArray(quoteId.type)).toBe(false)
    expect(quoteId.type).toBe('string')
    expect(quoteId.nullable).toBe(true)
  })

  it('emits scrubbed parameters on every Gemini function declaration', () => {
    const declared = geminiFunctionDeclarations()
    expect(declared.map((tool) => tool.name).sort()).toEqual(TOOL_DEFS.map((tool) => tool.name).slice().sort())
    for (const tool of declared) {
      expect(findForbiddenSchemaKeys(tool.parameters)).toEqual([])
    }
  })
})
