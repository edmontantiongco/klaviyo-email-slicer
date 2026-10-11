import { slugify } from './utils'
import type { Slice } from './slicing'

export function sliceIndexLabel(s: Pick<Slice, 'rowIndex' | 'colIndex' | 'colCount'>): string {
  const row = String(s.rowIndex + 1).padStart(2, '0')
  return s.colCount > 1 ? `${row}${String.fromCharCode(97 + s.colIndex)}` : row
}

/**
 * Name the image gets in Klaviyo: exactly the slice's Name from the app (e.g. "Test 1011 - 1").
 * Falls back to the generated file name when the Name field is empty.
 */
export function klaviyoImageName(prefix: string, s: Slice): string {
  // eslint-disable-next-line no-control-regex -- strip control characters and slashes from the Klaviyo name
  const name = s.meta.name.replace(/[\\/\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return name || sliceFileName(prefix, s, 'x').replace(/\.x$/, '')
}

/** Upload file name for Klaviyo: the image name plus extension. */
export function klaviyoFileName(prefix: string, s: Slice, ext: string): string {
  return `${klaviyoImageName(prefix, s)}.${ext}`
}

/** e.g. "oct-01-launch_03b_product-grid.jpg" (ZIP / HTML file names) */
export function sliceFileName(prefix: string, s: Slice, ext: string): string {
  const p = slugify(prefix) || 'email'
  const name = slugify(s.meta.name)
  return `${p}_${sliceIndexLabel(s)}${name ? `_${name}` : ''}.${ext}`
}
