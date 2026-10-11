import { create } from 'zustand'
import { toast } from 'sonner'
import { del, get as idbGet, set as idbSet, keys as idbKeys } from 'idb-keyval'
import { api, type SliceAnchor } from '@/lib/api'
import { compressPool } from '@/lib/compress/pool'
import type { CompressOptions, OutputFormat } from '@/lib/compress/types'
import { cropImageData, fullImageData, loadBitmap } from '@/lib/image'
import { sliceFileName } from '@/lib/naming'
import {
  analyzeFigmaFrame,
  analyzePixels,
  autoSlice,
  getSlices,
  newId,
  scaledDefaults,
  sliceSignature,
  suggestCellMeta,
  type AutoSliceOptions,
  type EmailFrameInfo,
  type LayoutAnalysis,
  type Slice,
  type SliceLayout,
} from '@/lib/slicing'
import { slugify } from '@/lib/utils'
import { resolveScale, useSettings } from './settings'

export type JobStep = 'slice' | 'optimize' | 'upload'

export type JobSource =
  | { kind: 'figma'; fileKey: string; nodeId: string; fileName?: string }
  | { kind: 'upload'; fileName: string }

export interface SliceResult {
  /** geometry + effective compression settings; a result is stale when this changes */
  key: string
  status: 'working' | 'done' | 'error'
  blob?: Blob
  url?: string
  format?: OutputFormat
  quality?: number
  size?: number
  withinBudget?: boolean
  notes?: string
  error?: string
  ms?: number
  approved: boolean
}

export interface UploadRecord {
  key: string
  status: 'uploading' | 'done' | 'error'
  fileName: string
  url?: string
  klaviyoId?: string
  error?: string
}

export interface EmailJob {
  id: string
  name: string
  source: JobSource
  createdAt: number
  status: 'loading' | 'ready' | 'error'
  loadingLabel?: string
  error?: string
  imageBlob?: Blob
  imageUrl?: string
  bitmap?: ImageBitmap
  width: number
  height: number
  scale: number
  background: string
  analysis: LayoutAnalysis | null
  autoOptions: AutoSliceOptions
  layout: SliceLayout | null
  past: SliceLayout[]
  future: SliceLayout[]
  step: JobStep
  results: Record<string, SliceResult>
  uploads: Record<string, UploadRecord>
  uploadPrefix: string
  template?: { id: string; name: string; createdAt: number }
  /** Cloned Klaviyo campaign whose images get replaced by this job's slices. */
  campaign?: CampaignLink
}

export interface CampaignLink {
  url: string
  campaignId?: string
  campaignName?: string
  /** Template `updated` timestamp when loaded/last written (detects edits made in Klaviyo meanwhile). */
  templateUpdated?: string | null
  /** Image block keys the user chose to replace. */
  selectedKeys?: string[]
  lastUpdate?: { at: number; removed: number; inserted: number; method: 'update' | 'assign' }
  /**
   * Set after "Remove from campaign": where the removed images were, so "Update campaign"
   * can insert the slices there. Valid only while the email is unchanged (templateUpdated).
   */
  placement?: { anchor: SliceAnchor; removed: number; at: number; templateUpdated: string | null }
}

interface WorkspaceState {
  jobs: EmailJob[]
  activeId: string | null
  view: 'import' | 'job'
  hydrated: boolean
  setView: (view: 'import' | 'job') => void
  setActive: (id: string) => void
  patchJob: (id: string, patch: Partial<EmailJob>) => void
  removeJob: (id: string) => void
  addFigmaJobs: (fileKey: string, fileName: string, frames: EmailFrameInfo[]) => void
  addUploadJobs: (files: File[]) => void
  reloadJob: (id: string) => void
  runAutoSlice: (id: string, options?: AutoSliceOptions) => void
  setLayout: (id: string, layout: SliceLayout, opts?: { history?: boolean }) => void
  pushHistory: (id: string) => void
  undo: (id: string) => void
  redo: (id: string) => void
  setStep: (id: string, step: JobStep) => void
  compressJob: (id: string) => void
  setApproved: (id: string, cellIds: string[], approved: boolean) => void
  uploadJob: (id: string) => Promise<void>
}

export function effectiveCompress(slice: Slice, global: CompressOptions): CompressOptions {
  return { ...global, format: slice.meta.format === 'auto' ? global.format : slice.meta.format }
}

