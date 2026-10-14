import type { FigmaNode } from './figma'
import type { CellMeta, Rect, Row, SliceLayout } from './types'

/**
 * Figma "Slice" layers (the Slice tool, e.g. "Slice 37") drawn on an email frame.
 * When a frame has them, they define the app's slices: same areas, same names,
 * and a stable id per Figma layer so a refresh recognises each slice again.
 */
export interface FigmaSlice extends Rect {
  /** Figma node id, e.g. "12:345". */
  nodeId: string
  name: string
}

export const figmaCellId = (nodeId: string) => `figma:${nodeId}`
export const isFigmaCell = (id: string) => id.startsWith('figma:')
export const UNSLICED_NAME = 'Unsliced area'

/** Collects visible SLICE layers anywhere inside the frame, in exported-image pixels. */
export function collectFigmaSlices(frame: FigmaNode, scale: number): FigmaSlice[] {
  const fb = frame.absoluteBoundingBox
  if (!fb) return []
  const out: FigmaSlice[] = []
  const walk = (n: FigmaNode) => {
    if (n.visible === false) return
    if (n.type === 'SLICE') {
      const b = n.absoluteBoundingBox
      if (b && b.width > 0 && b.height > 0) {
        out.push({
          nodeId: n.id,
          name: n.name,
          x: Math.round((b.x - fb.x) * scale),
          y: Math.round((b.y - fb.y) * scale),
          width: Math.round(b.width * scale),
          height: Math.round(b.height * scale),
        })
      }
      return
    }
    for (const c of n.children ?? []) walk(c)
  }
  for (const c of frame.children ?? []) walk(c)
  return out
}

interface Span {
  start: number
  end: number
  slice?: FigmaSlice
}

/**
 * Turns Figma slices into the app's row/column layout (which must tile the whole email).
 * - Slices that overlap vertically form one row; side-by-side slices become its columns.
 * - Edges within `tolerance` px snap together.
 * - Areas no slice covers become "Unsliced area" pieces (and a warning), so nothing is lost.
 */
export function layoutFromFigmaSlices(input: FigmaSlice[], width: number, height: number, tolerance = 3): { layout: SliceLayout; warnings: string[] } {
  const warnings: string[] = []
  const slices = input
    .map((s) => {
      const x0 = Math.max(0, Math.min(width, s.x))
      const y0 = Math.max(0, Math.min(height, s.y))
      const x1 = Math.max(0, Math.min(width, s.x + s.width))
      const y1 = Math.max(0, Math.min(height, s.y + s.height))
      return { ...s, x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    })
    .filter((s) => {
      const ok = s.width > tolerance && s.height > tolerance
      if (!ok) warnings.push(`Figma slice “${s.name}” is outside the email frame (or too small) and was ignored.`)
      return ok
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)

  // 1. Cluster into rows by vertical overlap.
  const clusters: { top: number; bottom: number; items: FigmaSlice[] }[] = []
  for (const s of slices) {
    const last = clusters[clusters.length - 1]
    if (last && s.y < last.bottom - tolerance) {
      last.items.push(s)
      last.top = Math.min(last.top, s.y)
      last.bottom = Math.max(last.bottom, s.y + s.height)
    } else {
      clusters.push({ top: s.y, bottom: s.y + s.height, items: [s] })
    }
  }

  // 2. Rows: snap small gaps, fill large ones.
  const bands: { top: number; bottom: number; items: FigmaSlice[] }[] = []
  let cursor = 0
  for (const c of clusters) {
    if (c.top - cursor > tolerance) {
      bands.push({ top: cursor, bottom: c.top, items: [] })
    } else if (bands.length) {
      bands[bands.length - 1].bottom = c.top // snap previous row down to this one
    } else {
      c.top = 0
    }
    bands.push({ top: Math.max(c.top, cursor), bottom: c.bottom, items: c.items })
    cursor = c.bottom
  }
  if (height - cursor > tolerance || !bands.length) bands.push({ top: cursor, bottom: height, items: [] })
  else bands[bands.length - 1].bottom = height

  const unsliced: string[] = []
  const unslicedCell = (top: number, x0: number): CellMeta => ({ id: `unsliced:${top}:${x0}`, name: UNSLICED_NAME, link: '', alt: '', format: 'auto' })

  const rows: Row[] = bands.map((band) => {
    if (!band.items.length) {
      unsliced.push(`${band.top}–${band.bottom}px`)
      return { id: `row:unsliced:${band.top}`, bottom: band.bottom, colCuts: [], cells: [unslicedCell(band.top, 0)] }
    }
    for (const s of band.items) {
      if (s.y - band.top > tolerance || band.bottom - (s.y + s.height) > tolerance) {
        warnings.push(`Figma slice “${s.name}” is shorter than the slices beside it, so its image also includes the area above/below it (${band.top}–${band.bottom}px).`)
      }
    }
    // 3. Columns: snap small gaps, fill large ones, clip overlaps.
    const spans: Span[] = []
    let x = 0
    for (const s of [...band.items].sort((a, b) => a.x - b.x)) {
      let start = s.x
      const end = s.x + s.width
      if (end <= x + tolerance) {
        warnings.push(`Figma slice “${s.name}” overlaps another slice and was skipped.`)
        continue
      }
      if (start < x) {
        if (x - start > tolerance) warnings.push(`Figma slice “${s.name}” overlaps the slice to its left; the overlap goes to the left slice.`)
        start = x
      }
      if (start - x > tolerance) spans.push({ start: x, end: start })
      else start = x
      spans.push({ start, end, slice: s })
      x = end
    }
    if (width - x > tolerance) spans.push({ start: x, end: width })
    else spans[spans.length - 1].end = width
    if (spans.some((sp) => !sp.slice)) unsliced.push(`beside ${band.items.map((s) => `“${s.name}”`).join(', ')}`)

    const cells = spans.map((sp) => (sp.slice ? { id: figmaCellId(sp.slice.nodeId), name: sp.slice.name, link: '', alt: '', format: 'auto' as const } : unslicedCell(band.top, sp.start)))
    return { id: `row:${cells[0].id}`, bottom: band.bottom, colCuts: spans.slice(1).map((sp) => sp.start), cells }
  })

  if (unsliced.length) {
    warnings.unshift(`Some parts of the email aren’t covered by a Figma slice (${unsliced.join('; ')}). They’re kept as “${UNSLICED_NAME}” pieces so nothing is lost. Add slices in Figma to name them.`)
  }
  return { layout: { width, height, rows }, warnings }
}

/** Keeps links, alt text and format the user set in the app when slices are rebuilt from Figma. */
export function carryOverMeta(next: SliceLayout, prev: SliceLayout | null): SliceLayout {
  if (!prev) return next
  const old = new Map(prev.rows.flatMap((r) => r.cells).map((c) => [c.id, c]))
  return {
    ...next,
    rows: next.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c) => {
        const o = old.get(c.id)
        return o ? { ...c, link: o.link, alt: o.alt, format: o.format, deleted: o.deleted } : c
      }),
    })),
  }
}
