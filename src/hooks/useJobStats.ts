import { useMemo } from 'react'
import { getSlices, type Slice } from '@/lib/slicing'
import { useSettings } from '@/store/settings'
import { klaviyoImageName } from '@/lib/naming'
import { currentResult, type EmailJob, type SliceResult, type UploadRecord } from '@/store/workspace'

export interface SliceRow {
  slice: Slice
  result?: SliceResult
  upload?: UploadRecord
}

export function useJobSlices(job: EmailJob | undefined) {
  const compress = useSettings((s) => s.compress)
  return useMemo(() => {
    if (!job?.layout) return { rows: [] as SliceRow[], stats: emptyStats() }
    const rows: SliceRow[] = getSlices(job.layout).map((slice) => {
      const result = currentResult(job, slice, compress)
      const u = job.uploads[slice.id]
      return { slice, result, upload: u && result && u.key === result.key ? u : undefined }
    })
    const done = rows.filter((r) => r.result?.status === 'done')
    const stats = {
      total: rows.length,
      done: done.length,
      working: rows.filter((r) => r.result?.status === 'working' || !r.result).length,
      errors: rows.filter((r) => r.result?.status === 'error').length,
      overBudget: done.filter((r) => !r.result!.withinBudget).length,
      approved: done.filter((r) => r.result!.approved).length,
      uploaded: rows.filter((r) => r.upload?.status === 'done').length,
      uploadErrors: rows.filter((r) => r.upload?.status === 'error').length,
      /** Uploaded, but the Klaviyo name no longer matches the slice name. */
      renamePending: rows.filter((r) => r.upload?.status === 'done' && r.upload.name !== klaviyoImageName(job.uploadPrefix, r.slice)).length,
      bytes: done.reduce((a, r) => a + (r.result!.size ?? 0), 0),
      missingLinks: rows.filter((r) => !r.slice.meta.link.trim()).length,
      missingAlt: rows.filter((r) => !r.slice.meta.alt.trim()).length,
    }
    return { rows, stats }
  }, [job, compress])
}

function emptyStats() {
  return { total: 0, done: 0, working: 0, errors: 0, overBudget: 0, approved: 0, uploaded: 0, uploadErrors: 0, renamePending: 0, bytes: 0, missingLinks: 0, missingAlt: 0 }
}
