'use client'

export function ThemeToggle() {
  return (
    <button
      className="btn small"
      type="button"
      onClick={() => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
        document.documentElement.dataset.theme = next
        localStorage.setItem('theme', next)
      }}
    >
      Theme
    </button>
  )
}
