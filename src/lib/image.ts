import type { Rect } from './slicing'

export async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob)
}

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

function ctx2d(c: OffscreenCanvas | HTMLCanvasElement) {
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('Canvas 2D is not available')
  return ctx
}

export function cropImageData(bitmap: ImageBitmap, r: Rect): ImageData {
  const c = canvas(r.width, r.height)
  const ctx = ctx2d(c)
  ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
  return ctx.getImageData(0, 0, r.width, r.height)
}

export function fullImageData(bitmap: ImageBitmap): ImageData {
  return cropImageData(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height })
}

/** Lossless PNG of a region – used as the "original" in the before/after comparison. */
export async function cropToPngBlob(bitmap: ImageBitmap, r: Rect): Promise<Blob> {
  const c = canvas(r.width, r.height)
  const ctx = ctx2d(c)
  ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/png' })
  return new Promise((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}

/** Colour of the top-left pixel as #rrggbb – used as the email background. */
export function sampleBackground(bitmap: ImageBitmap): string {
  const d = cropImageData(bitmap, { x: 0, y: 0, width: 1, height: 1 }).data
  return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
