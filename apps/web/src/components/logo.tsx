/** Meridian mark: a globe-style meridian arc crossing a horizon line. */
export function LogoMark({ className = 'mark' }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5c3.2 2.6 3.2 14.4 0 17" />
        <path d="M12 3.5c-3.2 2.6-3.2 14.4 0 17" opacity="0.55" />
        <path d="M3.5 12h17" opacity="0.55" />
      </svg>
    </span>
  )
}
