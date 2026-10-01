import { findRowCandidates } from '@/lib/slicing/auto'
import { mergeIntervals, overlapsBand } from '@/lib/slicing/geometry'
import type { AutoSliceOptions, LayoutAnalysis } from '@/lib/slicing'

/** Y positions that are safe to cut at (used for magnetic snapping while dragging). */
export function safeRowTargets(analysis: LayoutAnalysis | null, opts: AutoSliceOptions): number[] {
  if (!analysis) return []
  const cands = findRowCandidates(analysis, { ...opts, minGap: 0 })
    .filter((c) => c.safe && c.bonus > 0.15)
    .map((c) => c.y)
  // Blocker edges are also good targets (cut flush against an element).
  const edges = analysis.blockers.flatMap((b) => [b.y, b.y + b.height])
  return [...new Set([...cands, ...edges, ...analysis.edges])].sort((a, b) => a - b)
}

/** X positions that are safe for a vertical cut inside [top,bottom). */
export function safeColTargets(analysis: LayoutAnalysis | null, top: number, bottom: number): number[] {
  if (!analysis) return []
  const inRow = analysis.blockers.filter((b) => overlapsBand(b, top, bottom))
  const clusters = mergeIntervals(inRow.map((b) => ({ start: b.x, end: b.x + b.width })))
  const out: number[] = []
  for (let i = 0; i < clusters.length - 1; i++) {
    out.push(clusters[i].end, Math.round((clusters[i].end + clusters[i + 1].start) / 2), clusters[i + 1].start)
  }
  return out
}

export function snapTo(value: number, targets: number[], threshold: number): number {
  let best = value
  let dist = threshold
  for (const t of targets) {
    const d = Math.abs(t - value)
    if (d <= dist) {
      dist = d
      best = t
    }
  }
  return best
}
