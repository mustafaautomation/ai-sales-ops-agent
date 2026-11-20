'use client'

import { toolLabel as coreToolLabel } from '@meridian/core/labels'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'
import { pretty } from '../lib/format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export { coreToolLabel as toolLabel }

const buttonVariants = cva('btn', {
  variants: {
    variant: {
      default: '',
      primary: 'primary',
      ghost: 'ghost',
      danger: 'danger',
    },
    size: {
      default: '',
      sm: 'small',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

const PILL_LABELS: Record<string, string> = {
  quote: 'Quote request',
  product_question: 'Product question',
  support: 'Support request',
  spam: 'Spam',
  out_of_scope: 'Out of scope',
  new: 'New',
  processing: 'Processing',
  awaiting_approval: 'Awaiting approval',
  resolved: 'Resolved',
  archived: 'Archived',
  archived_spam: 'Archived spam',
  pending: 'Pending',
  executed: 'Executed',
  rejected: 'Rejected',
  completed: 'Completed',
  failed: 'Failed',
  running: 'Running',
  draft: 'Draft',
  sent: 'Sent',
  pending_send: 'Pending send',
  proposal: 'Proposal',
  lead: 'Lead',
  qualified: 'Qualified',
  won: 'Won',
  lost: 'Lost',
  ok: 'Ok',
  void: 'Void',
}

function pillLabel(value: string): string {
  if (PILL_LABELS[value]) return PILL_LABELS[value]
  const words = value.replaceAll('_', ' ').trim()
  if (!words) return 'Unknown'
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

export function Pill({ value, className }: { value: string | null | undefined; className?: string }) {
  const label = value || 'unknown'
  const token = label.replace(/[^a-z_]/g, '')
  return <span className={cn('pill', token, className)}>{pillLabel(label)}</span>
}

export function Badge({ value, className }: { value: string | null | undefined; className?: string }) {
  return <Pill value={value} className={cn('badge', className)} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <section className="empty-state" aria-live="polite">
      <h2>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
      {action ? <div className="row-actions" style={{ justifyContent: 'center', marginTop: 12 }}>{action}</div> : null}
    </section>
  )
}

export function ErrorState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <section className="error-state" role="alert">
      <h2>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
      {action ? <div className="row-actions" style={{ justifyContent: 'center', marginTop: 12 }}>{action}</div> : null}
    </section>
  )
}

export type Breadcrumb = { label: string; href?: string }

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  kicker,
}: {
  title: string
  description?: string
  breadcrumbs?: Breadcrumb[]
  actions?: ReactNode
  kicker?: string
}) {
  return (
  <header className="page-head">
    <div>
      {breadcrumbs?.length ? (
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((crumb) => (
              <li key={crumb.label}>
                {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {kicker ? <p className="kicker">{kicker}</p> : null}
      <h1>{title}</h1>
      {description ? <p className="lede">{description}</p> : null}
    </div>
    {actions ? <div className="row-actions">{actions}</div> : null}
  </header>
  )
}

export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side={side} sideOffset={6}>
            {label}
            <TooltipPrimitive.Arrow width={8} height={4} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

/** `value` must already be masked when it may contain unsubscribe tokens. */
export function JsonBlock({ value, label = 'Payload' }: { value: string | null; label?: string }) {
  if (!value) return null
  return (
    <details className="payload">
      <summary>{label}</summary>
      <pre className="json">{pretty(value)}</pre>
    </details>
  )
}

export function Notice({ children, tone = 'ok' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'error' }) {
  return <p className={tone === 'warn' ? 'notice warn' : tone === 'error' ? 'notice error' : 'notice'}>{children}</p>
}