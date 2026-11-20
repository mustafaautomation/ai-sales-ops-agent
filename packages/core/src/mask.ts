/** Browser-safe masking helpers — no Node built-ins or DB imports. */

/** Mask the token query value for desk previews. The sent email keeps the real link. */
export function maskUnsubscribeUrl(url: string): string {
  return url.replace(/([?&]token=)[^&\s#]+/i, '$1•••')
}

/** Mask unsubscribe tokens inside approval JSON shown in the UI. */
export function maskPayloadSecrets(raw: string): string {
  return raw.replace(/([?&]token=)[^"&\s\\]+/gi, '$1•••')
}

/** Restore masked tokens in an edited payload from the original proposed JSON. */
export function restorePayloadSecrets(edited: string, original: string): string {
  if (!edited.includes('token=•••')) return edited
  const originals = [...original.matchAll(/([?&]token=)([^"&\s\\]+)/gi)].map((match) => match[0])
  let index = 0
  return edited.replace(/([?&]token=)•••/gi, () => originals[index++] ?? '$1•••')
}

export function maskEmail(email: string): string {
  const [name, host] = email.split('@')
  if (!host) return '•••'
  const head = name.slice(0, 1)
  return `${head}•••@${host}`
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '•••'
  return `+${digits.slice(0, 2)} ••• ${digits.slice(-4)}`
}
