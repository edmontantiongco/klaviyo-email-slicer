/**
 * Promise-based rate limiter that enforces both a per-second spacing and a
 * sliding per-minute window. Used to stay under Klaviyo's image-upload limits
 * (burst 3/s, steady 100/m).
 */
export function createLimiter({ perSecond, perMinute }: { perSecond: number; perMinute: number }) {
  const minSpacing = Math.ceil(1000 / perSecond)
  const history: number[] = []
  let chain: Promise<unknown> = Promise.resolve()
  let last = 0

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function waitTurn() {
    for (;;) {
      const now = Date.now()
      while (history.length && now - history[0] > 60_000) history.shift()
      const spacingWait = Math.max(0, last + minSpacing - now)
      const windowWait = history.length >= perMinute ? 60_000 - (now - history[0]) + 10 : 0
      const wait = Math.max(spacingWait, windowWait)
      if (wait <= 0) break
      await sleep(wait)
    }
    last = Date.now()
    history.push(last)
  }

  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(waitTurn).then(task)
    // keep the chain alive even if a task fails
    chain = run.catch(() => undefined)
    return run
  }
}
