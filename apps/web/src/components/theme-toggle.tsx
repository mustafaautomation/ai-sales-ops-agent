'use client'

import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  return (
    <button
      className="btn small icon-btn"
      type="button"
      aria-label="Theme"
      title="Switch between light and dark"
      onClick={() => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
        document.documentElement.dataset.theme = next
        localStorage.setItem('theme', next)
      }}
    >
      <Moon className="moon" aria-hidden="true" />
      <Sun className="sun" aria-hidden="true" />
    </button>
  )
}
