'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  ['Overview', '/overview'],
  ['Inbox', '/inbox'],
  ['Approvals', '/approvals'],
  ['Calls', '/calls'],
  ['Quotes', '/quotes'],
  ['CRM', '/crm'],
  ['Knowledge', '/kb'],
  ['Audit', '/audit'],
  ['Outbox', '/outbox'],
  ['Settings', '/settings'],
] as const

export function Nav({ pending }: { pending: number }) {
  const pathname = usePathname()
  return (
    <nav className="nav" aria-label="Desk navigation">
      {LINKS.map(([label, href]) => {
        const active = pathname === href || (href !== '/overview' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            <span>{label}</span>
            {href === '/approvals' && pending > 0 ? (
              <span className="count" aria-label={`${pending} pending`}>
                {pending}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}