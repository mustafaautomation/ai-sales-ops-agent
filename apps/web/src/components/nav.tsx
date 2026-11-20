'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useState } from 'react'

const LINKS = [
  ['Overview', '/overview'],
  ['Inbox', '/inbox'],
  ['Approvals', '/approvals'],
  ['Runs', '/runs'],
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
      </div>

      <div className="nav-mobile">
        <div className="nav-mobile-bar" aria-label="Desk navigation">
          <div className="nav-scroll fade-edges">
            {LINKS.slice(0, 5).map(([label, href]) => {
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
                    <span className="count" aria-label={`${pending} pending`}>{pending}</span>
                  ) : null}
                </Link>
              )
            })}
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
                {LINKS.map(([label, href]) => {
                  const active = pathname === href || (href !== '/overview' && pathname.startsWith(href))
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={active ? 'active' : undefined}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <span>{label}</span>
                      {href === '/approvals' && pending > 0 ? (
                        <span className="count" aria-label={`${pending} pending`}>{pending}</span>
                      ) : null}
                    </Link>
                  )
                })}
              </nav>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
