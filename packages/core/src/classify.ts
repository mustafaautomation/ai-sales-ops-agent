import { detectInjection, stripInjection } from './guardrails'
import { pickQuote } from './picker'

export const INTENTS = ['quote', 'product_question', 'support', 'spam', 'out_of_scope'] as const
export type Intent = (typeof INTENTS)[number]

const OUT_OF_SCOPE = [
  /\basbestos\b/i,
  /\bmold remediation\b/i,
  /\bbiohazard\b/i,
  /\bmedical waste\b/i,
  /\bresidential\b/i,
  /\bmy house\b/i,
  /\bmy home\b/i,
  /\blegal advice\b/i,
  /\blawsuit\b/i,
  /\battorney\b/i,
  /\bsue a\b/i,
  /\bimmigration\b/i,
  /\bwrite (me )?(some )?code\b/i,
  /\bpersonal loan\b/i,
]

const SPAM = [
  /\bseo services\b/i,
  /\bguest posts?\b/i,
  /\bcrypto\b/i,
  /\bairdrop\b/i,
  /\bviagra\b/i,
  /\blottery\b/i,
  /\bwire transfer\b/i,
  /\bunclaimed funds\b/i,
  /\bconnect your wallet\b/i,
]

const QUOTE = [
  /\bquotes?\b/i,
  /\bpricing\b/i,
  /\bproposal\b/i,
  /\bhow much\b/i,
  /\bcost\b/i,
  /\bbid\b/i,
  /\brate card\b/i,
]

const SUPPORT = [
  /\binvoices?\b/i,
  /\bbilling\b/i,
  /\breschedul/i,
  /\bcomplaints?\b/i,
  /\bdidn.?t show\b/i,
  /\bdid not show\b/i,
  /\bno-show\b/i,
  /\baccount number\b/i,
]

const QUESTION = [
  /\bdo you\b/i,
  /\bwhat (services|are|is|don|green)\b/i,
  /\bservice area\b/i,
  /\bgreen cleaning\b/i,
  /\beco-friendly\b/i,
  /\bhours\b/i,
  /\bsla\b/i,
  /\bcontract term\b/i,
  /\bchemicals\b/i,
]

export type Classification = {
  intent: Intent
  injection: boolean
  stripped: string
  signals: string[]
}

export function classifyText(raw: string): Classification {
  const injection = detectInjection(raw)
  const stripped = stripInjection(raw)
  const signals: string[] = []
  if (injection) signals.push('injection')
  const letters = (stripped.match(/[a-z]/gi) ?? []).length
  if (letters < 12) {
    return { intent: 'spam', injection, stripped, signals: [...signals, 'too_short'] }
  }
  if (OUT_OF_SCOPE.some((pattern) => pattern.test(stripped))) {
    return { intent: 'out_of_scope', injection, stripped, signals: [...signals, 'out_of_scope'] }
  }
  if (SPAM.some((pattern) => pattern.test(stripped))) {
    return { intent: 'spam', injection, stripped, signals: [...signals, 'spam'] }
  }
  if (QUOTE.some((pattern) => pattern.test(stripped))) {
    return { intent: 'quote', injection, stripped, signals: [...signals, 'quote'] }
  }
  if (SUPPORT.some((pattern) => pattern.test(stripped))) {
    return { intent: 'support', injection, stripped, signals: [...signals, 'support'] }
  }
  if (QUOTE.some((pattern) => pattern.test(stripped)) || pickQuote(stripped).lines.length > 0) {
    return { intent: 'quote', injection, stripped, signals: [...signals, 'quote'] }
  }
  if (QUESTION.some((pattern) => pattern.test(stripped)) || stripped.includes('?')) {
    return { intent: 'product_question', injection, stripped, signals: [...signals, 'question'] }
  }
  return { intent: 'product_question', injection, stripped, signals: [...signals, 'default'] }
}
