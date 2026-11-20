import { trustedTranscript, type Provider } from './providers'
import type { PolicyContext } from './policy'
import { parseToolArgs, TOOL_DEFS, WORKERS_AI_TOOLS, type ToolName } from './tool-schemas'

export class MalformedModelOutput extends Error {
  attempts: ModelFailure[]
  constructor(message: string, attempts: ModelFailure[] = []) {
    super(message)
    this.name = 'MalformedModelOutput'
    this.attempts = attempts
  }
}

export const WORKERS_AI_PRIMARY = '@cf/openai/gpt-oss-120b'
export const WORKERS_AI_FALLBACK = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

export type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>
}

/**
 * Workers AI accepts two tool-call shapes.
 * Binding docs return `{ tool_calls: [{ name, arguments }] }`.
 * Chat-completions style models, including gpt-oss-120b, return
 * `choices[0].message.tool_calls[].function`.
 * Some gpt-oss replies put a JSON tool call in `content` instead.
 */
export function interpretWorkersAi(payload: unknown):
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'malformed'; detail: string } {
  if (!payload || typeof payload !== 'object') return { kind: 'malformed', detail: 'empty model payload' }
  const record = payload as Record<string, unknown>
  const choice = (record.choices as { message?: Record<string, unknown>; finish_reason?: string }[] | undefined)?.[0]
  const message = choice?.message
  const openAiCall = (message?.tool_calls as { function?: { name?: string; arguments?: unknown } }[] | undefined)?.[0]?.function
  if (openAiCall?.name) return { kind: 'tool', name: openAiCall.name, args: parseArgs(openAiCall.arguments) }
  const legacy = (record.tool_calls as { name?: string; arguments?: unknown }[] | undefined)?.[0]
  if (legacy?.name) return { kind: 'tool', name: legacy.name, args: parseArgs(legacy.arguments) }
  const text = textOf(message?.content) || textOf(record.response)
  const embedded = text ? embeddedTool(text) : null
  if (embedded) return embedded
  if (text && text.trim()) return { kind: 'text', text: text.trim() }
  return { kind: 'malformed', detail: 'model returned neither a tool call nor text' }
}

function parseArgs(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }
  return value ?? {}
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  return ''
}

function embeddedTool(text: string): { kind: 'tool'; name: string; args: unknown } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { name?: string; arguments?: unknown }
    if (parsed.name && TOOL_DEFS.some((tool) => tool.name === parsed.name)) {
      return { kind: 'tool', name: parsed.name, args: parseArgs(parsed.arguments) }
    }
  } catch {
    return null
  }
  return null
}

export type WorkersMessage = {
  role: string
  content: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

export type ModelFailure = { model: string; error: string; code: string | null }

/**
 * Both gpt-oss-120b and Llama 3.3 are called through the AI binding with `{ messages, tools }`.
 * The live binding schema requires every message `content` to be a string. `content: null` on an
 * assistant tool turn fails both models with 5006 (`string` not in `null` / `null` not in `string`
 * across the oneOf). gpt-oss can also take a Responses API `input`, but Llama cannot, so both
 * models use this chat shape. A tool turn is an assistant message with `content: ""` and
 * `tool_calls`, then `{ role: "tool", tool_call_id, content: string }`.
 */
export function buildWorkersAiMessages(ctx: PolicyContext, nudge?: string): WorkersMessage[] {
  const transcript = trustedTranscript(ctx)
  const messages: WorkersMessage[] = [
    { role: 'system', content: asContent(transcript.system) },
    { role: 'user', content: asContent(transcript.user) },
  ]
  ctx.steps.forEach((step, index) => {
    if (!step.tool || step.status === 'error' || !TOOL_DEFS.some((tool) => tool.name === step.tool)) return
    const callId = `call_${step.id ?? `${step.tool}_${index}`}`
    const argumentsText = asContent(JSON.stringify(step.args ?? {}))
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: callId,
        type: 'function',
        function: { name: step.tool, arguments: argumentsText },
      }],
    })
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      name: step.tool,
      content: asContent(JSON.stringify(step.result ?? {})).slice(0, 4000),
    })
  })
  const note = nudge || ctx.nudge
  if (note) messages.push({ role: 'user', content: asContent(note) })
  return messages
}

