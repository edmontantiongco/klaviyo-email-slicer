import { useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  CloudUpload,
  Loader2,
  RotateCw,
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
import { useHealth } from '@/hooks/useHealth'
import { useJobSlices } from '@/hooks/useJobStats'
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

async function copy(text: string, what: string) {
  await navigator.clipboard.writeText(text)
  toast.success(`${what} copied`)
}

export function UploadStep({ job }: { job: EmailJob }) {
  const { uploadJob, setStep, patchJob } = useWorkspace()
  const settings = useSettings()
  const health = useHealth()
  const { rows, stats } = useJobSlices(job)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const keyReady = !!settings.klaviyoKey || !!health.data?.klaviyoKeyConfigured
  const allApproved = stats.total > 0 && stats.approved === stats.total
  const allUploaded = stats.total > 0 && stats.uploaded === stats.total
  const pending = stats.total - stats.uploaded
  const uploading = rows.some((r) => r.upload?.status === 'uploading')

  const start = async () => {
    setConfirming(false)
    setBusy(true)
    try {
      await uploadJob(job.id)
      const after = useWorkspace.getState().jobs.find((j) => j.id === job.id)
      const failed = Object.values(after?.uploads ?? {}).filter((u) => u.status === 'error').length
      if (failed) toast.error(`${failed} upload${failed > 1 ? 's' : ''} failed`, { description: 'Check the list below and retry.' })
      else toast.success('All slices uploaded to Klaviyo')
    } finally {
      setBusy(false)
    }
  }

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
                {stats.uploaded}/{stats.total} uploaded · {formatBytes(stats.bytes)} total
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {(busy || uploading) && <Progress value={(stats.uploaded / Math.max(1, stats.total)) * 100} />}
              <div className="divide-y rounded-md border" data-testid="upload-list">
                {rows.map(({ slice, result, upload }) => {
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
                  <Check state={allApproved ? 'ok' : 'fail'}>
                    {stats.approved}/{stats.total} slices approved by you
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
                <Button
                  data-testid="upload-start"
                  size="lg"
                  disabled={!allApproved || !keyReady || busy || (allUploaded && !stats.renamePending)}
                  onClick={() => (allUploaded ? start() : setConfirming(true))}
                >
                  {busy ? <Loader2 className="animate-spin" /> : allUploaded && !stats.renamePending ? <CheckCircle2 /> : stats.uploadErrors ? <RotateCw /> : <CloudUpload />}
                  {allUploaded && stats.renamePending
                    ? `Update ${stats.renamePending} name${stats.renamePending > 1 ? 's' : ''} in Klaviyo`
                    : allUploaded
                    ? 'Uploaded'
                    : stats.uploadErrors
                      ? `Retry ${pending} upload${pending > 1 ? 's' : ''}`
                      : `Upload ${pending} image${pending > 1 ? 's' : ''}`}
                </Button>
                <p className="text-muted-foreground text-xs">Klaviyo allows 100 uploads/min and 500/day per account; the local server paces requests for you.</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <CampaignUpdate job={job} allApproved={allApproved} keyReady={keyReady} />
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload {pending} images to Klaviyo?</DialogTitle>
            <DialogDescription>
              They'll be added to your Klaviyo image library{settings.hideUploadsInLibrary ? ' (hidden)' : ''} named
              after each slice's <b>Name</b> (e.g. “{rows[0] ? klaviyoImageName(job.uploadPrefix, rows[0].slice) : ''}”). You approved every slice; uploads
              can't be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button data-testid="upload-confirm" onClick={start}>
              <CloudUpload /> Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
