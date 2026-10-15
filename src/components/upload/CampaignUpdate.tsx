import { useMemo, useState } from 'react'
import { CheckCircle2, CircleDashed, ExternalLink, Frame, Loader2, Megaphone, RefreshCw, Replace } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useSettings } from '@/store/settings'
import { currentResult, useWorkspace, type EmailJob } from '@/store/workspace'
import { getSlices } from '@/lib/slicing'
import type { CampaignState } from '@/hooks/useCampaign'

interface Props {
  job: EmailJob
  campaign: CampaignState
  keyReady: boolean
  /** Approved slices (the ones that go into the email). */
  approved: number
}

/**
 * Optional: pick the cloned (draft) Klaviyo campaign and where the slices go. The Upload step's
 * Send button does the rest, keeping the email in the drag-and-drop editor.
 */
export function CampaignUpdate({ job, campaign: c, keyReady, approved }: Props) {
  const { patchJob, uploadJob } = useWorkspace()
  const compress = useSettings((s) => s.compress)
  const [swapping, setSwapping] = useState(false)
  const [confirmSwap, setConfirmSwap] = useState(false)
  const { info } = c
  const hasSkeleton = useSettings((s) => !!s.emailSkeleton)
  const canEdit = !!info && !c.problem

  // Slices revised in Figma since they were uploaded (set by "Refresh from Figma").
  const revised = useMemo(() => {
    if (!job.layout || !job.revisions) return []
    return getSlices(job.layout)
      .filter((s) => job.revisions![s.id])
      .map((s) => ({ slice: s, rev: job.revisions![s.id], approved: !!currentResult(job, s, compress)?.approved }))
  }, [job, compress])
  const revisedReady = revised.length > 0 && revised.every((r) => r.approved)

  const swapRevised = async () => {
    if (!info) return
    setConfirmSwap(false)
    setSwapping(true)
    try {
      await uploadJob(job.id) // uploads the approved revisions (and syncs names)
      const after = useWorkspace.getState().jobs.find((j) => j.id === job.id)!
      const swaps = revised.map(({ slice, rev }) => {
        const r = currentResult(after, slice, compress)
        const u = after.uploads[slice.id]
        if (!r || u?.status !== 'done' || u.key !== r.key || !u.url) throw new Error(`“${slice.meta.name}” isn’t uploaded yet — check the slice list above.`)
        return { oldUrl: rev.oldUrl, oldAssetId: rev.oldKlaviyoId, src: u.url, assetId: u.klaviyoId, href: slice.meta.link.trim(), alt: slice.meta.alt.trim() }
      })
      const result = await api.klaviyoSwapCampaignImages({ campaignId: info.campaign.id, swaps, dryRun: false, templateUpdated: info.template.updated })
      const notFound = revised.filter((_, i) => !result.counts[i]).map((r) => r.slice.meta.name)
      const done = revised.length - notFound.length
      // Clear the revisions that were handled; ones not found aren't in this campaign, so clear them too.
      patchJob(job.id, { revisions: {} })
      if (result.applied) {
        c.saveLink({ templateUpdated: result.templateUpdated ?? null })
        c.setInfo({ ...info, template: { ...info.template, id: result.templateId ?? info.template.id, updated: result.templateUpdated ?? null }, summary: result.after ?? info.summary })
      }
      if (done) toast.success(`Updated ${done} revised slice${done === 1 ? '' : 's'} in the campaign`, { description: 'Open it in Klaviyo to check, then send a test.' })
      if (notFound.length)
        toast.warning(`${notFound.join(', ')} ${notFound.length === 1 ? 'isn’t' : 'aren’t'} in this campaign`, {
          description: 'Its old image wasn’t found in the email, so nothing was replaced for it. Use Send to Klaviyo to rebuild the email from the slices.',
        })
    } catch (e) {
      toast.error('Could not update the revised slices', { description: (e as Error).message })
    } finally {
      setSwapping(false)
    }
  }

  const last = job.campaign?.lastUpdate

  return (
    <Card className="gap-4" data-testid="campaign-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4" /> Cloned campaign <span className="text-muted-foreground text-sm font-normal">(optional)</span>
        </CardTitle>
        <CardDescription>
          Paste the link to your cloned <b>draft</b> campaign. <b>Send to Klaviyo</b> then uploads the approved slices and makes them the whole email,
          each as a drag-and-drop image block. Leave it empty to only upload the images.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-72 flex-1 gap-1.5">
            <Label htmlFor="campaign-url">Campaign link</Label>
            <Input
              id="campaign-url"
              placeholder="https://www.klaviyo.com/campaign/01J…/…"
              value={c.url}
              onChange={(e) => c.setUrl(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text')
                if (text.trim() && keyReady) setTimeout(() => c.load(text), 0)
              }}
              onKeyDown={(e) => e.key === 'Enter' && c.url.trim() && c.load()}
            />
          </div>
          <Button variant="outline" onClick={() => c.load()} disabled={!c.url.trim() || c.loading || !keyReady} data-testid="campaign-load">
            {c.loading ? <Loader2 className="animate-spin" /> : info ? <RefreshCw /> : null}
            {info ? 'Reload' : 'Load campaign'}
          </Button>
        </div>

        {revised.length > 0 && (
          <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm" data-testid="campaign-revised">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              <Frame className="size-4" /> {revised.length} slice{revised.length === 1 ? '' : 's'} revised in Figma
            </div>
            <ul className="grid gap-1 text-xs">
              {revised.map(({ slice, approved }) => (
                <li key={slice.id} className="flex items-center gap-1.5">
                  {approved ? <CheckCircle2 className="text-success size-3.5" /> : <CircleDashed className="text-muted-foreground size-3.5" />}
                  <span className="font-medium">{slice.meta.name}</span>
                  <span className="text-muted-foreground">{approved ? 'approved' : 'needs your approval in Optimize & review'}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setConfirmSwap(true)} disabled={!canEdit || !revisedReady || !keyReady || swapping} data-testid="campaign-swap">
                {swapping ? <Loader2 className="animate-spin" /> : <Replace />}
                Update {revised.length} revised slice{revised.length === 1 ? '' : 's'} in campaign
              </Button>
              <span className="text-muted-foreground text-xs">
                {!info ? 'Load the campaign first.' : !revisedReady ? 'Approve the revised slices first.' : 'Only these images change; their position and everything else stay the same.'}
              </span>
            </div>
          </div>
        )}

        {info && (
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{info.campaign.name}</span>
              <Badge variant={info.campaign.editable ? 'success' : 'destructive'}>{info.campaign.status}</Badge>
              <Badge variant={c.editorOk ? 'secondary' : 'destructive'}>{c.editorOk ? 'Drag-and-drop editor' : `${info.template.editorType} editor`}</Badge>
              {info.message.subject && <span className="text-muted-foreground truncate">Subject: {info.message.subject}</span>}
              <a className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs underline" href={c.url} target="_blank" rel="noreferrer">
                Open in Klaviyo <ExternalLink className="size-3" />
              </a>
            </div>

            {c.editorOk && info.summary && (
              <p className="text-sm" data-testid="campaign-plan">
                <span className="text-muted-foreground">
                  Now: {info.summary.sections} section{info.summary.sections === 1 ? '' : 's'}, {info.summary.blocks} block{info.summary.blocks === 1 ? '' : 's'}
                  {info.summary.images.length ? ` (${info.summary.images.length} image${info.summary.images.length === 1 ? '' : 's'})` : ''}.
                </span>{' '}
                <b>Send to Klaviyo</b> removes all of it — header and footer included — and adds your {approved} approved slice{approved === 1 ? '' : 's'}, each
                as a drag-and-drop image block, on the White_BG background.
              </p>
            )}
            {c.editorOk && info.definitionError && (
              <div className="grid gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm" data-testid="campaign-no-layout">
                <span>
                  Klaviyo can’t export this email’s current layout, so the app can’t show what’s in it. That’s fine: <b>Send to Klaviyo</b> replaces all of
                  it with your {approved} approved slice{approved === 1 ? '' : 's'} on the White_BG background.
                </span>
                <span className="text-muted-foreground text-xs">
                  Klaviyo says: “{info.definitionError}”.{' '}
                  {hasSkeleton
                    ? 'The email width and colours from the last campaign that loaded fully are reused.'
                    : 'No earlier campaign settings are saved yet, so a 600px email on white is used.'}
                </span>
              </div>
            )}
          </div>
        )}

        {last && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" data-testid="campaign-done">
            <CheckCircle2 className="text-success size-4" />
            <span>
              Updated {new Date(last.at).toLocaleString()}: the email content is now {last.inserted} slice row{last.inserted === 1 ? '' : 's'}. Send again after
              changing slices.
            </span>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmSwap} onOpenChange={setConfirmSwap}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Update {revised.length} revised slice{revised.length === 1 ? '' : 's'} in “{info?.campaign.name}”?
            </DialogTitle>
            <DialogDescription>
              The new version{revised.length === 1 ? ' is' : 's are'} uploaded, then each old image in the draft is replaced in place:{' '}
              {revised.map((r) => r.slice.meta.name).join(', ')}. Nothing else in the email changes, and nothing is scheduled or sent. This can’t be undone
              from the app.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSwap(false)}>Cancel</Button>
            <Button onClick={swapRevised} data-testid="campaign-swap-confirm">
              <Replace /> Update in campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
