import { getSlices } from './layout'
import type { LayoutAnalysis, SliceLayout } from './types'

/**
 * Pre-fill alt text and links from Figma copy/hyperlinks that sit inside each slice.
 * Only fills empty fields unless `overwrite` is set.
 */
export function suggestCellMeta(layout: SliceLayout, analysis: LayoutAnalysis | null, overwrite = false): SliceLayout {
  if (!analysis) return layout
  const withCopy = analysis.blockers.filter((b) => b.text || b.link)
  if (!withCopy.length) return layout
  const patches = new Map<string, { alt?: string; link?: string }>()
  for (const s of getSlices(layout)) {
    const inside = withCopy
      .filter((b) => {
        const cx = b.x + b.width / 2
        const cy = b.y + b.height / 2
        return cx >= s.x && cx < s.x + s.width && cy >= s.y && cy < s.y + s.height
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
    if (!inside.length) continue
    let alt = [...new Set(inside.map((b) => b.text).filter(Boolean))].join(' – ')
    if (alt.length > 180) alt = alt.slice(0, 177).replace(/\s+\S*$/, '') + '…'
    const link = inside.find((b) => b.link)?.link
    patches.set(s.id, { alt, link })
  }
  return {
    ...layout,
    rows: layout.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c) => {
        const p = patches.get(c.id)
        if (!p) return c
        return {
          ...c,
          alt: overwrite || !c.alt ? (p.alt ?? c.alt) : c.alt,
          link: overwrite || !c.link ? (p.link ?? c.link) : c.link,
        }
      }),
    })),
  }
}
