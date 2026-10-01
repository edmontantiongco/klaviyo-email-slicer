export class HttpError extends Error {
  status: number
  details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** fetch with automatic retry on 429 / 5xx, honouring Retry-After. */
export async function fetchWithRetry(url: string, init: RequestInit = {}, retries = 4): Promise<Response> {
  let attempt = 0
  for (;;) {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      if (attempt >= retries) throw new HttpError(502, `Network error calling ${new URL(url).host}: ${(err as Error).message}`)
      await sleep(500 * 2 ** attempt)
      attempt++
      continue
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt
      await sleep(Math.min(wait, 30_000))
      attempt++
      continue
    }
    return res
  }
}
