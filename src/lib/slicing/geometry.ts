import type { Blocker, Rect } from './types'

export interface Interval {
  start: number
  end: number
}

/** Merge intervals that overlap or are separated by less than `joinGap`. Returns sorted. */
export function mergeIntervals(intervals: Interval[], joinGap = 0): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv.start - last.end < joinGap) last.end = Math.max(last.end, iv.end)
    else if (last && iv.start < last.end) last.end = Math.max(last.end, iv.end)
    else out.push({ ...iv })
  }
  return out
}

/** Does the horizontal line `y` pass strictly through the rect? */
export function crossesY(r: Rect, y: number): boolean {
  return r.y < y && r.y + r.height > y
}

/** Does the vertical line `x` (within [top,bottom)) pass strictly through the rect? */
export function crossesX(r: Rect, x: number, top: number, bottom: number): boolean {
  return r.x < x && r.x + r.width > x && r.y < bottom && r.y + r.height > top
}

export function overlapsBand(r: Rect, top: number, bottom: number): boolean {
  return r.y < bottom && r.y + r.height > top
}

export function clipRect(r: Rect, clip: Rect): Rect | null {
  const x0 = Math.max(r.x, clip.x)
  const y0 = Math.max(r.y, clip.y)
  const x1 = Math.min(r.x + r.width, clip.x + clip.width)
  const y1 = Math.min(r.y + r.height, clip.y + clip.height)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export const HARD_KINDS = new Set<Blocker['kind']>(['text', 'component'])

export function snap(value: number, lo: number, hi: number, even: boolean): number {
  let v = Math.round(value)
  if (even) {
    const e = 2 * Math.round(value / 2)
    if (e >= lo && e <= hi) v = e
  }
  return Math.min(hi, Math.max(lo, v))
}
