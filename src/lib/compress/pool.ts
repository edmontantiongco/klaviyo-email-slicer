import type { CompressOptions, CompressResponse, CompressSuccess } from './types'

interface Job {
  id: number
  width: number
  height: number
  pixels: ArrayBuffer
  options: CompressOptions
  resolve: (r: CompressSuccess) => void
  reject: (e: Error) => void
}

/** Small worker pool so several slices compress in parallel without freezing the UI. */
class CompressPool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: Job[] = []
  private running = new Map<Worker, Job>()
  private nextId = 1

  private get size() {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2
    return Math.max(1, Math.min(4, cores - 1))
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<CompressResponse>) => {
      const job = this.running.get(w)
      this.running.delete(w)
      this.idle.push(w)
      if (job) {
        if (e.data.ok) job.resolve(e.data)
        else job.reject(new Error(e.data.error))
      }
      this.pump()
    }
    w.onerror = (e) => {
      const job = this.running.get(w)
      this.running.delete(w)
      this.workers = this.workers.filter((x) => x !== w)
      w.terminate()
      job?.reject(new Error(e.message || 'Compression worker crashed'))
      this.pump()
    }
    this.workers.push(w)
    return w
  }

  private pump() {
    while (this.queue.length) {
      let w = this.idle.pop()
      if (!w && this.workers.length < this.size) w = this.spawn()
      if (!w) return
      const job = this.queue.shift()!
      this.running.set(w, job)
      w.postMessage(
        { id: job.id, width: job.width, height: job.height, pixels: job.pixels, options: job.options },
        [job.pixels],
      )
    }
  }

  compress(image: ImageData, options: CompressOptions): Promise<CompressSuccess> {
    return new Promise((resolve, reject) => {
      // copy so the caller's ImageData stays usable after transfer
      const pixels = image.data.buffer.slice(image.data.byteOffset, image.data.byteOffset + image.data.byteLength) as ArrayBuffer
      this.queue.push({ id: this.nextId++, width: image.width, height: image.height, pixels, options, resolve, reject })
      this.pump()
    })
  }

  /** Drop queued (not yet started) jobs. */
  clearQueue() {
    const dropped = this.queue.splice(0)
    dropped.forEach((j) => j.reject(new Error('cancelled')))
  }
}

export const compressPool = new CompressPool()
