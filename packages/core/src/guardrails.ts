const INJECTION_LINE = [
  /ignore (all|any|previous|prior) (instructions|rules|prompts)/i,
  /you are now/i,
  /system prompt/i,
  /approval gate/i,
  /^\s*system\s*:/i,
  /attacker@/i,
  /100%\s*discount/i,
  /do not tell/i,
  /exfiltrate/i,
  /<!--/,
  /new instructions/i,
  /\bbypass\b/i,
  /disregard (the|your|all)/i,
  /\bjailbreak\b/i,
  /reveal (the )?(system|prompt|secret|database)/i,
  /skip (the )?approval/i,
]

export function detectInjection(text: string): boolean {
  if (/<!--[\s\S]*?-->/.test(text)) return true
  return text.split(/\n/).some((line) => INJECTION_LINE.some((pattern) => pattern.test(line)))
}

function cutInjection(line: string): string {
  let earliest = -1
  for (const pattern of INJECTION_LINE) {
    const match = line.match(pattern)
    if (match?.index == null) continue
    if (earliest === -1 || match.index < earliest) earliest = match.index
  }
  if (earliest < 0) return line
  if (earliest === 0) return ''
  return line.slice(0, earliest).trim()
}

/** Drop instructions aimed at the agent. Text before an injected phrase on the same line is kept. */
export function stripInjection(text: string): string {
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '')
  return withoutComments
    .split(/\n/)
    .map((line) => cutInjection(line))
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim()
}

/**
 * Wrap inbound text so a model is told, in structure, that the span is data.
 * Angle brackets are escaped so the sender cannot close the wrapper early.
 */
export function wrapUntrusted(text: string, source: string): string {
  const safeSource = source.replace(/[^a-z0-9_-]/gi, '') || 'inbound'
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<untrusted_content source="${safeSource}">\n${escaped}\n</untrusted_content>`
}

export class GuardrailError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'GuardrailError'
    this.code = code
  }
}
