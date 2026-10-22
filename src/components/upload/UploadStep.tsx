import { useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  CloudUpload,
  Loader2,
  Plus,
  RotateCw,
  Send,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsDialog } from '@/components/layout/SettingsDialog'
import { CampaignUpdate } from '@/components/upload/CampaignUpdate'
import { RefreshFromFigmaButton } from '@/components/common/FigmaSync'
import { useCampaign } from '@/hooks/useCampaign'
import { useHealth } from '@/hooks/useHealth'
import { useJobSlices } from '@/hooks/useJobStats'
import type { CampaignReplaceResult } from '@/lib/api'
import type { SwapResult } from '@/hooks/useCampaign'
import { campaignRows, describePlan } from '@/lib/campaign'
import { updateCell } from '@/lib/slicing'
import { klaviyoImageName, sliceFileName, sliceIndexLabel } from '@/lib/naming'
import { cn, formatBytes, slugify } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { useWorkspace, type EmailJob } from '@/store/workspace'

function Check({ state, children }: { state: 'ok' | 'warn' | 'fail'; children: React.ReactNode }) {
  const Icon = state === 'ok' ? CheckCircle2 : state === 'warn' ? AlertTriangle : XCircle
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={cn('mt-0.5 size-4 shrink-0', state === 'ok' ? 'text-success' : state === 'warn' ? 'text-amber-500' : 'text-destructive')} />
      <span>{children}</span>
    </li>
  )
}

/** Klaviyo refused a direct update, so the email was re-attached as a copy: say what that changes. */
function warnIfCopied(updateRefused?: string) {
  if (!updateRefused) return
  toast.warning('Klaviyo saved this as a copy of the email', {
    description: `It refused a direct update (“${updateRefused}”). Content is the same, but saved (universal) blocks like the footer are now regular blocks in this email.`,
    duration: 30000,
    closeButton: true,
  })
}

async function copy(text: string, what: string) {
  await navigator.clipboard.writeText(text)
  toast.success(`${what} copied`)
}