export function resultKey(slice: Slice, global: CompressOptions): string {
  return `${sliceSignature(slice)}|${JSON.stringify(effectiveCompress(slice, global))}`
}

/** Result for a slice only if it matches the current geometry + settings. */
export function currentResult(job: EmailJob, slice: Slice, global: CompressOptions): SliceResult | undefined {
  const r = job.results[slice.id]
  return r && r.key === resultKey(slice, global) ? r : undefined
}

const extFor = (f?: OutputFormat) => (f === 'png' ? 'png' : 'jpg')

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  const job = (id: string) => get().jobs.find((j) => j.id === id)
  const patchJob = (id: string, patch: Partial<EmailJob> | ((j: EmailJob) => Partial<EmailJob>)) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...(typeof patch === 'function' ? patch(j) : patch) } : j)),
    }))
  const patchResult = (id: string, cellId: string, r: SliceResult) =>
    patchJob(id, (j) => {
      const old = j.results[cellId]
      if (old?.url && old.url !== r.url) URL.revokeObjectURL(old.url)
      return { results: { ...j.results, [cellId]: r } }
    })

  // Figma loads run one after another to stay friendly with Figma's rate limits.
  let loadChain: Promise<unknown> = Promise.resolve()
  const enqueueLoad = (fn: () => Promise<void>) => {
    loadChain = loadChain.then(fn, fn)
  }

  async function finishLoad(id: string, blob: Blob, analysisFor: (bitmap: ImageBitmap) => LayoutAnalysis, scale: number) {
    const bitmap = await loadBitmap(blob)
    patchJob(id, { loadingLabel: 'Detecting safe slice lines…' })
    await new Promise((r) => setTimeout(r, 0))
    const analysis = analysisFor(bitmap)
    // Rendered image is the source of truth for dimensions.
    analysis.width = bitmap.width
    analysis.height = bitmap.height
    const autoOptions = scaledDefaults(bitmap.width)
    const layout = suggestCellMeta(autoSlice(analysis, autoOptions), analysis)
    const prev = job(id)
    if (prev?.imageUrl) URL.revokeObjectURL(prev.imageUrl)
    patchJob(id, {
      status: 'ready',
      loadingLabel: undefined,
      error: undefined,
      imageBlob: blob,
      imageUrl: URL.createObjectURL(blob),
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      scale,
      analysis,
      autoOptions,
      layout,
      past: [],
      future: [],
      step: 'slice',
      results: {},
      uploads: {},
    })
    void idbSet(`img:${id}`, blob)
  }

  async function loadFigma(id: string, fresh = false) {
    const j = job(id)
    if (!j || j.source.kind !== 'figma') return
    const { fileKey, nodeId } = j.source
    try {
      patchJob(id, { status: 'loading', loadingLabel: 'Reading Figma layers…', error: undefined })
      const { document: frame } = await api.figmaNode(fileKey, nodeId)
      const fw = frame.absoluteBoundingBox?.width ?? 1200
      const scale = resolveScale(useSettings.getState().scale, fw)
      patchJob(id, { loadingLabel: `Rendering in Figma @${scale}×…` })
      const blob = await api.figmaRender(fileKey, nodeId, scale, fresh)
      await finishLoad(id, blob, () => analyzeFigmaFrame(frame, scale), scale)
    } catch (err) {
      patchJob(id, { status: 'error', loadingLabel: undefined, error: (err as Error).message })
      toast.error(`Couldn't load “${j.name}”`, { description: (err as Error).message })
    }
  }

  async function loadUpload(id: string, file: Blob) {
    try {
      patchJob(id, { status: 'loading', loadingLabel: 'Decoding image…' })
      await finishLoad(id, file, (bitmap) => analyzePixels(fullImageData(bitmap)), 1)
    } catch (err) {
      patchJob(id, { status: 'error', loadingLabel: undefined, error: (err as Error).message })
    }
  }

  const baseJob = (name: string, source: JobSource): EmailJob => ({
    id: newId(),
    name,
    source,
    createdAt: Date.now(),
    status: 'loading',
    loadingLabel: 'Queued…',
    width: 0,
    height: 0,
    scale: 1,
    background: '#ffffff',
    analysis: null,
    autoOptions: scaledDefaults(1200),
    layout: null,
    past: [],
    future: [],
    step: 'slice',
    results: {},
    uploads: {},
    uploadPrefix: slugify(name) || 'email',
  })

  return {
    jobs: [],
    activeId: null,
    view: 'import',
    hydrated: false,

    setView: (view) => set({ view }),
    setActive: (id) => set({ activeId: id, view: 'job' }),
    patchJob: (id, patch) => patchJob(id, patch),

    removeJob: (id) => {
      const j = job(id)
      if (j?.imageUrl) URL.revokeObjectURL(j.imageUrl)
      Object.values(j?.results ?? {}).forEach((r) => r.url && URL.revokeObjectURL(r.url))
      j?.bitmap?.close()
      set((s) => {
        const jobs = s.jobs.filter((x) => x.id !== id)
        const activeId = s.activeId === id ? (jobs[0]?.id ?? null) : s.activeId
        return { jobs, activeId, view: activeId ? s.view : 'import' }
      })
      void idbKeys().then((ks) => ks.filter((k) => String(k).includes(id)).forEach((k) => del(k)))
    },

    addFigmaJobs: (fileKey, fileName, frames) => {
      const created = frames.map((f) => baseJob(f.name, { kind: 'figma', fileKey, nodeId: f.id, fileName }))
      set((s) => ({ jobs: [...s.jobs, ...created], activeId: created[0]?.id ?? s.activeId, view: 'job' }))
      created.forEach((c) => enqueueLoad(() => loadFigma(c.id)))
    },

    addUploadJobs: (files) => {
      const created = files.map((f) => ({ job: baseJob(f.name.replace(/\.[^.]+$/, ''), { kind: 'upload', fileName: f.name }), f }))
      set((s) => ({ jobs: [...s.jobs, ...created.map((c) => c.job)], activeId: created[0]?.job.id ?? s.activeId, view: 'job' }))
      created.forEach((c) => void loadUpload(c.job.id, c.f))
    },

    reloadJob: (id) => {
      const j = job(id)
      if (!j) return
      if (j.source.kind === 'figma') enqueueLoad(() => loadFigma(id, true))
      else if (j.imageBlob) void loadUpload(id, j.imageBlob)
    },

    runAutoSlice: (id, options) => {
      const j = job(id)
      if (!j?.analysis) return
      const opts = options ?? j.autoOptions
      const layout = suggestCellMeta(autoSlice(j.analysis, opts), j.analysis)
      patchJob(id, (x) => ({
        autoOptions: opts,
        layout,
        past: x.layout ? [...x.past.slice(-99), x.layout] : x.past,
        future: [],
      }))
    },

    setLayout: (id, layout, opts) =>
      patchJob(id, (x) => ({
        layout,
        ...(opts?.history && x.layout ? { past: [...x.past.slice(-99), x.layout], future: [] } : {}),
      })),

    pushHistory: (id) =>
      patchJob(id, (x) => (x.layout ? { past: [...x.past.slice(-99), x.layout], future: [] } : {})),

    undo: (id) =>
      patchJob(id, (x) => {
        if (!x.past.length || !x.layout) return {}
        return { layout: x.past[x.past.length - 1], past: x.past.slice(0, -1), future: [x.layout, ...x.future] }
      }),

    redo: (id) =>
      patchJob(id, (x) => {
        if (!x.future.length || !x.layout) return {}
        return { layout: x.future[0], future: x.future.slice(1), past: [...x.past, x.layout] }
      }),

    setStep: (id, step) => patchJob(id, { step }),

    compressJob: (id) => {
      const j = job(id)
      if (!j?.layout || !j.bitmap) return
      const global = useSettings.getState().compress
      const slices = getSlices(j.layout)
      const live = new Set(slices.map((s) => s.id))
      // Drop results for slices that no longer exist.
      const stale = Object.keys(j.results).filter((k) => !live.has(k))
      if (stale.length) {
        patchJob(id, (x) => {
          const results = { ...x.results }
          stale.forEach((k) => {
            if (results[k]?.url) URL.revokeObjectURL(results[k].url!)
            delete results[k]
            void del(`res:${id}:${k}`)
          })
          return { results }
        })
      }
      for (const s of slices) {
        const key = resultKey(s, global)
        const existing = job(id)?.results[s.id]
        if (existing && existing.key === key && existing.status !== 'error') continue
        patchResult(id, s.id, { key, status: 'working', approved: false })
        const img = cropImageData(j.bitmap, s)
        compressPool
          .compress(img, effectiveCompress(s, global))
          .then((r) => {
            if (job(id)?.results[s.id]?.key !== key) return // superseded
            const blob = new Blob([r.buffer], { type: r.format === 'png' ? 'image/png' : 'image/jpeg' })
            patchResult(id, s.id, {
              key,
              status: 'done',
              blob,
              url: URL.createObjectURL(blob),
              format: r.format,
              quality: r.quality,
              size: r.size,
              withinBudget: r.withinBudget,
              notes: r.notes,
              ms: r.ms,
              approved: false,
            })
            void idbSet(`res:${id}:${s.id}`, blob)
          })
          .catch((err: Error) => {
            if (job(id)?.results[s.id]?.key !== key) return
            patchResult(id, s.id, { key, status: 'error', error: err.message, approved: false })
          })
      }
    },

    setApproved: (id, cellIds, approved) =>
      patchJob(id, (x) => {
        const results = { ...x.results }
        for (const c of cellIds) if (results[c]?.status === 'done') results[c] = { ...results[c], approved }
        return { results }
      }),

    uploadJob: async (id) => {
      const j = job(id)
      if (!j?.layout) return
      const { compress, hideUploadsInLibrary } = useSettings.getState()
      const slices = getSlices(j.layout)
      const pending = slices.filter((s) => {
        const r = currentResult(j, s, compress)
        const u = j.uploads[s.id]
        return r?.status === 'done' && r.approved && !(u?.status === 'done' && u.key === r.key)
      })
      const queue = [...pending]
      const worker = async () => {
        for (let s = queue.shift(); s; s = queue.shift()) {
          const cur = job(id)!
          const r = currentResult(cur, s, compress)!
          const fileName = sliceFileName(cur.uploadPrefix, s, extFor(r.format))
          const setU = (u: UploadRecord) => patchJob(id, (x) => ({ uploads: { ...x.uploads, [s!.id]: u } }))
          setU({ key: r.key, status: 'uploading', fileName })
          try {
            const res = await api.klaviyoUpload(r.blob!, fileName, fileName.replace(/\.[^.]+$/, ''), hideUploadsInLibrary)
            setU({ key: r.key, status: 'done', fileName, url: res.url, klaviyoId: res.id })
          } catch (err) {
            setU({ key: r.key, status: 'error', fileName, error: (err as Error).message })
          }
        }
      }
      // The local server enforces Klaviyo's 3/s limit; two in flight keeps it busy.
      await Promise.all([worker(), worker()])
    },
  }
})

