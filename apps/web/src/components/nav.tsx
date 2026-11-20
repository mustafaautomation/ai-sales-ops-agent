'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  ['Overview', '/'],
  ['Inbox', '/inbox'],
  ['Approvals', '/approvals'],
  ['Calls', '/calls'],
  ['Quotes', '/quotes'],
  ['CRM', '/crm'],
  ['Knowledge', '/kb'],
  ['Audit', '/audit'],
  ['Settings', '/settings'],
]

export function Nav({ pending }: { pending: number }) {
  const pathname = usePathname()
  return (
    <nav className="nav" aria-label="Desk">
      {LINKS.map(([label, href]) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link key={href} href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
            <span>{label}</span>
            {href === '/approvals' && pending > 0 ? <span className="count">{pending}</span> : null}
          </Link>
        )
      })}
    </nav>
  )
}
