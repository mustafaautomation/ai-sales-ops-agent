'use client'

import { CornerDownLeft, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NAV_GROUPS } from './nav'

const EXTRA = [
  { label: 'Send a test inquiry', href: '/inquire', hint: 'Public form' },
  { label: 'Call the sales line', href: '/call', hint: 'Public page' },
]

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const all = [
      ...NAV_GROUPS.flatMap((group) => group.links.map((link) => ({ label: link.label, href: link.href, hint: group.title, icon: link.icon }))),
      ...EXTRA.map((item) => ({ ...item, icon: Search })),
    ]
    const needle = query.trim().toLowerCase()
    return needle ? all.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(needle)) : all
  }, [query])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    input.current?.focus()
  }, [open])

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <>
      <button type="button" className="cmdk-trigger" onClick={() => setOpen(true)} aria-label="Jump to a page">
        <Search aria-hidden="true" />
        <span>Jump to…</span>
        <kbd>⌘K</kbd>
      </button>
      {open ? (
        <div className="cmdk" role="dialog" aria-modal="true" aria-label="Jump to a page">
          <div className="cmdk-backdrop" onClick={() => setOpen(false)} />
          <div className="cmdk-panel">
            <input
              ref={input}
              value={query}
              placeholder="Jump to a page…"
              aria-label="Search pages"
              onChange={(event) => {
                setQuery(event.target.value)
                setCursor(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setCursor((value) => Math.min(items.length - 1, value + 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCursor((value) => Math.max(0, value - 1))
                } else if (event.key === 'Enter' && items[cursor]) {
                  event.preventDefault()
                  go(items[cursor].href)
                }
              }}
            />
            {items.length === 0 ? (
              <p className="cmdk-empty">No page matches “{query}”.</p>
            ) : (
              <ul className="cmdk-list" role="listbox">
                {items.map((item, index) => {
                  const Icon = item.icon
                  return (
                    <li key={item.href} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === cursor}
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => go(item.href)}
                      >
                        <Icon aria-hidden="true" />
                        {item.label}
                        <small>{index === cursor ? <CornerDownLeft aria-hidden="true" style={{ width: 13, height: 13 }} /> : item.hint}</small>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
