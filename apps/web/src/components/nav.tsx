'use client'

import {
  BookOpen,
  Bot,
  FileText,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Phone,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { logout } from '../app/(public)/actions'

type NavLink = { label: string; href: string; icon: LucideIcon }

export const NAV_GROUPS: { title: string; links: NavLink[] }[] = [
  {
    title: 'Desk',
    links: [
      { label: 'Overview', href: '/overview', icon: LayoutDashboard },
      { label: 'Inbox', href: '/inbox', icon: Inbox },
      { label: 'Approvals', href: '/approvals', icon: ShieldCheck },
      { label: 'Runs', href: '/runs', icon: Bot },
      { label: 'Calls', href: '/calls', icon: Phone },
    ],
  },
  {
    title: 'Records',
    links: [
      { label: 'Quotes', href: '/quotes', icon: FileText },
      { label: 'CRM', href: '/crm', icon: Users },
      { label: 'Knowledge', href: '/kb', icon: BookOpen },
    ],
  },
  {
    title: 'System',
    links: [
      { label: 'Audit', href: '/audit', icon: ScrollText },
      { label: 'Outbox', href: '/outbox', icon: Send },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
]

const LINKS = NAV_GROUPS.flatMap((group) => group.links)

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/overview' && pathname.startsWith(href))
}

function Item({ link, pathname, pending, onClick }: { link: NavLink; pathname: string; pending: number; onClick?: () => void }) {
  const active = isActive(pathname, link.href)
  const Icon = link.icon
  return (
    <Link href={link.href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon className="nav-ico" aria-hidden="true" />
      <span>{link.label}</span>
      {link.href === '/approvals' && pending > 0 ? (
        <span className="count" aria-label={`${pending} pending`}>
          {pending}
        </span>
      ) : null}
    </Link>
  )
}

export function Nav({ pending }: { pending: number }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const panelId = useId()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div className="nav-desktop">
        <nav className="nav" aria-label="Desk navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} role="group" aria-label={group.title} style={{ display: 'contents' }}>
              <div className="nav-group" aria-hidden="true">{group.title}</div>
              {group.links.map((link) => (
                <Item key={link.href} link={link} pathname={pathname} pending={pending} />
              ))}
            </div>
          ))}
        </nav>
      </div>

      <div className="nav-mobile">
        <div className="nav-mobile-bar" aria-label="Desk navigation">
          <div className="nav-scroll fade-edges">
            {LINKS.slice(0, 5).map((link) => (
              <Item key={link.href} link={link} pathname={pathname} pending={pending} />
            ))}
          </div>
          <button
            type="button"
            className="btn small nav-menu-btn"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            Menu
          </button>
        </div>
        {open ? (
          <div className="nav-sheet" role="dialog" aria-modal="true" aria-label="All desk pages" id={panelId}>
            <div className="nav-sheet-backdrop" onClick={() => setOpen(false)} />
            <div className="nav-sheet-panel">
              <div className="nav-sheet-head">
                <strong>Menu</strong>
                <button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button>
              </div>
              <nav className="nav-sheet-links">
                {LINKS.map((link) => (
                  <Item key={link.href} link={link} pathname={pathname} pending={pending} onClick={() => setOpen(false)} />
                ))}
              </nav>
              <form className="nav-sheet-signout" action={logout}>
                <button className="btn small" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
