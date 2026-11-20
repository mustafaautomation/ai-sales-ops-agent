import { openAiTools, trustedTranscript, type Provider } from './providers'
import type { PolicyContext } from './policy'
import { parseToolArgs, TOOL_DEFS, type ToolName } from './tool-schemas'
import { briefModelError, MalformedModelOutput, modelAttemptNotes, type ModelFailure } from './workers-ai'

export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'
export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

/** Test seam. Production uses global fetch. */
export const groqHttp: { fetch: typeof fetch } = {
  fetch: (input, init) => fetch(input, init),
}

export type GroqOptions = {
  apiKey: string
  model?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export function parseGroqModels(value?: string): string[] {
  const parts = String(value || GROQ_DEFAULT_MODEL)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : [GROQ_DEFAULT_MODEL]
}

/** Prefix stored on steps so the run page can show provider + model. */
export function groqModelTag(model: string): string {
  return model.startsWith('groq/') ? model : `groq/${model}`
}

function redactSecrets(text: string, apiKey: string): string {
  return text.split(apiKey).join('[redacted]')
}

function toolsFor(required?: string): unknown[] {
  const tools = openAiTools() as { type: string; function: { name: string } }[]
  return required ? tools.filter((tool) => tool.function.name === required) : tools
}

function buildGroqMessages(ctx: PolicyContext, nudge?: string): { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] {
  const transcript = trustedTranscript(ctx)
  const messages: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] = [
    { role: 'system', content: transcript.system },
    { role: 'user', content: transcript.user },
  ]
  ctx.steps.forEach((step, index) => {
    if (!step.tool || step.status === 'error' || !TOOL_DEFS.some((tool) => tool.name === step.tool)) return
    const callId = `call_${step.id ?? `${step.tool}_${index}`}`
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: callId,
        type: 'function',
        function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) },
      }],
    })
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      name: step.tool,
      content: JSON.stringify(step.result ?? {}).slice(0, 4000),
    })
  })
  const note = nudge || ctx.nudge
  if (note) messages.push({ role: 'user', content: note })
  return messages
}

export function interpretGroq(payload: unknown):
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'malformed'; detail: string } {
  if (!payload || typeof payload !== 'object') return { kind: 'malformed', detail: 'empty Groq payload' }
  const message = (payload as { choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } }[] })
    .choices?.[0]?.message
  if (!message) return { kind: 'malformed', detail: 'Groq returned no message' }
  const call = message.tool_calls?.[0]?.function
  if (call?.name) {
    let args: unknown = call.arguments ?? {}
    if (typeof args === 'string') {
      try { args = JSON.parse(args || '{}') } catch { /* keep string */ }
    }
    return { kind: 'tool', name: call.name, args }
  }
  const text = typeof message.content === 'string' ? message.content.trim() : ''
  if (text) return { kind: 'text', text }
  return { kind: 'malformed', detail: 'Groq returned neither a tool call nor text' }
}

export function groqProvider(options: GroqOptions): Provider {
  const models = parseGroqModels(options.model)
  const fetchImpl = options.fetch ?? ((input, init) => groqHttp.fetch(input, init))
  const timeoutMs = options.timeoutMs ?? 12_000 // keep in sync with PROVIDER_TIMEOUT_MS in gemini.ts
  const apiKey = options.apiKey
  return {
    name: 'groq',
    async next(ctx) {
      const failures: ModelFailure[] = []
      let validationError = ''
      for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const required = ctx.requiredTool
          const nudge = [
            required ? `Call only the tool ${required}. Do not answer in prose.` : '',
            ctx.nudge,
            validationError
              ? `The previous tool call was rejected: ${validationError}. Call ${required ?? 'the tool'} again with valid JSON. lines must be an array of objects with sku and qty, not a JSON string.`
              : '',
          ].filter(Boolean).join('\n\n')
          let payload: unknown
          try {
            const response = await fetchImpl(GROQ_API_URL, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model,
                temperature: 0,
                messages: buildGroqMessages(ctx, nudge || undefined),
                tools: toolsFor(required),
                tool_choice: required
                  ? { type: 'function', function: { name: required } }
                  : 'auto',
              }),
              signal: AbortSignal.timeout(timeoutMs),
            })
            const text = await response.text()
            const safe = redactSecrets(text, apiKey)
            if (!response.ok) {
              if (response.status === 429) {
                failures.push({
                  model: groqModelTag(model),
                  code: '429',
                  error: '429: Groq rate limit; AI daily limit reached, resets 08:00 MYT',
                })
              } else {
                const brief = briefModelError(`${response.status}: ${safe.slice(0, 160)}`)
                failures.push({ model: groqModelTag(model), ...brief, error: redactSecrets(brief.error, apiKey) })
              }
              break
            }
            payload = JSON.parse(safe) as unknown
          } catch (error) {
            const message = redactSecrets(error instanceof Error ? error.message : 'Groq transport error', apiKey)
            failures.push({ model: groqModelTag(model), ...briefModelError(message) })
            break
          }
          const interpreted = interpretGroq(payload)
          const tagged = groqModelTag(model)
          if (interpreted.kind === 'tool') {
            if (!TOOL_DEFS.some((tool) => tool.name === interpreted.name)) {
              failures.push({ model: tagged, code: null, error: `unknown tool ${interpreted.name}` })
              break
            }
            const parsed = parseToolArgs(interpreted.name, asRecord(interpreted.args))
            if (!parsed.ok) {
              validationError = parsed.error
              failures.push({ model: tagged, ...briefModelError(parsed.error) })
              if (attempt === 0) continue
              break
            }
            return {
              type: 'tool' as const,
              name: interpreted.name as ToolName,
              args: parsed.data,
              model: tagged,
              attempts: modelAttemptNotes(failures),
            }
          }
          if (interpreted.kind === 'text') {
            if (ctx.requiredTool) {
              failures.push({ model: tagged, code: null, error: 'no tool call' })
              break
            }
            return { type: 'text' as const, text: interpreted.text, model: tagged, attempts: modelAttemptNotes(failures) }
          }
          failures.push({ model: tagged, ...briefModelError(interpreted.detail) })
          break
        }
      }
      const summary = failures.map((failure) => `${failure.model}: ${failure.error}`).join('; ')
      throw new MalformedModelOutput(summary || 'Groq tool call was malformed.', failures)
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return { value }
}
