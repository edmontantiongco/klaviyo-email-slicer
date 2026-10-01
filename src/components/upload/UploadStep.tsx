import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  ClipboardCopy,
  CloudUpload,
  Download,
  ExternalLink,
  FileCode2,
  Loader2,
  RotateCw,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { SettingsDialog } from '@/components/layout/SettingsDialog'
import { BackgroundPicker } from '@/components/common/BackgroundPicker'
import { useHealth } from '@/hooks/useHealth'
import { useJobSlices } from '@/hooks/useJobStats'
import { api } from '@/lib/api'
import { downloadBlob, emailHtml, emailSnippet } from '@/lib/exporters'
import { sliceFileName, sliceIndexLabel } from '@/lib/naming'
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
  const [templateName, setTemplateName] = useState(job.template?.name ?? job.name)
  const [creating, setCreating] = useState(false)

  const keyReady = !!settings.klaviyoKey || !!health.data?.klaviyoKeyConfigured
  const allApproved = stats.total > 0 && stats.approved === stats.total
  const allUploaded = stats.total > 0 && stats.uploaded === stats.total
  const pending = stats.total - stats.uploaded
  const uploading = rows.some((r) => r.upload?.status === 'uploading')

  const html = useMemo(() => emailHtml(job, 'klaviyo'), [job])
  const snippet = useMemo(() => emailSnippet(job, 'klaviyo'), [job])

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

  const createTemplate = async () => {
    setCreating(true)
    try {
      const t = await api.klaviyoCreateTemplate(templateName.trim() || job.name, html, settings.templateEditorType)
      patchJob(job.id, { template: { id: t.id, name: t.name, createdAt: Date.now() } })
      toast.success('Template created in Klaviyo', { description: `${t.name} (${t.id})` })
    } catch (e) {
      toast.error('Template creation failed', { description: (e as Error).message })
    } finally {
      setCreating(false)
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
                  const fileName = upload?.fileName ?? sliceFileName(job.uploadPrefix, slice, result?.format === 'png' ? 'png' : 'jpg')
                  return (
                    <div key={slice.id} className="flex items-center gap-3 p-2">
                      <div className="checkerboard flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded border">
                        {result?.url && <img src={result.url} alt="" className="max-h-full max-w-full object-contain" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground font-mono text-xs">{sliceIndexLabel(slice)}</span>
                          <span className="truncate font-mono text-xs">{fileName}</span>
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
                  <Label htmlFor="prefix">File name prefix</Label>
                  <Input
                    id="prefix"
                    value={job.uploadPrefix}
                    onChange={(e) => patchJob(job.id, { uploadPrefix: slugify(e.target.value) || '' })}
                    disabled={busy}
                  />
                  <p className="text-muted-foreground text-xs">
                    e.g. <code>{rows[0] ? sliceFileName(job.uploadPrefix, rows[0].slice, 'jpg') : '—'}</code>
                  </p>
                </div>
                <Button
                  data-testid="upload-start"
                  size="lg"
                  disabled={!allApproved || !keyReady || busy || allUploaded}
                  onClick={() => setConfirming(true)}
                >
                  {busy ? <Loader2 className="animate-spin" /> : allUploaded ? <CheckCircle2 /> : stats.uploadErrors ? <RotateCw /> : <CloudUpload />}
                  {allUploaded
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

        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCode2 className="size-4" /> Email HTML
            </CardTitle>
            <CardDescription>
              {allUploaded
                ? 'Uses the Klaviyo-hosted image URLs. Paste into a template, or create one directly.'
                : 'Image URLs fill in as uploads complete (placeholders until then).'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Tabs defaultValue="full">
              <div className="flex flex-wrap items-center gap-2">
                <TabsList>
                  <TabsTrigger value="full">Full template</TabsTrigger>
                  <TabsTrigger value="snippet">Rows only</TabsTrigger>
                </TabsList>
                <BackgroundPicker job={job} />
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => copy(html, 'Template HTML')}>
                    <ClipboardCopy /> Copy full
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copy(snippet, 'Rows HTML')}>
                    <ClipboardCopy /> Copy rows
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadBlob(new Blob([html], { type: 'text/html' }), `${job.uploadPrefix}.html`)}>
                    <Download /> .html
                  </Button>
                </div>
              </div>
              <TabsContent value="full">
                <Textarea readOnly value={html} className="h-64 font-mono text-xs" data-testid="html-output" />
              </TabsContent>
              <TabsContent value="snippet">
                <Textarea readOnly value={snippet} className="h-64 font-mono text-xs" />
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
              <div className="grid min-w-60 flex-1 gap-1.5">
                <Label htmlFor="tpl-name">Klaviyo template name</Label>
                <Input id="tpl-name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
              </div>
              <Button data-testid="create-template" disabled={!allUploaded || creating || !keyReady} onClick={createTemplate}>
                {creating && <Loader2 className="animate-spin" />}
                Create {settings.templateEditorType === 'CODE' ? 'code' : 'hybrid'} template
              </Button>
              {job.template && (
                <div className="flex w-full items-center gap-2 text-sm">
                  <Badge variant="success">Created</Badge>
                  <span>
                    {job.template.name} · <code className="text-xs">{job.template.id}</code>
                  </span>
                  <a
                    className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs underline"
                    href="https://www.klaviyo.com/email-templates"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Klaviyo templates <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload {pending} images to Klaviyo?</DialogTitle>
            <DialogDescription>
              They'll be added to your Klaviyo image library{settings.hideUploadsInLibrary ? ' (hidden)' : ''} as{' '}
              <code>{job.uploadPrefix}_…</code>. You approved every slice; uploads can't be undone from here.
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
