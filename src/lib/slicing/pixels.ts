import type { Blocker, LayoutAnalysis, Section } from './types'

export interface PixelImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface PixelOptions {
  /** Max per-channel difference for two pixels to count as "the same colour". */
  tolerance: number
  /** Fraction of a row's pixels allowed to deviate (anti-aliasing, noise). */
  outlierRatio: number
  /** Horizontal gap (px) under which neighbouring content blobs are merged. */
  joinGap: number
}

const DEFAULTS: PixelOptions = { tolerance: 10, outlierRatio: 0.002, joinGap: 6 }

/**
 * Layout analysis for flat images (no layer data): finds solid-colour rows (safe cut zones),
 * content blobs between them, and colour-band changes (preferred cuts).
 */
export function analyzePixels(img: PixelImage, options: Partial<PixelOptions> = {}): LayoutAnalysis {
  const { tolerance, outlierRatio, joinGap } = { ...DEFAULTS, ...options }
  const { data, width, height } = img
  const maxOutliers = Math.max(1, Math.floor(width * outlierRatio))

  const same = (i: number, j: number) =>
    Math.abs(data[i] - data[j]) <= tolerance &&
    Math.abs(data[i + 1] - data[j + 1]) <= tolerance &&
    Math.abs(data[i + 2] - data[j + 2]) <= tolerance &&
    Math.abs(data[i + 3] - data[j + 3]) <= tolerance

  // 1. Quiet rows: (almost) every pixel matches the row's reference colour.
  const quiet = new Uint8Array(height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4
    // reference = most common of left edge, centre and right edge pixels
    const refs = [rowStart, rowStart + (width >> 1) * 4, rowStart + (width - 1) * 4]
    const ref = same(refs[0], refs[1]) || same(refs[0], refs[2]) ? refs[0] : refs[1]
    let outliers = 0
    for (let x = 0; x < width; x++) {
      if (!same(rowStart + x * 4, ref) && ++outliers > maxOutliers) break
    }
    quiet[y] = outliers <= maxOutliers ? 1 : 0
  }

  // 2. Content runs and the blobs inside them.
  const blockers: Blocker[] = []
  let y = 0
  while (y < height) {
    if (quiet[y]) {
      y++
      continue
    }
    const y0 = y
    while (y < height && !quiet[y]) y++
    const y1 = y
    // A column is quiet within the run if all its pixels match the run's top pixel in that column.
    const busy: boolean[] = new Array(width)
    for (let x = 0; x < width; x++) {
      const ref = (y0 * width + x) * 4
      let b = false
      for (let yy = y0 + 1; yy < y1; yy++) {
        if (!same((yy * width + x) * 4, ref)) {
          b = true
          break
        }
      }
      busy[x] = b
    }
    // If no column varies vertically (e.g. a single-row-tall run), the whole run is content.
    if (!busy.some(Boolean)) {
      blockers.push({ x: 0, y: y0, width, height: y1 - y0, kind: 'content', name: `content @${y0}` })
      continue
    }
    let x = 0
    let current: { start: number; end: number } | null = null
    const flush = () => {
      if (current)
        blockers.push({
          x: current.start,
          y: y0,
          width: current.end - current.start,
          height: y1 - y0,
          kind: 'content',
          name: `content @${y0}`,
        })
      current = null
    }
    for (; x < width; x++) {
      if (!busy[x]) continue
      if (current && x - current.end < joinGap) current.end = x + 1
      else {
        flush()
        current = { start: x, end: x + 1 }
      }
    }
    flush()
  }

  // 3. Colour-band changes between consecutive quiet rows → preferred edges / sections.
  const edges: number[] = []
  for (let yy = 1; yy < height; yy++) {
    if (quiet[yy] && quiet[yy - 1] && !same((yy * width) * 4, ((yy - 1) * width) * 4)) edges.push(yy)
  }
  const sections: Section[] = []
  let top = 0
  for (const e of [...edges, height]) {
    if (e - top > 0) sections.push({ top, bottom: e, name: `section ${sections.length + 1}` })
    top = e
  }

  return { source: 'pixels', width, height, blockers, sections: edges.length ? sections : [], edges }
}
