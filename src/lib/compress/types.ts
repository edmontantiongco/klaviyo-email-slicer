export type OutputFormat = 'jpeg' | 'png'

export interface CompressOptions {
  /** 'auto' tries both and keeps PNG only when it is lossless *and* not meaningfully bigger. */
  format: 'auto' | OutputFormat
  /** Hard ceiling per image (bytes). */
  maxBytes: number
  /** Highest JPEG quality to try (the search starts here). */
  maxQuality: number
  /** Never go below this JPEG quality, even if the budget is exceeded. */
  minQuality: number
  /** 4:4:4 chroma – sharper coloured text, slightly bigger files. */
  crispText: boolean
  /** OxiPNG effort 1–6. */
  pngLevel: number
}

export const DEFAULT_COMPRESS: CompressOptions = {
  format: 'auto',
  maxBytes: 500 * 1024,
  maxQuality: 88,
  minQuality: 55,
  crispText: false,
  pngLevel: 2,
}

export interface CompressRequest {
  id: number
  width: number
  height: number
  pixels: ArrayBuffer
  options: CompressOptions
}

export interface CompressSuccess {
  id: number
  ok: true
  buffer: ArrayBuffer
  format: OutputFormat
  quality?: number
  size: number
  withinBudget: boolean
  /** e.g. "jpeg q82 (6 tries) · png 812 KB" */
  notes: string
  ms: number
}

export interface CompressFailure {
  id: number
  ok: false
  error: string
}

export type CompressResponse = CompressSuccess | CompressFailure
