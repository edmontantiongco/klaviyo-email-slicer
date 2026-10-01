import { HARD_KINDS, crossesY, mergeIntervals, overlapsBand, snap } from './geometry'
import type { AutoSliceOptions, Blocker, LayoutAnalysis, Row, SliceLayout } from './types'
import { makeCell, newId } from './layout'

interface Candidate {
  y: number
  /** Higher is better. Negative means "cut is through content". */
  bonus: number
  safe: boolean
}

/**
 * Candidate horizontal cut lines.
 * - every whitespace zone between blockers (and every point where blockers merely touch)
 * - preferred edges (section boundaries / colour changes) that are safe
 * - "forced" lines every few px, priced by what they would cut through, so the optimiser
 *   can still honour maxHeight inside a tall photo when it must.
 */
export function findRowCandidates(analysis: LayoutAnalysis, opts: AutoSliceOptions): Candidate[] {
  const { height, blockers, edges } = analysis
  const merged = mergeIntervals(blockers.map((b) => ({ start: b.y, end: b.y + b.height })))
  const byY = new Map<number, Candidate>()
  const put = (c: Candidate) => {
    const prev = byY.get(c.y)
    if (!prev || prev.bonus < c.bonus) byY.set(c.y, c)
  }

  // Safe zones between merged blocker intervals.
  const zones: { a: number; b: number }[] = []
  let cursor = 0
  for (const iv of merged) {
    if (iv.start >= cursor) zones.push({ a: cursor, b: iv.start })
    cursor = Math.max(cursor, iv.end)
  }
  zones.push({ a: cursor, b: height })

  const scale = analysis.width / 1200
  for (const z of zones) {
    const a = Math.max(1, z.a)
    const b = Math.min(height - 1, z.b)
    if (b < a) continue
    const gap = z.b - z.a
    const edgeInZone = edges.filter((e) => e >= a && e <= b)
    let bonus = gap >= opts.minGap ? 0.3 + Math.min(1.5, gap / (100 * scale)) : 0.2
    // Zone touching the very top/bottom of the email is padding, not a separator.
    if (z.a <= 0 || z.b >= height) bonus = Math.min(bonus, 0.2)
    if (edgeInZone.length) {
      for (const e of edgeInZone) put({ y: snap(e, a, b, false), bonus: bonus + 2.5, safe: true })
    } else {
      put({ y: snap((a + b) / 2, a, b, opts.snapEven), bonus, safe: true })
    }
  }

  // Forced (unsafe) candidates.
  const step = Math.max(4, Math.round(20 * scale))
  for (let y = step; y < height; y += step) {
    if (byY.has(y)) continue
    let hard = false
    let soft = false
    for (const b of blockers) {
      if (!crossesY(b, y)) continue
      if (HARD_KINDS.has(b.kind)) {
        hard = true
        break
      }
      soft = true
    }
    if (!hard && !soft) put({ y, bonus: 0.1, safe: true })
    else put({ y, bonus: hard ? -30 : -6, safe: false })
  }

  return [...byY.values()].sort((p, q) => p.y - q.y)
}

function rowPenalty(h: number, opts: AutoSliceOptions): number {
  if (h > opts.maxHeight) return 5 + (20 * (h - opts.maxHeight)) / opts.maxHeight
  if (h < opts.minHeight) return 3 + (3 * (opts.minHeight - h)) / opts.minHeight
  return 0
}

/** Optimal set of horizontal cuts (dynamic programming over candidates). */
export function chooseRowCuts(analysis: LayoutAnalysis, opts: AutoSliceOptions): number[] {
  const cands = findRowCandidates(analysis, opts)
  const pos = [0, ...cands.map((c) => c.y), analysis.height]
  const cutCost = [0, ...cands.map((c) => opts.sliceCost - c.bonus), 0]
  const n = pos.length
  const best = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  best[0] = 0
  const window = opts.maxHeight * 4
  for (let j = 1; j < n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const h = pos[j] - pos[i]
      if (h > window && i < j - 1) break
      const cost = best[i] + rowPenalty(h, opts) + cutCost[j]
      if (cost < best[j]) {
        best[j] = cost
        prev[j] = i
      }
    }
  }
  const cuts: number[] = []
  for (let k = prev[n - 1]; k > 0; k = prev[k]) cuts.push(pos[k])
  return cuts.reverse()
}

/** Vertical cuts for a row, if its content looks like a grid of similar-width columns. */
export function detectColumns(
  analysis: LayoutAnalysis,
  top: number,
  bottom: number,
  opts: AutoSliceOptions,
): number[] {
  const { width } = analysis
  const inRow = analysis.blockers.filter((b) => overlapsBand(b, top, bottom))
  if (inRow.length < 2) return []
  if (inRow.some((b) => b.width >= width * 0.85)) return []

  const clusters = mergeIntervals(
    inRow.map((b) => ({ start: b.x, end: b.x + b.width })),
    opts.columnMinGap,
  )
  if (clusters.length < 2 || clusters.length > opts.maxColumns) return []

  const widths = clusters.map((c) => c.end - c.start)
  const minW = Math.min(...widths)
  const maxW = Math.max(...widths)
  if (minW / maxW < 0.55 && !inRow.some((b) => b.link)) return []
  if (minW < width * 0.05) return []

  const within = (b: Blocker, c: { start: number; end: number }) => b.x >= c.start - 1 && b.x + b.width <= c.end + 1
  // Every column must carry something visual (image/component/pixel content)…
  const allVisual = clusters.every((c) => inRow.some((b) => b.kind !== 'text' && within(b, c)))
  // …or a link of its own (e.g. a text navigation bar with one URL per item).
  const links = clusters.map((c) => inRow.find((b) => b.link && within(b, c))?.link)
  const distinctLinks = links.every(Boolean) && new Set(links).size === links.length
  if (!allVisual && !distinctLinks) return []

  // Grid cells should fill most of the row height, otherwise it's probably a heading + grid.
  const contentTop = Math.min(...inRow.map((b) => b.y))
  const contentBottom = Math.max(...inRow.map((b) => b.y + b.height))
  if (!distinctLinks && (contentBottom - contentTop) / (bottom - top) < 0.35) return []

  const cuts: number[] = []
  for (let i = 0; i < clusters.length - 1; i++) {
    const a = clusters[i].end
    const b = clusters[i + 1].start
    cuts.push(snap((a + b) / 2, a, b, opts.snapEven))
  }
  return cuts
}

function sectionNameFor(analysis: LayoutAnalysis, top: number, bottom: number): string | undefined {
  let best: { name: string; overlap: number } | undefined
  for (const s of analysis.sections) {
    const overlap = Math.min(bottom, s.bottom) - Math.max(top, s.top)
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { name: s.name, overlap }
  }
  return best?.name
}

/** Run the full auto-slicer and produce an editable layout. */
export function autoSlice(analysis: LayoutAnalysis, opts: AutoSliceOptions): SliceLayout {
  const cuts = chooseRowCuts(analysis, opts)
  const bottoms = [...cuts, analysis.height]
  const rows: Row[] = []
  let top = 0
  bottoms.forEach((bottom, i) => {
    const colCuts = opts.autoColumns ? detectColumns(analysis, top, bottom, opts) : []
    const base = sectionNameFor(analysis, top, bottom) ?? `slice ${i + 1}`
    const cells = Array.from({ length: colCuts.length + 1 }, (_, c) =>
      makeCell(colCuts.length ? `${base} ${c + 1}` : base),
    )
    rows.push({ id: newId(), bottom, colCuts, cells })
    top = bottom
  })
  return { width: analysis.width, height: analysis.height, rows }
}
