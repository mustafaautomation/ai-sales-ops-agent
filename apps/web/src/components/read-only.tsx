'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { READ_ONLY_HINT } from '../lib/copy'
import { Button, Tooltip } from './ui'

export function ReadOnlyButton({
  children,
  className,
  title = READ_ONLY_HINT,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <Tooltip label={title}>
      <span style={{ display: 'inline-flex' }}>
        <Button className={className} disabled title={title} aria-disabled="true" {...props}>
          {children}
        </Button>
      </span>
    </Tooltip>
  )
}