export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type RetryOptions = {
  fetch?: FetchLike
  sleep?: (ms: number) => Promise<void>
  attempts?: number
  baseDelayMs?: number
  timeoutMs?: number
  jitter?: boolean
}

function retryDelay(response: Response, attempt: number, baseDelayMs: number, jitter: boolean): number {
  const header = response.headers.get('retry-after')
  const seconds = header != null ? Number(header) : NaN
  const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : baseDelayMs * 2 ** (attempt - 1)
  if (!jitter) return wait
  return wait + Math.floor(Math.random() * 50)
}

/**
 * Retry timeouts, network errors, 429, and 5xx.
 * A 429 waits for Retry-After when the header is a delay in seconds.
 * Other 4xx responses are returned immediately.
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  const fetchImpl = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const attempts = options.attempts ?? 4
  const baseDelayMs = options.baseDelayMs ?? 200
  const timeoutMs = options.timeoutMs ?? 4_000
  const jitter = options.jitter ?? false
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal })
      clearTimeout(timer)
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === attempts) return response
      await sleep(retryDelay(response, attempt, baseDelayMs, jitter))
      continue
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt === attempts) break
      await sleep(baseDelayMs * 2 ** (attempt - 1))
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error('Request failed')
}
