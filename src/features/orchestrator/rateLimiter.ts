// Module-singleton limiter governing ALL Orchestrator OData traffic tenant-wide.
// Two independent constraints: a concurrency cap (max in-flight requests) and a
// token-bucket pacer (max requests/sec). Every fetchOData call routes through this,
// so simultaneous data hooks (schedules + jobs + machines) cannot collectively
// exceed the cap the way independent per-caller batchers could.

const MAX_CONCURRENCY = 6
const REQUESTS_PER_SECOND = 4
const BUCKET_CAPACITY = REQUESTS_PER_SECOND

interface QueuedTask {
  run: () => void
}

let inFlight = 0
let tokens = BUCKET_CAPACITY
let lastRefill = Date.now()
const queue: QueuedTask[] = []

function refillTokens(): void {
  const now = Date.now()
  const elapsedSec = (now - lastRefill) / 1000
  if (elapsedSec <= 0) return
  tokens = Math.min(BUCKET_CAPACITY, tokens + elapsedSec * REQUESTS_PER_SECOND)
  lastRefill = now
}

function pump(): void {
  if (queue.length === 0) return
  if (inFlight >= MAX_CONCURRENCY) return

  refillTokens()
  if (tokens < 1) {
    // Not enough tokens yet — wake up when the next token is due.
    const msUntilToken = ((1 - tokens) / REQUESTS_PER_SECOND) * 1000
    setTimeout(pump, Math.max(msUntilToken, 16))
    return
  }

  tokens -= 1
  inFlight += 1
  const task = queue.shift()!
  task.run()
}

/**
 * Schedule a request. Resolves/rejects with the wrapped function's result once a
 * concurrency slot and a rate-limit token are both available.
 */
export function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      run: () => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            inFlight -= 1
            pump()
          })
      },
    })
    pump()
  })
}

// Test-only hook: reset internal state between unit tests.
export function __resetLimiterForTests(): void {
  inFlight = 0
  tokens = BUCKET_CAPACITY
  lastRefill = Date.now()
  queue.length = 0
}
