import { slugify } from './utils'
import type { Slice } from './slicing'

export function sliceIndexLabel(s: Pick<Slice, 'rowIndex' | 'colIndex' | 'colCount'>): string {
  const row = String(s.rowIndex + 1).padStart(2, '0')
  return s.colCount > 1 ? `${row}${String.fromCharCode(97 + s.colIndex)}` : row
}

/** e.g. "oct-01-launch_03b_product-grid.jpg" */
export function sliceFileName(prefix: string, s: Slice, ext: string): string {
  const p = slugify(prefix) || 'email'
  const name = slugify(s.meta.name)
  return `${p}_${sliceIndexLabel(s)}${name ? `_${name}` : ''}.${ext}`
}
