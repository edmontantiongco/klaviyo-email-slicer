import { useEffect, useRef, useState } from 'react'
import { api, type AsanaTask, type AsanaTaskMatch } from '@/lib/api'
import { campaignRegion, emailDate, klaviyoCampaignUrl } from '@/lib/asana'
import { useHealth } from '@/hooks/useHealth'
import { useSettings } from '@/store/settings'
import { useWorkspace, type EmailJob } from '@/store/workspace'
import type { CampaignState } from '@/hooks/useCampaign'

/**
 * The email's Asana task, for the Upload step: its subject line and preview text go into the
 * cloned campaign on the first Send, and the campaign link goes into its Link (US) / Link (CA) field.
 */
export function useAsana(job: EmailJob, campaign: CampaignState) {
  const patchJob = useWorkspace((s) => s.patchJob)
  const health = useHealth()
  const tokenReady = useSettings((s) => !!s.asanaToken) || !!health.data?.asanaTokenConfigured
  const [task, setTask] = useState<AsanaTask | null>(null)
  const [matches, setMatches] = useState<AsanaTaskMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The user can keep the campaign's own subject for this send. */
  const [setCopy, setSetCopy] = useState(true)

  const campaignName = campaign.info?.campaign.name ?? job.campaign?.campaignName ?? ''
  const date = emailDate(job.name, campaignName)

  /** Loads a task (gid or pasted Asana link) and makes it this email's task. */
  const pick = async (idOrLink: string) => {
    setLoading(true)
    setError(null)
    try {
      const t = await api.asanaTask(idOrLink.trim())
      setTask(t)
      patchJob(job.id, { asana: { gid: t.gid, name: t.name, url: t.url } })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const search = async () => {
    if (!date) return setError('No date found in the email or campaign name (like “Nov 6”), so the task can’t be found — paste its Asana link.')
    setLoading(true)
    setError(null)
    try {
      const { tasks } = await api.asanaSearch(date, job.name)
      setMatches(tasks)
      const saved = useWorkspace.getState().jobs.find((j) => j.id === job.id)?.asana
      if (saved) await pick(saved.gid)
      else if (tasks[0]) await pick(tasks[0].gid)
      else setError(`No Asana task starting with “${date}” was found — paste the task’s link.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Find the task when the Upload step opens.
  const searched = useRef(false)
  useEffect(() => {
    if (searched.current || !tokenReady) return
    searched.current = true
    void search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenReady, date])

  const campaignId = campaign.info?.campaign.id
  const copySet = job.campaign?.copySet?.campaignId === campaignId ? job.campaign?.copySet : undefined
  /** Only the first Send to a campaign sets its subject and preview text; later ones keep edits made in Klaviyo. */
  const firstSend = campaign.mode === 'build' && !campaign.built
  const willSetCopy = !!(tokenReady && task?.subject && firstSend && setCopy && !copySet)

  const region = campaignRegion(campaignName)
  const linkField = region && task ? task.links[region] : null
  const campaignUrl = campaignId ? klaviyoCampaignUrl(campaignId) : ''
  const linked = job.campaign?.asanaLinked?.campaignId === campaignId ? job.campaign?.asanaLinked : undefined
  /** The link field is empty, so Send fills it (a link already there is never replaced). */
  const willLink = !!(tokenReady && task && region && linkField && !linkField.value.trim() && !linked && campaign.ready)

  /**
   * Runs after the slices are in the campaign. Returns what was done and any problems; neither
   * part undoes the campaign update if it fails.
   */
  const sync = async () => {
    const done: string[] = []
    const problems: string[] = []
    if (willSetCopy && task && campaignId) {
      try {
        const r = await api.klaviyoSetCampaignCopy({ campaignId, subject: task.subject!, previewText: task.previewText ?? '' })
        campaign.saveLink({ copySet: { at: Date.now(), campaignId, subject: r.subject, previewText: r.previewText, taskGid: task.gid } })
        campaign.setInfo((i) => i && { ...i, message: { ...i.message, subject: r.subject, previewText: r.previewText } })
        done.push('subject line and preview text set from Asana')
      } catch (e) {
        problems.push(`Subject and preview text weren’t set: ${(e as Error).message}`)
      }
    }
    if (willLink && task && region && campaignId) {
      try {
        const r = await api.asanaSetLink(task.gid, region, campaignUrl)
        campaign.saveLink({ asanaLinked: { at: Date.now(), campaignId, region, taskGid: task.gid } })
        if (r.written) done.push(`campaign link added to “Link (${region})” in Asana`)
        setTask({ ...task, links: { ...task.links, [region]: { ...task.links[region]!, value: r.written ? campaignUrl : (r.existing ?? '') } } })
      } catch (e) {
        problems.push(`The campaign link wasn’t added to Asana: ${(e as Error).message}`)
      }
    }
    return { done, problems }
  }

  return {
    tokenReady, task, matches, loading, error, date, pick, search, setCopy, setSetCopy,
    copySet, firstSend, willSetCopy, region, linkField, linked, campaignUrl, willLink, sync,
  }
}

export type AsanaState = ReturnType<typeof useAsana>
