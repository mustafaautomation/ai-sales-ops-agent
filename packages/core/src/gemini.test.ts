import { describe, expect, it } from 'vitest'
import { modelLabel } from './outbound'
import {
  deskModelProvider,
  GEMINI_API_BASE,
  GEMINI_DEFAULT_MODEL,
  geminiProvider,
  interpretGemini,
  shouldFallbackToGemini,
} from './gemini'
import { MalformedModelOutput, WORKERS_AI_FALLBACK, WORKERS_AI_PRIMARY } from './workers-ai'
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
    expect(modelLabel(GEMINI_DEFAULT_MODEL)).toBe('Gemini 2.5 Flash')
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
      geminiModel: 'gemini-2.5-flash',
      fetch: async (input, init) => {
        const headers = init?.headers instanceof Headers
          ? init.headers
          : new Headers(init?.headers as Record<string, string>)
        seen.push({ url: String(input), headers })
        return new Response(JSON.stringify(geminiToolResponse('search_kb', { query: 'hours' })), { status: 200 })
      },
    })
    const turn = await provider.next(ctx)
    expect(turn).toMatchObject({ type: 'tool', name: 'search_kb', model: 'gemini-2.5-flash' })
    if (turn.type === 'tool') {
      expect(turn.attempts?.some((attempt) => /4006|neuron/i.test(attempt.reason))).toBe(true)
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(`${GEMINI_API_BASE}/gemini-2.5-flash:generateContent`)
    expect(seen[0]?.url).not.toContain(secret)
    expect(seen[0]?.url).not.toContain('key=')
    expect(new Headers(seen[0]?.headers).get('x-goog-api-key')).toBe(secret)
  })

  it('sends a Gemini 429 to human-review style failures without leaking the key', async () => {
    const logs: string[] = []
    const provider = geminiProvider({
      apiKey: secret,
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
      expect(failure.message).toContain('AI daily limit')
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