export function UploadStep({ job }: { job: EmailJob }) {
  const { uploadJob, setStep, patchJob, setLayout, setView } = useWorkspace()
  const settings = useSettings()
  const health = useHealth()
  const { rows, stats } = useJobSlices(job)
  const [busy, setBusy] = useState(false)
  /** The review shown before anything is sent; `plan` is the campaign change (dry run). */
  const [review, setReview] = useState<null | { loading: boolean; plan?: CampaignReplaceResult; swap?: SwapResult; error?: string }>(null)

  const keyReady = !!settings.klaviyoKey || !!health.data?.klaviyoKeyConfigured
  const campaign = useCampaign(job, keyReady)
  const allApproved = stats.total > 0 && stats.approved === stats.total
  const allUploaded = stats.total > 0 && stats.uploaded === stats.total
  // Only approved slices upload; unapproved ones wait until they're approved.
  const pending = stats.toUpload
  const nothingToUpload = pending === 0
  // Unapproved slices aren't uploaded, so they're left out of the list (already-uploaded ones stay).
  const shown = rows.filter((r) => r.upload || r.result?.approved)
  const hidden = rows.length - shown.length
  /** Deleted from the app when sending, so only approved slices remain. */
  const unapproved = rows.filter((r) => !r.result?.approved)
  const uploading = rows.some((r) => r.upload?.status === 'uploading')
  const mode = campaign.mode
  const toCampaign = mode !== null
  const revisedCount = campaign.revised.length
  // Swapping needs the email's layout from Klaviyo, and every revised slice approved first.
  const reviseBlocked =
    mode === 'revise' &&
    (campaign.info?.definitionError
      ? 'Klaviyo can’t export this email, so single images can’t be swapped — fix the header block in Klaviyo and reload'
      : campaign.revised.some((r) => !r.approved)
        ? 'Approve the revised slices in Optimize & review first'
        : null)
  /** Every approved slice is in Klaviyo: offer to move on to the next email. */
  const sent = stats.approved > 0 && nothingToUpload && !stats.renamePending && !busy
  const canSend =
    stats.approved > 0 && stats.working === 0 && keyReady && !busy && !campaign.loading && !reviseBlocked && (toCampaign || !nothingToUpload || stats.renamePending > 0)

  const openReview = async () => {
    if (!toCampaign) return setReview({ loading: false })
    setReview({ loading: true })
    try {
      if (mode === 'revise') setReview({ loading: false, swap: await campaign.swap(null, true) })
      else setReview({ loading: false, plan: await campaign.replace(campaignRows(job, settings.compress).rows, true) })
    } catch (e) {
      setReview({ loading: false, error: (e as Error).message })
    }
  }

  /** Uploads the approved slices (and syncs renamed ones), then updates the campaign if one is set up. */
  const send = async () => {
    setReview(null)
    setBusy(true)
    try {
      if (unapproved.length && job.layout) {
        let layout = job.layout
        for (const r of unapproved) layout = updateCell(layout, r.slice.id, { deleted: true })
        setLayout(job.id, layout, { history: true })
      }
      await uploadJob(job.id)
      const after = useWorkspace.getState().jobs.find((j) => j.id === job.id)!
      const failed = Object.values(after.uploads).filter((u) => u.status === 'error').length
      if (failed) {
        toast.error(`${failed} upload${failed > 1 ? 's' : ''} failed`, { description: `Check the list below and retry.${toCampaign ? ' The campaign was not changed.' : ''}` })
        return
      }
      if (!toCampaign) {
        toast.success('Approved slices uploaded to Klaviyo', unapproved.length ? { description: `Deleted ${unapproved.length} unapproved slice${unapproved.length > 1 ? 's' : ''} from the app.` } : undefined)
        return
      }
      if (mode === 'revise') {
        const names = campaign.revised.map((r) => r.slice.meta.name)
        const result = await campaign.swap(after, false)
        campaign.swapped(result)
        warnIfCopied(result.updateRefused)
        const notFound = names.filter((_, i) => !result.counts[i])
        const done = names.length - notFound.length
        if (done) toast.success(`Updated ${done} revised slice${done === 1 ? '' : 's'} in the campaign`, { description: 'Everything else in the email stayed the same. Open it in Klaviyo to check, then send a test.' })
        if (notFound.length)
          toast.warning(`${notFound.join(', ')} ${notFound.length === 1 ? 'isn’t' : 'aren’t'} in this campaign`, {
            description: 'Its old image wasn’t found in the email, so nothing was replaced for it. Add the new image in Klaviyo from the image library.',
            duration: 30000,
            closeButton: true,
          })
        return
      }
      const { rows: sliceRows, missingUploads } = campaignRows(after, settings.compress)
      if (missingUploads) throw new Error(`${missingUploads} slice upload(s) are missing — retry them in the list above. The campaign was not changed.`)
      const result = await campaign.replace(sliceRows, false)
      campaign.applied(result)
      warnIfCopied(result.updateRefused)
      toast.success('Sent to Klaviyo', {
        description: `The email is now ${result.inserted} slice row${result.inserted === 1 ? '' : 's'}. Open the campaign in Klaviyo to check, then send a test.`,
      })
    } catch (e) {
      toast.error('Could not update the campaign', { description: (e as Error).message, duration: 30000, closeButton: true })
    } finally {
      setBusy(false)
    }
  }

  const sendLabel =
    mode === 'revise'
      ? `Update ${revisedCount} revised slice${revisedCount > 1 ? 's' : ''} in campaign`
      : toCampaign
    ? nothingToUpload
      ? campaign.rebuild ? 'Rebuild email' : 'Update campaign'
      : `Upload ${pending} image${pending > 1 ? 's' : ''} & ${campaign.rebuild ? 'rebuild email' : 'update campaign'}`
    : nothingToUpload && stats.renamePending
      ? `Update ${stats.renamePending} name${stats.renamePending > 1 ? 's' : ''} in Klaviyo`
      : nothingToUpload
        ? allUploaded ? 'Uploaded' : 'Approved slices uploaded'
        : stats.uploadErrors
          ? `Retry ${pending} upload${pending > 1 ? 's' : ''}`
          : `Upload ${pending} image${pending > 1 ? 's' : ''}`

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-6xl gap-6 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setStep(job.id, 'optimize')}>
            <ArrowLeft /> Review
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Upload “{job.name}” to Klaviyo</h1>
          <RefreshFromFigmaButton job={job} className="ml-auto" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle className="text-base">Slices</CardTitle>
              <CardDescription>
                {stats.uploaded}/{shown.length} uploaded · {formatBytes(shown.reduce((a, r) => a + (r.result?.size ?? 0), 0))} total
                {hidden > 0 && ` · ${hidden} unapproved slice${hidden > 1 ? 's' : ''} hidden (deleted when you send)`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {(busy || uploading) && <Progress value={(stats.uploaded / Math.max(1, shown.length)) * 100} />}
              <div className="divide-y rounded-md border" data-testid="upload-list">
                {shown.map(({ slice, result, upload }) => {
                  // Shown exactly as it will be (or is) named in Klaviyo.
                  const fileName = klaviyoImageName(job.uploadPrefix, slice)
                  const renamePending = upload?.status === 'done' && upload.name !== fileName
                  return (
                    <div key={slice.id} className="flex items-center gap-3 p-2">
                      <div className="checkerboard flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded border">
                        {result?.url && <img src={result.url} alt="" className="max-h-full max-w-full object-contain" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground font-mono text-xs">{sliceIndexLabel(slice)}</span>
                          <span className="truncate text-xs font-medium" title="Name in Klaviyo">{fileName}</span>
                          {renamePending && <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">name changed — sync to Klaviyo</span>}
                        </div>
                        {upload?.status === 'done' && upload.url ? (
                          <button className="text-muted-foreground hover:text-foreground block max-w-full truncate text-left text-xs" onClick={() => copy(upload.url!, 'Image URL')}>
                            {upload.url}
                          </button>
                        ) : upload?.status === 'error' ? (
                          <div className="text-destructive truncate text-xs">{upload.error}</div>
                        ) : (
                          <div className="text-muted-foreground text-xs">
                            {result?.size ? formatBytes(result.size) : ''} {slice.meta.link ? `→ ${slice.meta.link}` : ''}
                          </div>
                        )}
                      </div>
                      {upload?.status === 'done' ? (
                        <CheckCircle2 className="text-success size-4 shrink-0" />
                      ) : upload?.status === 'uploading' ? (
                        <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                      ) : upload?.status === 'error' ? (
                        <XCircle className="text-destructive size-4 shrink-0" />
                      ) : (
                        <CircleDashed className="text-muted-foreground size-4 shrink-0" />
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <div className="grid content-start gap-6">
            <Card className="gap-4">
              <CardHeader>
                <CardTitle className="text-base">Pre-flight checks</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <ul className="grid gap-2" data-testid="preflight">
                  <Check state={allApproved ? 'ok' : stats.approved ? 'warn' : 'fail'}>
                    {stats.approved}/{stats.total} slices approved by you{!allApproved && stats.approved > 0 && ' — unapproved ones are deleted when you send'}
                  </Check>
                  <Check state={stats.overBudget ? 'warn' : 'ok'}>
                    {stats.overBudget ? `${stats.overBudget} over the ${formatBytes(settings.compress.maxBytes)} target` : `All within ${formatBytes(settings.compress.maxBytes)}`} (Klaviyo max 5 MB)
                  </Check>
                  <Check state={stats.missingLinks ? 'warn' : 'ok'}>
                    {stats.missingLinks ? `${stats.missingLinks} slices have no link` : 'Every slice is linked'}
                  </Check>
                  <Check state={stats.missingAlt ? 'warn' : 'ok'}>
                    {stats.missingAlt ? `${stats.missingAlt} slices have no alt text` : 'Every slice has alt text'}
                  </Check>
                  <Check state={keyReady ? 'ok' : 'fail'}>
                    {keyReady ? 'Klaviyo API key configured' : 'Klaviyo API key missing'}
                    {!keyReady && (
                      <SettingsDialog trigger={<button className="ml-1 underline">Add key</button>} />
                    )}
                  </Check>
                  {campaign.info && (
                    <Check state={campaign.problem ? 'fail' : 'ok'}>
                      {campaign.problem ?? `Campaign ready: “${campaign.info.campaign.name}” (draft, drag-and-drop)`}
                    </Check>
                  )}
                </ul>
                <div className="grid gap-1.5">
                  <Label htmlFor="prefix">ZIP / HTML file name prefix</Label>
                  <Input
                    id="prefix"
                    value={job.uploadPrefix}
                    onChange={(e) => patchJob(job.id, { uploadPrefix: slugify(e.target.value) || '' })}
                    disabled={busy}
                  />
                  <p className="text-muted-foreground text-xs">
                    e.g. <code>{rows[0] ? sliceFileName(job.uploadPrefix, rows[0].slice, 'jpg') : '—'}</code>. In Klaviyo, each image is named exactly
                    like its slice (the <b>Name</b> field), e.g. <b>{rows[0] ? klaviyoImageName(job.uploadPrefix, rows[0].slice) : '—'}</b>.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <CampaignUpdate job={job} campaign={campaign} keyReady={keyReady} approved={stats.approved} />

        <Card className="gap-3" data-testid="send-card">
          <CardContent className="flex flex-wrap items-center gap-4">
            <div className="min-w-60 flex-1 text-sm">
              <div className="font-medium">Send to Klaviyo</div>
              <div className="text-muted-foreground text-xs">
                {!stats.approved
                  ? 'Approve at least one slice in Optimize & review first.'
                  : reviseBlocked
                    ? `${reviseBlocked}.`
                    : `${nothingToUpload ? 'Approved slices are uploaded' : `Uploads ${pending} approved image${pending > 1 ? 's' : ''}`}${mode === 'revise' ? ', then swaps just the revised slices in the campaign' : mode === 'build' ? (campaign.rebuild ? ', then rebuilds the whole campaign email' : ', then makes them the campaign’s email') : ''}. You’ll review everything before it’s sent. Klaviyo allows 100 uploads/min and 500/day; the local server paces requests for you.`}
              </div>
            </div>
            {sent && (
              <Button data-testid="start-another" size="lg" variant="outline" onClick={() => setView('import')}>
                <Plus /> Start another email
              </Button>
            )}
            <Button data-testid="upload-start" size="lg" disabled={!canSend} onClick={() => (!toCampaign && nothingToUpload && !unapproved.length ? send() : openReview())}>
              {busy ? <Loader2 className="animate-spin" /> : !canSend && nothingToUpload ? <CheckCircle2 /> : toCampaign ? <Send /> : stats.uploadErrors ? <RotateCw /> : <CloudUpload />}
              {sendLabel}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to Klaviyo?</DialogTitle>
            <DialogDescription>Check what will happen. Nothing is scheduled or sent to subscribers, and it can’t be undone from the app.</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2" data-testid="send-review">
            <Check state="ok">
              {nothingToUpload
                ? 'Approved slices are already uploaded'
                : `Upload ${pending} approved image${pending > 1 ? 's' : ''} to your Klaviyo library${settings.hideUploadsInLibrary ? ' (hidden)' : ''}, named after each slice (e.g. “${shown[0] ? klaviyoImageName(job.uploadPrefix, shown[0].slice) : ''}”)`}
            </Check>
            {stats.renamePending > 0 && <Check state="ok">Rename {stats.renamePending} image{stats.renamePending > 1 ? 's' : ''} in Klaviyo to match the slice names</Check>}
            {unapproved.length > 0 && (
              <Check state="warn">
                Delete {unapproved.length} unapproved slice{unapproved.length > 1 ? 's' : ''} from the app ({unapproved.map((r) => r.slice.meta.name).join(', ')}) — undo in the
                Slice step if needed
              </Check>
            )}
            {toCampaign &&
              (review?.loading ? (
                <li className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Checking the campaign…
                </li>
              ) : review?.error ? (
                <Check state="fail">{review.error}</Check>
              ) : review?.plan ? (
                <>
                  <Check state="ok">
                    In “{campaign.info?.campaign.name}”:{' '}
{campaign.info?.definitionError
                      ? 'rebuild the whole email'
                      : `remove all ${review.plan.removed} block${review.plan.removed === 1 ? '' : 's'} (header and footer included) and replace them`}{' '}
                    with {review.plan.inserted} slice row
                    {review.plan.inserted === 1 ? '' : 's'} ({describePlan(review.plan.rows)}), {review.plan.contentWidth}px wide
                  </Check>
                  {review.plan.background && <Check state="ok">Section background image: “{review.plan.background}” from your Klaviyo library</Check>}
                  {review.plan.warnings.map((w) => (
                    <Check key={w} state="warn">
                      {w}
                    </Check>
                  ))}
                </>
              ) : review?.swap ? (
                <>
                  <Check state="ok">
                    In “{campaign.info?.campaign.name}”: swap the image of {campaign.revised.filter((_, i) => review.swap!.counts[i]).map((r) => `“${r.slice.meta.name}”`).join(', ') || 'no slices'}{' '}
                    in place. Everything else in the email — text, timer, footer and anything you added in Klaviyo — stays as it is.
                  </Check>
                  {campaign.revised.some((_, i) => !review.swap!.counts[i]) && (
                    <Check state="warn">
                      Not found in the email, so not swapped:{' '}
                      {campaign.revised
                        .filter((_, i) => !review.swap!.counts[i])
                        .map((r) => `“${r.slice.meta.name}”`)
                        .join(', ')}
                      . Add the new image in Klaviyo from the image library.
                    </Check>
                  )}
                </>
              ) : null)}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button data-testid="upload-confirm" onClick={send} disabled={toCampaign && (!(review?.plan || review?.swap) || review.loading)}>
              {toCampaign ? <Send /> : <CloudUpload />} {toCampaign ? 'Send to Klaviyo' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
