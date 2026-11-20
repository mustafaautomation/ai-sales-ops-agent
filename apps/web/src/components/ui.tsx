import type { ReactNode } from 'react'
import { pretty } from '../lib/format'

export function Pill({ value }: { value: string | null | undefined }) {
  const label = value || 'unknown'
  return <span className={`pill ${label.replace(/[^a-z_]/g, '')}`}>{label.replaceAll('_', ' ')}</span>
}

export function JsonBlock({ value }: { value: string | null }) {
  if (!value) return null
  return <pre className="json">{pretty(value)}</pre>
}

export function Notice({ children, tone = 'ok' }: { children: ReactNode; tone?: 'ok' | 'warn' }) {
  return <p className={tone === 'warn' ? 'notice warn' : 'notice'}>{children}</p>
}
