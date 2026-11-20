/** Reject operator mutations when the web app is in a read-only demo session. */
export function rejectDemoWrite(request: Request): Response | null {
  if (request.headers.get('x-meridian-mode') === 'demo') {
    return Response.json({ error: 'Read-only demo: sign in as operator to act' }, { status: 403 })
  }
  return null
}

export function seedOnly(request: Request): boolean {
  return request.headers.get('x-meridian-mode') === 'demo' || request.headers.get('x-meridian-seed-only') === '1'
}

export function isSeedId(value: unknown): boolean {
  return typeof value === 'string' && value.includes('_seed_')
}

export function filterSeedRows<T extends Record<string, unknown>>(rows: T[], keys: string[] = ['id']): T[] {
  return rows.filter((row) => keys.some((key) => isSeedId(row[key])))
}
