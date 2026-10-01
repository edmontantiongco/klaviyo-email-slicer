/// <reference lib="webworker" />
import { init as initJpeg } from '@jsquash/jpeg/encode'
import encodeJpeg from '@jsquash/jpeg/encode'
import mozjpegWasmUrl from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url'
import initOxipng, { optimise_raw } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js'
import oxipngWasmUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url'
import type { CompressRequest, CompressResponse, CompressOptions } from './types'

let jpegReady: Promise<void> | null = null
let pngReady: Promise<unknown> | null = null

function ensureJpeg() {
  jpegReady ??= WebAssembly.compileStreaming(fetch(mozjpegWasmUrl)).then((m) => initJpeg(m))
  return jpegReady
}
function ensurePng() {
  pngReady ??= initOxipng(oxipngWasmUrl)
  return pngReady
}

/** JPEG has no alpha: composite onto white so transparent areas don't turn black. */
function flatten(img: ImageData): ImageData {
  const d = img.data
  let hasAlpha = false
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { hasAlpha = true; break }
  if (!hasAlpha) return img
  const out = new Uint8ClampedArray(d.length)
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    out[i] = d[i] * a + 255 * (1 - a)
    out[i + 1] = d[i + 1] * a + 255 * (1 - a)
    out[i + 2] = d[i + 2] * a + 255 * (1 - a)
    out[i + 3] = 255
  }
  return new ImageData(out, img.width, img.height)
}

/** Rough "is this a photo?" check: many distinct colours → PNG will lose. */
function looksPhotographic(img: ImageData): boolean {
  const d = img.data
  const seen = new Set<number>()
  const stride = Math.max(1, Math.floor(d.length / 4 / 60000)) * 4
  for (let i = 0; i < d.length; i += stride) {
    seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    if (seen.size > 2500) return true
  }
  return false
}

async function jpegAt(img: ImageData, quality: number, o: CompressOptions) {
  await ensureJpeg()
  return encodeJpeg(img, {
    quality,
    progressive: true,
    optimize_coding: true,
    auto_subsample: !o.crispText,
    chroma_subsample: o.crispText ? 1 : 2,
  })
}

/** Highest quality in [minQuality, maxQuality] whose output fits maxBytes (binary search). */
async function bestJpeg(img: ImageData, o: CompressOptions) {
  let tries = 1
  const top = await jpegAt(img, o.maxQuality, o)
  if (top.byteLength <= o.maxBytes) return { buf: top, q: o.maxQuality, tries }
  let lo = o.minQuality
  let hi = o.maxQuality - 1
  let best: { buf: ArrayBuffer; q: number } | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const buf = await jpegAt(img, mid, o)
    tries++
    if (buf.byteLength <= o.maxBytes) {
      best = { buf, q: mid }
      lo = mid + 1
    } else hi = mid - 1
  }
  if (best) return { ...best, tries }
  const floor = await jpegAt(img, o.minQuality, o)
  return { buf: floor, q: o.minQuality, tries: tries + 1 }
}

async function bestPng(img: ImageData, o: CompressOptions) {
  await ensurePng()
  const out = optimise_raw(img.data, img.width, img.height, o.pngLevel, false, true)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

const kb = (n: number) => `${Math.round(n / 1024)} KB`

self.onmessage = async (e: MessageEvent<CompressRequest>) => {
  const { id, width, height, pixels, options: o } = e.data
  const t0 = performance.now()
  try {
    const img = new ImageData(new Uint8ClampedArray(pixels), width, height)
    let res: CompressResponse

    if (o.format === 'png') {
      const buf = await bestPng(img, o)
      res = { id, ok: true, buffer: buf, format: 'png', size: buf.byteLength, withinBudget: buf.byteLength <= o.maxBytes, notes: 'png lossless', ms: 0 }
    } else {
      const jpg = await bestJpeg(flatten(img), o)
      let chosen: CompressResponse = {
        id,
        ok: true,
        buffer: jpg.buf,
        format: 'jpeg',
        quality: jpg.q,
        size: jpg.buf.byteLength,
        withinBudget: jpg.buf.byteLength <= o.maxBytes,
        notes: `jpeg q${jpg.q} (${jpg.tries} ${jpg.tries === 1 ? 'pass' : 'passes'})`,
        ms: 0,
      }
      if (o.format === 'auto' && !looksPhotographic(img)) {
        const png = await bestPng(img, o)
        chosen.notes += ` · png ${kb(png.byteLength)}`
        // Prefer lossless PNG for flat artwork when it's within budget and ≤ 10% bigger.
        if (png.byteLength <= o.maxBytes && png.byteLength <= jpg.buf.byteLength * 1.1) {
          chosen = { ...chosen, buffer: png, format: 'png', quality: undefined, size: png.byteLength, withinBudget: true, notes: `png lossless · jpeg q${jpg.q} ${kb(jpg.buf.byteLength)}` }
        }
      } else if (o.format === 'auto') {
        chosen.notes += ' · photo → jpeg'
      }
      res = chosen
    }
    if (res.ok) res.ms = Math.round(performance.now() - t0)
    ;(self as unknown as Worker).postMessage(res, res.ok ? [res.buffer] : [])
  } catch (err) {
    const res: CompressResponse = { id, ok: false, error: (err as Error)?.message || String(err) }
    ;(self as unknown as Worker).postMessage(res)
  }
}
