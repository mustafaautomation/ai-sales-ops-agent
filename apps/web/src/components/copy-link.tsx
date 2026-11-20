'use client'

import { useState } from 'react'

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="copy-link">
      <span>Call link</span>
      <button
        className="btn small"
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}
