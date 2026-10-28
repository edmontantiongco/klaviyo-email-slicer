import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, type CampaignInfo, type CampaignReplaceResult, type CampaignSliceRow } from '@/lib/api'
import { useSettings } from '@/store/settings'
import { currentResult, useWorkspace, type CampaignLink, type EmailJob } from '@/store/workspace'
import { getSlices } from '@/lib/slicing'

export type SwapResult = Awaited<ReturnType<typeof api.klaviyoSwapCampaignImages>>

/**
 * State for the "cloned campaign" part of the Upload step, where the slices go. The Upload step's
 * Send button uses `mode`:
 * - 'build': the first send to this campaign (or an explicit rebuild) — the email's whole content
 *   is replaced with the approved slices.
 * - 'revise': the campaign was built already and slices were revised in Figma — only those images
 *   are swapped in place, so anything added in Klaviyo (timer, footer…) stays.
 */
export function useCampaign(job: EmailJob, keyReady: boolean) {
  const patchJob = useWorkspace((s) => s.patchJob)
  const [url, setUrl] = useState(job.campaign?.url ?? '')
  const [info, setInfo] = useState<CampaignInfo | null>(null)
  const [loading, setLoading] = useState(false)
  /** The user chose to rebuild the whole email instead of updating revised slices. */
  const [rebuild, setRebuild] = useState(false)
  const compress = useSettings((s) => s.compress)

  const saveLink = (patch: Partial<CampaignLink>) => {
    const current = useWorkspace.getState().jobs.find((j) => j.id === job.id)?.campaign
    patchJob(job.id, { campaign: { url, ...current, ...patch } })
  }

  const load = async (link = url) => {
    if (!link.trim()) return
    setLoading(true)
    try {
      const res = await api.klaviyoResolveCampaign(link.trim())
      setInfo(res)
      // Remember the email settings for campaigns Klaviyo can't export later.
      if (res.skeleton) useSettings.getState().set({ emailSkeleton: res.skeleton })
      saveLink({ url: link.trim(), campaignId: res.campaign.id, campaignName: res.campaign.name, templateUpdated: res.template.updated })
    } catch (e) {
      setInfo(null)
      toast.error('Could not load the campaign', { description: (e as Error).message, duration: 30000, closeButton: true })
    } finally {
      setLoading(false)
    }
  }

  // Load the saved campaign when the Upload step opens.
  const autoLoaded = useRef(false)
  useEffect(() => {
    if (autoLoaded.current || !keyReady || !job.campaign?.url) return
    autoLoaded.current = true
    void load(job.campaign.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyReady])

  const editorOk = info?.template.editorType === 'SYSTEM_DRAGGABLE'
  const problem = !info
    ? null
    : !info.campaign.editable
      ? `“${info.campaign.name}” is ${info.campaign.status} — only Draft campaigns can be edited`
      : !editorOk
        ? 'This email isn’t built with the drag-and-drop editor'
        : null
  /** A loaded, editable campaign. */
  const ready = !!info && !problem
  /** This campaign was built from the slices before (so it may hold things added in Klaviyo since). */
  const built = !!info && !!job.campaign?.lastUpdate && job.campaign.campaignId === info.campaign.id

  // Slices revised in Figma since they were uploaded (set by "Refresh from Figma").
  const revised = useMemo(() => {
    if (!job.layout || !job.revisions) return []
    return getSlices(job.layout)
      .filter((s) => job.revisions![s.id])
      .map((s) => ({ slice: s, rev: job.revisions![s.id], approved: !!currentResult(job, s, compress)?.approved }))
  }, [job, compress])

  const mode: 'build' | 'revise' | null = !ready ? null : !built || rebuild ? 'build' : revised.length ? 'revise' : null

  const replace = (rows: CampaignSliceRow[], dryRun: boolean) =>
    api.klaviyoReplaceCampaignImages({
      campaignId: info!.campaign.id,
      removeKeys: [],
      all: true,
      rows,
      dryRun,
      templateUpdated: info!.template.updated,
      skeleton: info!.definitionError ? (useSettings.getState().emailSkeleton ?? undefined) : undefined,
    })

  /**
   * Swaps each revised slice's old image in the campaign for its new upload. `after` is the job
   * after uploading; without it (review) the new images are placeholders.
   */
  const swap = (after: EmailJob | null, dryRun: boolean) => {
    const swaps = revised.map(({ slice, rev }) => {
      const r = after && currentResult(after, slice, compress)
      const u = after?.uploads[slice.id]
      if (after && (!r || u?.status !== 'done' || u.key !== r.key || !u.url)) throw new Error(`“${slice.meta.name}” isn’t uploaded yet — check the slice list above.`)
      return {
        oldUrl: rev.oldUrl,
        oldAssetId: rev.oldKlaviyoId,
        oldUrls: rev.oldUrls,
        oldAssetIds: rev.oldKlaviyoIds,
        src: u?.url ?? 'pending',
        assetId: u?.klaviyoId,
        href: slice.meta.link.trim(),
        alt: slice.meta.alt.trim(),
      }
    })
    return api.klaviyoSwapCampaignImages({ campaignId: info!.campaign.id, swaps, dryRun, templateUpdated: info!.template.updated })
  }

  /** Records a swap: the revisions are handled (ones not found aren't in this campaign either). */
  const swapped = (result: SwapResult) => {
    patchJob(job.id, { revisions: {} })
    if (result.applied) {
      saveLink({ templateUpdated: result.templateUpdated ?? null })
      setInfo({ ...info!, template: { ...info!.template, id: result.templateId ?? info!.template.id, updated: result.templateUpdated ?? null }, summary: result.after ?? info!.summary })
    }
  }

  const applied = (result: CampaignReplaceResult) => {
    setRebuild(false)
    // The email now holds the current uploads, so earlier revision records no longer apply.
    patchJob(job.id, { revisions: {} })
    saveLink({
      templateUpdated: result.templateUpdated,
      selectedKeys: [],
      placement: undefined,
      lastUpdate: { at: Date.now(), removed: result.removed, inserted: result.inserted, method: result.method! },
    })
    setInfo({ ...info!, template: { ...info!.template, id: result.templateId ?? info!.template.id, updated: result.templateUpdated ?? null }, summary: result.after ?? info!.summary })
  }

  return {
    url, setUrl, info, setInfo, loading, load, saveLink, problem, editorOk, ready,
    built, rebuild, setRebuild, revised, mode, replace, applied, swap, swapped,
  }
}

export type CampaignState = ReturnType<typeof useCampaign>
