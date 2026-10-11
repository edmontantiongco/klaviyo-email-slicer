/**
 * Decides whether a slice's pixels changed between two Figma renders.
 * Tolerates the tiny anti-aliasing noise renders can have; any real edit
 * (text, image, colour) changes far more than 0.05% of pixels.
 */
export function pixelsDiffer(a: Pick<ImageData, 'width' | 'height' | 'data'>, b: Pick<ImageData, 'width' | 'height' | 'data'>, channelTolerance = 12, maxChangedShare = 0.0005): boolean {
  if (a.width !== b.width || a.height !== b.height) return true
  const px = a.width * a.height
  const limit = Math.max(0, Math.floor(px * maxChangedShare))
  let changed = 0
  const da = a.data
  const db = b.data
  for (let i = 0; i < da.length; i += 4) {
    if (
      Math.abs(da[i] - db[i]) > channelTolerance ||
      Math.abs(da[i + 1] - db[i + 1]) > channelTolerance ||
      Math.abs(da[i + 2] - db[i + 2]) > channelTolerance ||
      Math.abs(da[i + 3] - db[i + 3]) > channelTolerance
    ) {
      if (++changed > limit) return true
    }
  }
  return false
}
