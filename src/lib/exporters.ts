import JSZip from 'jszip'
import { getSlices } from './slicing'
import { buildEmailHtml, buildEmailRows, type HtmlOptions } from './html'
import { sliceFileName } from './naming'
import { currentResult, type EmailJob } from '@/store/workspace'
import { useSettings } from '@/store/settings'

export type SrcMode = 'klaviyo' | 'local' | 'relative'

/** HTML options for a job; src resolves to Klaviyo URLs, blob URLs (preview) or relative file names (zip). */
export function htmlOptionsFor(job: EmailJob, mode: SrcMode): HtmlOptions {
  const s = useSettings.getState()
  return {
    title: job.name,
    contentWidth: s.contentWidth,
    background: job.background,
    footer: s.footer,
    footerHtml: s.footerHtml,
    srcFor: (slice) => {
      const r = currentResult(job, slice, s.compress)
      const ext = r?.format === 'png' ? 'png' : 'jpg'
      if (mode === 'klaviyo') {
        const u = job.uploads[slice.id]
        return (u?.status === 'done' && r && u.key === r.key && u.url) || `UPLOAD_PENDING/${sliceFileName(job.uploadPrefix, slice, ext)}`
      }
      if (mode === 'local') return r?.url ?? ''
      return `images/${sliceFileName(job.uploadPrefix, slice, ext)}`
    },
  }
}

export function emailHtml(job: EmailJob, mode: SrcMode): string {
  return job.layout ? buildEmailHtml(job.layout, htmlOptionsFor(job, mode)) : ''
}

export function emailSnippet(job: EmailJob, mode: SrcMode): string {
  return job.layout ? buildEmailRows(job.layout, htmlOptionsFor(job, mode)) : ''
}

export function downloadBlob(blob: Blob, fileName: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export async function exportZip(job: EmailJob): Promise<{ count: number; missing: number }> {
  if (!job.layout) throw new Error('Nothing to export')
  const { compress } = useSettings.getState()
  const zip = new JSZip()
  const images = zip.folder('images')!
  const manifest: unknown[] = []
  let missing = 0
  for (const s of getSlices(job.layout)) {
    const r = currentResult(job, s, compress)
    if (!r?.blob) {
      missing++
      continue
    }
    const fileName = sliceFileName(job.uploadPrefix, s, r.format === 'png' ? 'png' : 'jpg')
    images.file(fileName, r.blob)
    manifest.push({
      file: `images/${fileName}`,
      name: s.meta.name,
      row: s.rowIndex + 1,
      column: s.colIndex + 1,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      format: r.format,
      quality: r.quality ?? null,
      bytes: r.size,
      link: s.meta.link,
      alt: s.meta.alt,
      approved: r.approved,
      klaviyoUrl: job.uploads[s.id]?.key === r.key ? (job.uploads[s.id]?.url ?? null) : null,
    })
  }
  zip.file('index.html', emailHtml(job, 'relative'))
  zip.file('manifest.json', JSON.stringify({ email: job.name, width: job.width, height: job.height, slices: manifest }, null, 2))
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `${job.uploadPrefix || 'email'}.zip`)
  return { count: manifest.length, missing }
}
