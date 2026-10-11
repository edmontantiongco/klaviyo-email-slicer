import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, Eye, Frame, Loader2, MapPin, Megaphone, RefreshCw, Replace, Trash2, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type CampaignInfo, type CampaignReplaceResult } from '@/lib/api'
import { campaignRows, defaultSelection, describePlan } from '@/lib/campaign'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { currentResult, useWorkspace, type CampaignLink, type EmailJob } from '@/store/workspace'
import { getSlices } from '@/lib/slicing'

interface Props {
  job: EmailJob
  allApproved: boolean
  keyReady: boolean
}

/**
 * Replaces the images of a cloned (draft) Klaviyo campaign with this job's slices,
 * keeping the email in the drag-and-drop editor.
 */
export function CampaignUpdate({ job, allApproved, keyReady }: Props) {
  const { patchJob, uploadJob } = useWorkspace()
  const compress = useSettings((s) => s.compress)
  const [url, setUrl] = useState(job.campaign?.url ?? '')
  const [info, setInfo] = useState<CampaignInfo | null>(null)
  const [selected, setSelected] = useState<string[]>(job.campaign?.selectedKeys ?? [])
  const [preview, setPreview] = useState<{ result: CampaignReplaceResult; sig: string } | null>(null)
  const [busy, setBusy] = useState<null | 'load' | 'preview' | 'apply' | 'remove' | 'swap'>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmSwap, setConfirmSwap] = useState(false)

  const { rows, missingUploads } = useMemo(() => campaignRows(job, compress), [job, compress])
  // Spot left by "Remove from campaign" — used when no images are ticked.
  const placement = info && job.campaign?.campaignId === info.campaign.id ? job.campaign?.placement : undefined
  const placementEdited = !!placement && placement.templateUpdated !== info?.template.updated
  const useSelection = selected.length > 0
  const sig = JSON.stringify([info?.template.updated, selected, placement?.at, rows.map((r) => r.cells.map((c) => [c.fraction, c.href, c.alt]))])
  const previewCurrent = preview?.sig === sig
  const saveLink = (patch: Partial<CampaignLink>) => {
    const current = useWorkspace.getState().jobs.find((j) => j.id === job.id)?.campaign
    patchJob(job.id, { campaign: { url, ...current, ...patch } })
  }

  const images = info?.summary?.images ?? []
  const editorOk = info?.template.editorType === 'SYSTEM_DRAGGABLE'
  const canEdit = !!info && info.campaign.editable && editorOk

  const load = async () => {
    setBusy('load')
    setPreview(null)
    try {
      const res = await api.klaviyoResolveCampaign(url.trim())
      setInfo(res)
      const keys = new Set((res.summary?.images ?? []).map((i) => i.key))
      const sameCampaign = job.campaign?.campaignId === res.campaign.id
      const kept = sameCampaign ? (job.campaign?.selectedKeys ?? []).filter((k) => keys.has(k)) : []
      const hasPlacement = sameCampaign && !!job.campaign?.placement
      const sel = kept.length || hasPlacement ? kept : defaultSelection(res.summary?.images ?? [])
      setSelected(sel)
      saveLink({ url: url.trim(), campaignId: res.campaign.id, campaignName: res.campaign.name, templateUpdated: res.template.updated, selectedKeys: sel })
    } catch (e) {
      setInfo(null)
      toast.error('Could not load the campaign', { description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const toggle = (key: string, on: boolean) => {
    const next = on ? [...selected, key] : selected.filter((k) => k !== key)
    setSelected(next)
    saveLink({ selectedKeys: next })
  }

  const runPreview = async () => {
    if (!info) return
    setBusy('preview')
    try {
      const result = await api.klaviyoReplaceCampaignImages({
        campaignId: info.campaign.id,
        removeKeys: selected,
        rows,
        dryRun: true,
        templateUpdated: info.template.updated,
        anchor: useSelection ? undefined : placement?.anchor,
      })
      setPreview({ result, sig })
    } catch (e) {
      toast.error('Preview failed', { description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!info) return
    setConfirming(false)
    setBusy('apply')
    try {
      // Uploads anything missing and brings Klaviyo image names in line with the slice names (no-op otherwise).
      await uploadJob(job.id)
      const after = useWorkspace.getState().jobs.find((j) => j.id === job.id)!
      const again = campaignRows(after, compress)
      if (again.missingUploads) throw new Error(`${again.missingUploads} slice upload(s) failed — retry them in the list above, then update the campaign.`)
      const toSend = again.rows
      const result = await api.klaviyoReplaceCampaignImages({
        campaignId: info.campaign.id,
        removeKeys: selected,
        rows: toSend,
        dryRun: false,
        templateUpdated: info.template.updated,
        anchor: useSelection ? undefined : placement?.anchor,
      })
      saveLink({
        templateUpdated: result.templateUpdated,
        selectedKeys: [],
        placement: undefined,
        // Count images removed earlier with "Remove from campaign" when the slices went into their spot.
        lastUpdate: { at: Date.now(), removed: result.removed || (useSelection ? 0 : (placement?.removed ?? 0)), inserted: result.inserted, method: result.method! },
      })
      setInfo({ ...info, template: { ...info.template, id: result.templateId ?? info.template.id, updated: result.templateUpdated ?? null }, summary: result.after ?? info.summary })
      setSelected([])
      setPreview(null)
      toast.success('Campaign updated in Klaviyo', {
        description: `${result.removed ? `Replaced ${result.removed} image${result.removed === 1 ? '' : 's'} with` : 'Added'} ${result.inserted} slice row${result.inserted === 1 ? '' : 's'}. Open it in Klaviyo to check, then send a test.`,
      })
    } catch (e) {
      toast.error('Campaign update failed', { description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

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
    setBusy('swap')
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
        saveLink({ templateUpdated: result.templateUpdated ?? null })
        setInfo({ ...info, template: { ...info.template, id: result.templateId ?? info.template.id, updated: result.templateUpdated ?? null }, summary: result.after ?? info.summary })
      }
      if (done) toast.success(`Updated ${done} revised slice${done === 1 ? '' : 's'} in the campaign`, { description: 'Open it in Klaviyo to check, then send a test.' })
      if (notFound.length)
        toast.warning(`${notFound.join(', ')} ${notFound.length === 1 ? 'isn’t' : 'aren’t'} in this campaign`, {
          description: 'Its old image wasn’t found in the email, so nothing was replaced for it. Use Update campaign to add it.',
        })
    } catch (e) {
      toast.error('Could not update the revised slices', { description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const removeNow = async () => {
    if (!info) return
    setConfirmRemove(false)
    setBusy('remove')
    try {
      const result = await api.klaviyoRemoveCampaignImages({ campaignId: info.campaign.id, removeKeys: selected, dryRun: false, templateUpdated: info.template.updated })
      saveLink({
        templateUpdated: result.templateUpdated,
        selectedKeys: [],
        placement: { anchor: result.anchor, removed: result.removed, at: Date.now(), templateUpdated: result.templateUpdated ?? null },
      })
      setInfo({ ...info, template: { ...info.template, id: result.templateId ?? info.template.id, updated: result.templateUpdated ?? null }, summary: result.after ?? info.summary })
      setSelected([])
      setPreview(null)
      toast.success(`Removed ${result.removed} image${result.removed === 1 ? '' : 's'} from the campaign`, {
        description: `The slices will go there when you update the campaign (${result.anchor.label}).`,
      })
    } catch (e) {
      toast.error('Could not remove the images', { description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const last = job.campaign?.lastUpdate
  const blockers: string[] = []
  if (!keyReady) blockers.push('Add a Klaviyo API key')
  if (!allApproved) blockers.push('Approve every slice first')
  if (info && !info.campaign.editable) blockers.push(`Campaign is ${info.campaign.status} — only Draft campaigns can be edited`)
  if (info && !editorOk) blockers.push('This email is not built with the drag-and-drop editor')
  if (info && !selected.length && !placement) blockers.push('Tick the images to replace, or remove them first')

  return (
    <Card className="gap-4" data-testid="campaign-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4" /> Update cloned campaign
        </CardTitle>
        <CardDescription>
          Paste the link to your cloned <b>draft</b> campaign. The old images are removed and these slices are added in their place as drag-and-drop image
          blocks, so the email stays editable in Klaviyo's drag-and-drop editor. Text, buttons, header and footer stay as they are.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-72 flex-1 gap-1.5">
            <Label htmlFor="campaign-url">Campaign link</Label>
            <Input
              id="campaign-url"
              placeholder="https://www.klaviyo.com/campaign/01J…/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && load()}
            />
          </div>
          <Button variant="outline" onClick={load} disabled={!url.trim() || !!busy || !keyReady} data-testid="campaign-load">
            {busy === 'load' ? <Loader2 className="animate-spin" /> : info ? <RefreshCw /> : null}
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
              <Button
                size="sm"
                onClick={() => setConfirmSwap(true)}
                disabled={!canEdit || !revisedReady || !keyReady || !!busy}
                data-testid="campaign-swap"
              >
                {busy === 'swap' ? <Loader2 className="animate-spin" /> : <Replace />}
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
              <Badge variant={editorOk ? 'secondary' : 'destructive'}>{editorOk ? 'Drag-and-drop editor' : `${info.template.editorType} editor`}</Badge>
              {info.message.subject && <span className="text-muted-foreground truncate">Subject: {info.message.subject}</span>}
              <a className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs underline" href={url} target="_blank" rel="noreferrer">
                Open in Klaviyo <ExternalLink className="size-3" />
              </a>
            </div>

            {editorOk && (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {images.length} image block{images.length === 1 ? '' : 's'} found · <b className="text-foreground">{selected.length} selected</b>
                  </span>
                  <div className="flex gap-2">
                    <button className="underline" onClick={() => { setSelected(images.map((i) => i.key)); saveLink({ selectedKeys: images.map((i) => i.key) }) }}>All</button>
                    <button className="underline" onClick={() => { setSelected([]); saveLink({ selectedKeys: [] }) }}>None</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="campaign-images">
                  {images.map((im) => {
                    const on = selected.includes(im.key)
                    return (
                      <label
                        key={im.key}
                        className={cn('grid cursor-pointer gap-1.5 rounded-md border p-2 text-xs transition', on ? 'border-destructive/60 bg-destructive/5' : 'opacity-80 hover:opacity-100')}
                      >
                        <div className="checkerboard relative flex h-20 items-center justify-center overflow-hidden rounded">
                          {im.src && <img src={im.src} alt="" className={cn('max-h-full max-w-full object-contain', on && 'opacity-50')} loading="lazy" />}
                          {on && <span className="bg-destructive absolute top-1 right-1 rounded px-1 text-[10px] font-medium text-white">selected</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Checkbox checked={on} onCheckedChange={(v) => toggle(im.key, v === true)} />
                          <span className="font-medium">
                            Section {im.section + 1} · Row {im.row + 1}
                            {im.columnsInRow > 1 ? ` · Col ${im.column + 1}` : ''}
                          </span>
                        </div>
                        <div className="text-muted-foreground truncate" title={im.href}>{im.href || 'no link'}</div>
                        {im.universal && <Badge variant="outline" className="w-fit">Universal block</Badge>}
                      </label>
                    )
                  })}
                </div>
                <p className="text-muted-foreground text-xs">
                  Tick images, then <b>Remove from campaign</b> to delete them from the draft now, or <b>Update campaign</b> to replace them with the slices in one go. The header image (logo) and universal blocks aren’t ticked by default.
                </p>
              </>
            )}
          </div>
        )}

        {placement && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" data-testid="campaign-placement">
            <MapPin className="size-4 shrink-0" />
            <span>
              Removed {placement.removed} image{placement.removed === 1 ? '' : 's'} {new Date(placement.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.{' '}
              {useSelection ? (
                <span className="text-muted-foreground">Ticked images take priority: the slices go where the first ticked image is.</span>
              ) : (
                <>
                  The slices will go where {placement.removed === 1 ? 'it was' : 'they were'}: <b>{placement.anchor.label}</b>.
                </>
              )}
            </span>
            {placementEdited && !useSelection && (
              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5" /> The email was edited in Klaviyo since, so check the preview.
              </span>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => saveLink({ placement: undefined })} title="Forget this spot">
              <X /> Forget
            </Button>
          </div>
        )}

        {preview && previewCurrent && (
          <div className="grid gap-1.5 rounded-lg border border-dashed p-3 text-sm" data-testid="campaign-preview">
            <div className="flex items-center gap-2 font-medium">
              <Eye className="size-4" /> Planned change
            </div>
            <div>
              {preview.result.removed > 0 && (
                <>
                  Remove <b>{preview.result.removed}</b> image{preview.result.removed === 1 ? '' : 's'}, then insert{' '}
                </>
              )}
              {preview.result.removed === 0 && <>Insert </>}
              <b>{preview.result.inserted}</b> slice row
              {preview.result.inserted === 1 ? '' : 's'} ({describePlan(preview.result.rows)}) at section {preview.result.insertedAt.section + 1}, row{' '}
              {preview.result.insertedAt.row + 1}, {preview.result.contentWidth}px wide.
            </div>
            {preview.result.warnings.map((w) => (
              <div key={w} className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
              </div>
            ))}
          </div>
        )}

        {info && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmRemove(true)}
              disabled={!canEdit || !selected.length || !!busy}
              data-testid="campaign-remove"
            >
              {busy === 'remove' ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {selected.length ? `Remove ${selected.length} image${selected.length === 1 ? '' : 's'} from campaign` : 'Remove from campaign'}
            </Button>
            <div className="bg-border mx-1 h-6 w-px" />
            <Button variant="outline" onClick={runPreview} disabled={!canEdit || (!selected.length && !placement) || !!busy} data-testid="campaign-preview-btn">
              {busy === 'preview' ? <Loader2 className="animate-spin" /> : <Eye />} Preview changes
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!canEdit || !previewCurrent || blockers.length > 0 || !!busy} data-testid="campaign-apply">
              {busy === 'apply' ? <Loader2 className="animate-spin" /> : <Replace />}
              {missingUploads ? 'Upload slices & update campaign' : 'Update campaign'}
            </Button>
            {!previewCurrent && canEdit && (selected.length > 0 || !!placement) && <span className="text-muted-foreground text-xs">Preview the change before updating.</span>}
            {blockers.length > 0 && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <XCircle className="size-3.5" /> {blockers[0]}
              </span>
            )}
          </div>
        )}

        {last && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" data-testid="campaign-done">
            <CheckCircle2 className="text-success size-4" />
            <span>
              Updated {new Date(last.at).toLocaleString()}: {last.removed} image{last.removed === 1 ? '' : 's'} replaced by {last.inserted} slice row
              {last.inserted === 1 ? '' : 's'}.
            </span>
          </div>
        )}
      </CardContent>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update “{info?.campaign.name}”?</DialogTitle>
            <DialogDescription>
              {missingUploads ? `${missingUploads} slice${missingUploads === 1 ? '' : 's'} will be uploaded first. ` : ''}
              {preview?.result.removed
                ? `${preview.result.removed} image${preview.result.removed === 1 ? '' : 's'} will be removed from the draft and replaced by `
                : 'The draft will get '}
              {preview?.result.inserted} slice row{preview?.result.inserted === 1 ? '' : 's'}. This can’t be undone from the app. Nothing is scheduled or sent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button onClick={apply} data-testid="campaign-confirm">
              <Replace /> Update campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove {selected.length} image{selected.length === 1 ? '' : 's'} from “{info?.campaign.name}”?
            </DialogTitle>
            <DialogDescription>
              {selected.length === 1 ? 'It is' : 'They are'} deleted from the draft in Klaviyo right away, and this can’t be undone from the app. The app remembers
              where {selected.length === 1 ? 'it was' : 'they were'}, so <b>Update campaign</b> puts the slices in the same spot. Nothing is scheduled or sent.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {images
              .filter((im) => selected.includes(im.key))
              .map((im) => (
                <div key={im.key} className="checkerboard flex h-16 w-24 items-center justify-center overflow-hidden rounded border" title={`Section ${im.section + 1} · Row ${im.row + 1}`}>
                  {im.src && <img src={im.src} alt="" className="max-h-full max-w-full object-contain" />}
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>Cancel</Button>
            <Button variant="destructive" onClick={removeNow} data-testid="campaign-remove-confirm">
              <Trash2 /> Remove from campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