/* ----------------------------- persistence ----------------------------- */

type PersistedJob = Omit<EmailJob, 'imageBlob' | 'imageUrl' | 'bitmap' | 'past' | 'future' | 'results'> & {
  results: Record<string, Omit<SliceResult, 'blob' | 'url'>>
}

function serialize(j: EmailJob): PersistedJob {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { imageBlob, imageUrl, bitmap, past, future, results, ...rest } = j
  const r: PersistedJob['results'] = {}
  for (const [k, v] of Object.entries(results)) {
    if (v.status !== 'done') continue
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { blob, url, ...meta } = v
    r[k] = meta
  }
  return { ...rest, results: r }
}

export async function hydrateWorkspace() {
  try {
    const saved = (await idbGet<PersistedJob[]>('jobs')) ?? []
    const activeId = (await idbGet<string | null>('activeId')) ?? null
    const jobs: EmailJob[] = []
    for (const p of saved) {
      const blob = await idbGet<Blob>(`img:${p.id}`)
      if (!blob || p.status !== 'ready') continue
      const bitmap = await loadBitmap(blob)
      const results: Record<string, SliceResult> = {}
      for (const [k, meta] of Object.entries(p.results)) {
        const rb = await idbGet<Blob>(`res:${p.id}:${k}`)
        if (rb) results[k] = { ...meta, blob: rb, url: URL.createObjectURL(rb) }
      }
      jobs.push({ ...p, imageBlob: blob, imageUrl: URL.createObjectURL(blob), bitmap, past: [], future: [], results })
    }
    useWorkspace.setState({
      jobs,
      activeId: jobs.some((j) => j.id === activeId) ? activeId : (jobs[0]?.id ?? null),
      view: jobs.length ? 'job' : 'import',
      hydrated: true,
    })
  } catch (err) {
    console.warn('Could not restore workspace', err)
    useWorkspace.setState({ hydrated: true })
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  useWorkspace.subscribe((s) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      void idbSet('jobs', s.jobs.filter((j) => j.status === 'ready').map(serialize))
      void idbSet('activeId', s.activeId)
    }, 400)
  })
}
