/** All coordinates are in exported-image pixels, relative to the email's top-left corner. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Something a slice boundary should not cut through.
 * - text / component (buttons, icons, logos) are hard blockers
 * - image / vector / shape are soft blockers (cutting is allowed if unavoidable)
 * - content is a pixel-detected blob (no semantic info)
 */
export type BlockerKind = 'text' | 'component' | 'image' | 'vector' | 'shape' | 'content'

export interface Blocker extends Rect {
  kind: BlockerKind
  name: string
  id?: string
  /** Visible copy inside this blocker (Figma text layers) – used to suggest alt text. */
  text?: string
  /** Hyperlink set on the text in Figma – used to suggest the slice link. */
  link?: string
}

/** A full-width band of the design (a top-level Figma section, or a colour band). */
export interface Section {
  top: number
  bottom: number
  name: string
}

export interface LayoutAnalysis {
  source: 'figma' | 'pixels'
  width: number
  height: number
  blockers: Blocker[]
  sections: Section[]
  /** Preferred horizontal cut positions (section edges / colour changes). */
  edges: number[]
  /** Figma Slice layers on the frame (image px). When present they define the slices. */
  figmaSlices?: import('./figmaSlices').FigmaSlice[]
}

export interface AutoSliceOptions {
  /** Rows shorter than this are merged with a neighbour where possible. */
  minHeight: number
  /** Rows taller than this are split where possible. */
  maxHeight: number
  /** Whitespace gap (px) that qualifies as a natural cut point. */
  minGap: number
  /** 0.2 (more slices) … 3 (fewer slices). */
  sliceCost: number
  autoColumns: boolean
  maxColumns: number
  /** Horizontal gap (px) separating grid columns. */
  columnMinGap: number
  /** Keep cut positions on even pixels so @2x images map to whole CSS pixels. */
  snapEven: boolean
}

export const DEFAULT_AUTO_OPTIONS: AutoSliceOptions = {
  minHeight: 60,
  maxHeight: 1000,
  minGap: 8,
  sliceCost: 1.2,
  autoColumns: true,
  maxColumns: 6,
  columnMinGap: 24,
  snapEven: true,
}

/** Scale the 1200px-based defaults to a different export width. */
export function scaledDefaults(width: number): AutoSliceOptions {
  const f = width / 1200
  const d = DEFAULT_AUTO_OPTIONS
  return {
    ...d,
    minHeight: Math.round(d.minHeight * f),
    maxHeight: Math.round(d.maxHeight * f),
    minGap: Math.max(2, Math.round(d.minGap * f)),
    columnMinGap: Math.max(4, Math.round(d.columnMinGap * f)),
  }
}

export type FormatChoice = 'auto' | 'jpeg' | 'png'

export interface CellMeta {
  id: string
  name: string
  link: string
  alt: string
  /** Per-slice override; 'auto' follows the global default. */
  format: FormatChoice
}

export interface Row {
  id: string
  /** Bottom edge (exclusive) of this row; top is the previous row's bottom (or 0). */
  bottom: number
  /** Interior vertical cut positions, ascending. */
  colCuts: number[]
  /** colCuts.length + 1 cells, left to right. */
  cells: CellMeta[]
}

export interface SliceLayout {
  width: number
  height: number
  rows: Row[]
}

export interface Slice extends Rect {
  id: string
  rowIndex: number
  colIndex: number
  colCount: number
  meta: CellMeta
}

export type IssueSeverity = 'error' | 'warning'

export interface LayoutIssue {
  severity: IssueSeverity
  rowIndex: number
  colIndex?: number
  /** 'row' = the horizontal cut at the bottom of rowIndex, 'col' = vertical cut colIndex in rowIndex */
  cut: 'row' | 'col' | 'size'
  message: string
}
