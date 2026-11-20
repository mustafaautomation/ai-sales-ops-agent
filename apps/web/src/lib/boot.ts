import { bootDesk } from '@meridian/core'

let booted: Promise<void> | null = null

export function ensureBoot(): Promise<void> {
  if (!booted) {
    booted = bootDesk()
      .then(() => undefined)
      .catch((error) => {
        booted = null
        throw error
      })
  }
  return booted
}