export function briefModelError(message: string): { code: string | null; error: string } {
  const code = message.match(/\b(\d{3,4})\b/)?.[1] ?? null
  if (code === '4006') return { code, error: '4006: AI daily neuron limit reached; resets 08:00 MYT' }
  if (code === '429') return { code, error: '429: AI rate limit reached; resets 08:00 MYT' }
  if (code === '5006') return { code, error: '5006: Workers AI rejected the message schema' }
  const compact = message.replace(/\s+/g, ' ').trim().slice(0, 140)
  return { code, error: compact || 'model failed' }
}

function asContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

export function workersAiProvider(ai: AiBinding, options?: { primary?: string; fallback?: string }): Provider {
  const primary = options?.primary || WORKERS_AI_PRIMARY
  const fallback = options?.fallback || WORKERS_AI_FALLBACK
  return {
    name: 'workers-ai',
    async next(ctx) {
      const failures: ModelFailure[] = []
      for (const model of [primary, fallback]) {
        let validationError = ''
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const required = ctx.requiredTool
          const tools = required ? WORKERS_AI_TOOLS.filter((tool) => tool.name === required) : WORKERS_AI_TOOLS
          const nudge = [
            required ? `Call only the tool ${required}. Do not answer in prose.` : '',
            ctx.nudge,
            validationError
              ? `The previous tool call was rejected: ${validationError}. Call ${required ?? 'the tool'} again with valid JSON. lines must be an array of objects with sku and qty, not a JSON string.`
              : '',
          ].filter(Boolean).join('\n\n')
          let payload: unknown
          try {
            payload = await ai.run(model, {
              messages: buildWorkersAiMessages(ctx, nudge || undefined),
              tools,
            })
          } catch (error) {
            failures.push({ model, ...briefModelError(error instanceof Error ? error.message : 'transport error') })
            break
          }
          const interpreted = interpretWorkersAi(payload)
          if (interpreted.kind === 'tool') {
            if (!TOOL_DEFS.some((tool) => tool.name === interpreted.name)) {
              failures.push({ model, code: null, error: `unknown tool ${interpreted.name}` })
              break
            }
            const parsed = parseToolArgs(interpreted.name, asRecord(interpreted.args))
            if (!parsed.ok) {
              validationError = parsed.error
              failures.push({ model, ...briefModelError(parsed.error) })
              if (attempt === 0) continue
              break
            }
            return {
              type: 'tool' as const,
              name: interpreted.name as ToolName,
              args: parsed.data,
              model,
              attempts: modelAttemptNotes(failures),
            }
          }
          if (interpreted.kind === 'text') {
            if (ctx.requiredTool) {
              failures.push({ model, code: null, error: 'no tool call' })
              break
            }
            return { type: 'text' as const, text: interpreted.text, model, attempts: modelAttemptNotes(failures) }
          }
          failures.push({ model, ...briefModelError(interpreted.detail) })
          break
        }
      }
      const summary = failures.map((failure) => `${failure.model}: ${failure.error}`).join('; ')
      const lastText = failures.length > 0 && failures.every((failure) => failure.error === 'no tool call')
      if (lastText) {
        return { type: 'text' as const, text: 'no tool call', model: failures.at(-1)?.model, attempts: modelAttemptNotes(failures) }
      }
      throw new MalformedModelOutput(summary || 'Workers AI tool call was malformed.', failures)
    },
  }
}

export function shortAttemptReason(reason: string): { short: string; detail: string } {
  const detail = reason.replace(/\s+/g, ' ').trim()
  const missing = [...detail.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*Required\b/g)].map((match) => match[1])
  const unique = [...new Set(missing)]
  if (unique.length > 0) {
    return { short: `model sent invalid arguments (${unique.length} field${unique.length === 1 ? '' : 's'} missing)`, detail }
  }
  if (detail === 'no tool call') return { short: 'no tool call', detail }
  return { short: detail.slice(0, 90), detail }
}

export function modelAttemptNotes(failures: ModelFailure[]): { model: string; outcome: string; reason: string; detail: string }[] {
  const notes: { model: string; outcome: string; reason: string; detail: string }[] = []
  const seen = new Set<string>()
  for (const failure of failures) {
    const model = failure.model.split('/').pop() ?? failure.model
    const summarized = shortAttemptReason(failure.error)
    const key = `${model}|${summarized.short}`
    if (seen.has(key)) continue
    seen.add(key)
    notes.push({
      model,
      outcome: failure.error === 'no tool call' ? 'no tool call' : 'rejected',
      reason: summarized.short,
      detail: summarized.detail,
    })
  }
  return notes
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return { value }
}
