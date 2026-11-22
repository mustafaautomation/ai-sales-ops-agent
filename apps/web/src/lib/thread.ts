/**
 * Earlier and later inquiries from the same sender, so an operator reading a
 * follow-up can see what the desk already said. Matching is by company name,
 * or by address when the address is not masked.
 */
export type ThreadRow = {
  id: string
  fromEmail?: string | null
  companyName?: string | null
  subject: string
  status: string
  intent?: string | null
  createdAt: number
}

function key(value: string | null | undefined): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim()
}

function usableEmail(value: string | null | undefined): string {
  const email = key(value)
  return email.includes('@') && !email.includes('[') && !/\*|•|…/.test(String(value)) ? email : ''
}

export function relatedInquiries<T extends ThreadRow>(current: ThreadRow, all: T[]): T[] {
  const company = key(current.companyName)
  const email = usableEmail(current.fromEmail)
  if (!company && !email) return []
  return all
    .filter((row) => row.id !== current.id)
    .filter((row) => (company && key(row.companyName) === company) || (email && usableEmail(row.fromEmail) === email))
    .sort((a, b) => b.createdAt - a.createdAt)
}
