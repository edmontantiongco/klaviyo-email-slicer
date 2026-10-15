import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, type CampaignInfo, type CampaignReplaceResult, type CampaignSliceRow } from '@/lib/api'
import { useSettings } from '@/store/settings'
import { useWorkspace, type CampaignLink, type EmailJob } from '@/store/workspace'

/**
 * State for the optional "update a cloned campaign" part of the Upload step. When a campaign is
 * loaded, the Upload step's Send button replaces the email's whole content with the approved slices.
 */
export function useCampaign(job: EmailJob, keyReady: boolean) {
  const patchJob = useWorkspace((s) => s.patchJob)
  const [url, setUrl] = useState(job.campaign?.url ?? '')
  const [info, setInfo] = useState<CampaignInfo | null>(null)
  const [loading, setLoading] = useState(false)

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
  /** A loaded, editable campaign: Send replaces its content with the slices. */
  const ready = !!info && !problem

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

  const applied = (result: CampaignReplaceResult) => {
    saveLink({
      templateUpdated: result.templateUpdated,
      selectedKeys: [],
      placement: undefined,
      lastUpdate: { at: Date.now(), removed: result.removed, inserted: result.inserted, method: result.method! },
    })
    setInfo({ ...info!, template: { ...info!.template, id: result.templateId ?? info!.template.id, updated: result.templateUpdated ?? null }, summary: result.after ?? info!.summary })
  }

  return { url, setUrl, info, setInfo, loading, load, saveLink, problem, editorOk, ready, replace, applied }
}

export type CampaignState = ReturnType<typeof useCampaign>
