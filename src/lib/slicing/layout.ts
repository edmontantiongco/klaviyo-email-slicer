import type { CellMeta, Row, Slice, SliceLayout } from './types'

let counter = 0
export function newId(): string {
  counter = (counter + 1) % 1e6
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function makeCell(name: string, from?: Partial<CellMeta>): CellMeta {
  return { id: newId(), name, link: from?.link ?? '', alt: from?.alt ?? '', format: from?.format ?? 'auto' }
}

export function singleSlice(width: number, height: number, name = 'email'): SliceLayout {
  return { width, height, rows: [{ id: newId(), bottom: height, colCuts: [], cells: [makeCell(name)] }] }
}

export function rowTop(layout: SliceLayout, rowIndex: number): number {
  return rowIndex === 0 ? 0 : layout.rows[rowIndex - 1].bottom
}

export function getSlices(layout: SliceLayout): Slice[] {
  const out: Slice[] = []
  layout.rows.forEach((row, rowIndex) => {
    const top = rowTop(layout, rowIndex)
    const xs = [0, ...row.colCuts, layout.width]
    row.cells.forEach((meta, colIndex) => {
      if (meta.deleted) return
      out.push({
        id: meta.id,
        rowIndex,
        colIndex,
        colCount: row.cells.length,
        x: xs[colIndex],
        y: top,
        width: xs[colIndex + 1] - xs[colIndex],
        height: row.bottom - top,
        meta,
      })
    })
  })
  return out
}

/** Geometry signature – changes whenever the pixels of a slice would change. */
export function sliceSignature(s: { x: number; y: number; width: number; height: number }): string {
  return `${s.x},${s.y},${s.width},${s.height}`
}

const MIN = 2

function replaceRow(layout: SliceLayout, index: number, rows: Row[]): SliceLayout {
  const next = [...layout.rows]
  next.splice(index, 1, ...rows)
  return { ...layout, rows: next }
}

export function findRowAt(layout: SliceLayout, y: number): number {
  return layout.rows.findIndex((r) => y < r.bottom)
}

/** Split the row containing y into two rows at y. */
export function addRowCut(layout: SliceLayout, y: number): SliceLayout {
  y = Math.round(y)
  const i = findRowAt(layout, y)
  if (i < 0) return layout
  const row = layout.rows[i]
  const top = rowTop(layout, i)
  if (y - top < MIN || row.bottom - y < MIN) return layout
  const upper: Row = { ...row, bottom: y }
  const lower: Row = {
    id: newId(),
    bottom: row.bottom,
    colCuts: [...row.colCuts],
    cells: row.cells.map((c) => makeCell(c.name, c)),
  }
  return replaceRow(layout, i, [upper, lower])
}

/** Remove the horizontal cut at the bottom of row i (merging rows i and i+1). */
export function removeRowCut(layout: SliceLayout, rowIndex: number): SliceLayout {
  if (rowIndex < 0 || rowIndex >= layout.rows.length - 1) return layout
  const a = layout.rows[rowIndex]
  const b = layout.rows[rowIndex + 1]
  const next = [...layout.rows]
  next.splice(rowIndex, 2, { ...a, bottom: b.bottom })
  return { ...layout, rows: next }
}

export function moveRowCut(layout: SliceLayout, rowIndex: number, y: number): SliceLayout {
  if (rowIndex < 0 || rowIndex >= layout.rows.length - 1) return layout
  const lo = rowTop(layout, rowIndex) + MIN
  const hi = layout.rows[rowIndex + 1].bottom - MIN
  const clamped = Math.min(hi, Math.max(lo, Math.round(y)))
  if (clamped === layout.rows[rowIndex].bottom) return layout
  const next = [...layout.rows]
  next[rowIndex] = { ...next[rowIndex], bottom: clamped }
  return { ...layout, rows: next }
}

export function addColCut(layout: SliceLayout, rowIndex: number, x: number): SliceLayout {
  const row = layout.rows[rowIndex]
  if (!row) return layout
  x = Math.round(x)
  const xs = [0, ...row.colCuts, layout.width]
  const k = xs.findIndex((v, idx) => idx > 0 && x < v) - 1
  if (k < 0) return layout
  if (x - xs[k] < MIN || xs[k + 1] - x < MIN) return layout
  const colCuts = [...row.colCuts]
  colCuts.splice(k, 0, x)
  const cells = [...row.cells]
  const src = cells[k]
  cells.splice(k + 1, 0, makeCell(src.name, { format: src.format }))
  const next = [...layout.rows]
  next[rowIndex] = { ...row, colCuts, cells }
  return { ...layout, rows: next }
}

export function removeColCut(layout: SliceLayout, rowIndex: number, cutIndex: number): SliceLayout {
  const row = layout.rows[rowIndex]
  if (!row || cutIndex < 0 || cutIndex >= row.colCuts.length) return layout
  const colCuts = row.colCuts.filter((_, i) => i !== cutIndex)
  const cells = row.cells.filter((_, i) => i !== cutIndex + 1)
  const next = [...layout.rows]
  next[rowIndex] = { ...row, colCuts, cells }
  return { ...layout, rows: next }
}

export function moveColCut(layout: SliceLayout, rowIndex: number, cutIndex: number, x: number): SliceLayout {
  const row = layout.rows[rowIndex]
  if (!row || cutIndex < 0 || cutIndex >= row.colCuts.length) return layout
  const xs = [0, ...row.colCuts, layout.width]
  const lo = xs[cutIndex] + MIN
  const hi = xs[cutIndex + 2] - MIN
  const clamped = Math.min(hi, Math.max(lo, Math.round(x)))
  const colCuts = [...row.colCuts]
  colCuts[cutIndex] = clamped
  const next = [...layout.rows]
  next[rowIndex] = { ...row, colCuts }
  return { ...layout, rows: next }
}

/** Replace a row's columns with `count` equal-width columns. */
export function setEqualColumns(layout: SliceLayout, rowIndex: number, count: number): SliceLayout {
  const row = layout.rows[rowIndex]
  if (!row) return layout
  return setColumns(
    layout,
    rowIndex,
    Array.from({ length: count - 1 }, (_, i) => Math.round(((i + 1) * layout.width) / count)),
  )
}

export function setColumns(layout: SliceLayout, rowIndex: number, cuts: number[]): SliceLayout {
  const row = layout.rows[rowIndex]
  if (!row) return layout
  const colCuts = [...new Set(cuts.map(Math.round))].filter((x) => x > 0 && x < layout.width).sort((a, b) => a - b)
  const base = row.cells[0]?.name.replace(/\s\d+$/, '') || 'slice'
  const cells = Array.from({ length: colCuts.length + 1 }, (_, i) =>
    i < row.cells.length && row.cells.length === colCuts.length + 1
      ? row.cells[i]
      : makeCell(colCuts.length ? `${base} ${i + 1}` : base, { format: row.cells[0]?.format }),
  )
  const next = [...layout.rows]
  next[rowIndex] = { ...row, colCuts, cells }
  return { ...layout, rows: next }
}

export function updateCell(layout: SliceLayout, cellId: string, patch: Partial<Omit<CellMeta, 'id'>>): SliceLayout {
  return {
    ...layout,
    rows: layout.rows.map((r) =>
      r.cells.some((c) => c.id === cellId)
        ? { ...r, cells: r.cells.map((c) => (c.id === cellId ? { ...c, ...patch } : c)) }
        : r,
    ),
  }
}

/** Sanity check: rows tile [0,height] and columns tile [0,width] exactly. */
export function assertTiles(layout: SliceLayout): void {
  let top = 0
  for (const r of layout.rows) {
    if (!(r.bottom > top)) throw new Error(`row ${r.id} has non-positive height`)
    if (r.cells.length !== r.colCuts.length + 1) throw new Error(`row ${r.id} cell count mismatch`)
    let left = 0
    for (const x of [...r.colCuts, layout.width]) {
      if (!(x > left)) throw new Error(`row ${r.id} has non-positive column width`)
      left = x
    }
    top = r.bottom
  }
  if (top !== layout.height) throw new Error('rows do not reach the bottom of the email')
}
