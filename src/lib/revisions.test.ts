import { describe, expect, it } from 'vitest'
import { pixelsDiffer } from './revisions'

const img = (w: number, h: number, fill: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(fill) })

describe('pixelsDiffer', () => {
  it('same pixels → unchanged; small render noise → unchanged', () => {
    const a = img(100, 100, 200)
    const b = img(100, 100, 200)
    b.data[0] = 205 // within channel tolerance
    b.data[40] = 0 // 1 pixel of 10,000 off (≤ 0.05%)
    expect(pixelsDiffer(a, b)).toBe(false)
  })
  it('a real edit or a size change → changed', () => {
    const a = img(100, 100, 200)
    const b = img(100, 100, 200)
    for (let i = 0; i < 400; i += 4) b.data[i] = 0 // 100 pixels changed (1%)
    expect(pixelsDiffer(a, b)).toBe(true)
    expect(pixelsDiffer(a, img(100, 101, 200))).toBe(true)
  })
})
