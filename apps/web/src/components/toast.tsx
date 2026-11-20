'use client'

import * as Toast from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastItem = { id: string; title: string; description?: string }

type ToastContextValue = {
  toast: (input: { title: string; description?: string }) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((input: { title: string; description?: string }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setItems((current) => [...current, { id, ...input }])
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      <Toast.Provider swipeDirection="right" duration={4000}>
        {children}
        {items.map((item) => (
          <Toast.Root key={item.id} className="toast-root" onOpenChange={(open) => !open && setItems((c) => c.filter((x) => x.id !== item.id))}>
            <Toast.Title>{item.title}</Toast.Title>
            {item.description ? <Toast.Description className="muted">{item.description}</Toast.Description> : null}
          </Toast.Root>
        ))}
        <Toast.Viewport className="toast-viewport" />
      </Toast.Provider>
    </ToastContext.Provider>
  )
}