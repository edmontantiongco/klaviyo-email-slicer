import type { CampaignImage, CampaignSliceRow } from './api'
import { getSlices } from './slicing'
import { currentResult, type EmailJob } from '@/store/workspace'
import type { CompressOptions } from './compress/types'

/** Turns the job's slice layout into rows for the campaign update (fractions + uploaded Klaviyo URLs). */
export function campaignRows(job: EmailJob, compress: CompressOptions): { rows: CampaignSliceRow[]; missingUploads: number } {
  if (!job.layout) return { rows: [], missingUploads: 0 }
  const slices = getSlices(job.layout)
  let missingUploads = 0
  const rows: CampaignSliceRow[] = job.layout.rows.map((_, rowIndex) => ({
    cells: slices
      .filter((s) => s.rowIndex === rowIndex)
      .sort((a, b) => a.colIndex - b.colIndex)
      .map((s) => {
        const r = currentResult(job, s, compress)
        const u = job.uploads[s.id]
        const uploaded = u?.status === 'done' && r && u.key === r.key && u.url
        if (!uploaded) missingUploads++
        return {
          src: uploaded ? u.url! : `pending://${s.id}`,
          assetId: uploaded ? u.klaviyoId : undefined,
          href: s.meta.link.trim(),
          alt: s.meta.alt.trim(),
          fraction: s.width / job.layout!.width,
        }
      }),
  }))
  return { rows, missingUploads }
}

/**
 * Default selection: every non-universal image, except header images (first section)
 * when there are images further down — those are usually the logo.
 */
export function defaultSelection(images: CampaignImage[]): string[] {
  const candidates = images.filter((i) => !i.universal)
  const later = candidates.some((i) => i.section > 0)
  return candidates.filter((i) => !(later && i.section === 0)).map((i) => i.key)
}

export function describePlan(rows: { mode: 'image' | 'columns' | 'html'; cells: number }[]) {
  const single = rows.filter((r) => r.mode === 'image').length
  const cols = rows.filter((r) => r.mode === 'columns')
  const html = rows.filter((r) => r.mode === 'html').length
  const parts = [`${single} full-width image${single === 1 ? '' : 's'}`]
  if (cols.length) parts.push(`${cols.length} multi-column row${cols.length === 1 ? '' : 's'}`)
  if (html) parts.push(`${html} HTML block row${html === 1 ? '' : 's'}`)
  return parts.join(', ')
}
