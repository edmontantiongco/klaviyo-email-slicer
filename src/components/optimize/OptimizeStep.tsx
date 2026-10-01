import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCheck, Eye, Loader2, RotateCw, XCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useJobSlices } from '@/hooks/useJobStats'
import { sliceIndexLabel } from '@/lib/naming'
import { updateCell, type FormatChoice } from '@/lib/slicing'
import { cn, formatBytes } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { useWorkspace, type EmailJob } from '@/store/workspace'
import { CompareDialog } from './CompareDialog'
import { EmailPreview } from './EmailPreview'

export function OptimizeStep({ job }: { job: EmailJob }) {
  const compress = useSettings((s) => s.compress)
  const setCompress = useSettings((s) => s.setCompress)
  const { compressJob, setApproved, setStep, setLayout } = useWorkspace()
  const { rows, stats } = useJobSlices(job)
  const [compareIndex, setCompareIndex] = useState<number | null>(null)
  const [maxKbDraft, setMaxKbDraft] = useState(String(Math.round(compress.maxBytes / 1024)))
  const [qRange, setQRange] = useState([compress.minQuality, compress.maxQuality])

  // (Re)compress whenever geometry or settings change – results are keyed, so this is idempotent.
  useEffect(() => {
    const t = setTimeout(() => compressJob(job.id), 250)
    return () => clearTimeout(t)
  }, [job.id, job.layout, compress, compressJob])

  const allApproved = stats.total > 0 && stats.approved === stats.total
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Tabs defaultValue="slices" className="min-h-0 flex-1 gap-0">
          <div className="bg-card flex flex-wrap items-center gap-3 border-b px-4 py-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(job.id, 'slice')}>
              <ArrowLeft /> Slices
            </Button>
            <TabsList>
              <TabsTrigger value="slices">Slices ({stats.total})</TabsTrigger>
              <TabsTrigger value="preview" data-testid="preview-tab">
                Email preview
              </TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-3 text-sm">
              {stats.done < stats.total ? (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Compressing {stats.done}/{stats.total}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {formatBytes(stats.bytes)} total · {stats.approved}/{stats.total} approved
                </span>
              )}
              <Button data-testid="to-upload" disabled={!allApproved} onClick={() => setStep(job.id, 'upload')}>
                Upload <ArrowRight />
              </Button>
            </div>
          </div>
          {stats.done < stats.total && <Progress value={pct} className="h-1 rounded-none" />}

          <TabsContent value="slices" className="min-h-0">
            <ScrollArea className="h-full">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-4" data-testid="optimize-grid">
                {rows.map(({ slice, result }, i) => {
                  const done = result?.status === 'done'
                  return (
                    <div
                      key={slice.id}
                      className={cn(
                        'bg-card flex flex-col overflow-hidden rounded-xl border shadow-xs transition-shadow',
                        result?.approved && 'ring-success/60 ring-2',
                      )}
                    >
                      <button
                        className="checkerboard group relative flex h-40 items-center justify-center overflow-hidden border-b"
                        onClick={() => setCompareIndex(i)}
                        disabled={!done}
                      >
                        {done ? (
                          <img src={result.url} alt={slice.meta.alt} className="max-h-full max-w-full object-contain" />
                        ) : result?.status === 'error' ? (
                          <XCircle className="text-destructive size-6" />
                        ) : (
                          <Loader2 className="text-muted-foreground size-5 animate-spin" />
                        )}
                        {done && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <Eye className="mr-1.5 size-4" /> Compare
                          </span>
                        )}
                      </button>
                      <div className="grid gap-2 p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground font-mono text-xs">{sliceIndexLabel(slice)}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{slice.meta.name}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="font-mono">
                            {slice.width}×{slice.height}
                          </Badge>
                          {done && (
                            <>
                              <Badge variant="secondary">
                                {result.format?.toUpperCase()}
                                {result.quality ? ` q${result.quality}` : ''}
                              </Badge>
                              <Badge variant={result.withinBudget ? 'success' : 'destructive'}>{formatBytes(result.size!)}</Badge>
                            </>
                          )}
                        </div>
                        {result?.status === 'error' && <p className="text-destructive text-xs">{result.error}</p>}
                        {done && !result.withinBudget && (
                          <p className="text-destructive text-xs">Over budget even at q{compress.minQuality}. Split this slice or lower the quality floor.</p>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <Select
                            value={slice.meta.format}
                            onValueChange={(v) => setLayout(job.id, updateCell(job.layout!, slice.id, { format: v as FormatChoice }))}
                          >
                            <SelectTrigger size="sm" className="h-7 w-[110px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">Default</SelectItem>
                              <SelectItem value="jpeg">JPEG</SelectItem>
                              <SelectItem value="png">PNG</SelectItem>
                            </SelectContent>
                          </Select>
                          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                            <Checkbox
                              data-testid={`approve-${i}`}
                              disabled={!done}
                              checked={!!result?.approved}
                              onCheckedChange={(v) => setApproved(job.id, [slice.id], v === true)}
                            />
                            Approve
                          </label>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="preview" className="min-h-0">
            <ScrollArea className="h-full">
              <div className="p-4">
                <EmailPreview job={job} />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      <aside className="bg-card flex w-80 shrink-0 flex-col border-l">
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-5 p-4">
            <div>
              <h3 className="font-medium">Compression</h3>
              <p className="text-muted-foreground text-xs">Squoosh codecs (MozJPEG / OxiPNG) running locally in your browser.</p>
            </div>

            <div className="grid gap-2">
              <Label>Default format</Label>
              <Select value={compress.format} onValueChange={(v) => setCompress({ format: v as typeof compress.format })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto – PNG for flat art, else JPEG</SelectItem>
                  <SelectItem value="jpeg">JPEG (MozJPEG)</SelectItem>
                  <SelectItem value="png">PNG (OxiPNG lossless)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="max-kb">Max size per image</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="max-kb"
                  type="number"
                  min={20}
                  max={5000}
                  value={maxKbDraft}
                  onChange={(e) => setMaxKbDraft(e.target.value)}
                  onBlur={() => {
                    const kb = Math.min(5000, Math.max(20, Number(maxKbDraft) || 500))
                    setMaxKbDraft(String(kb))
                    setCompress({ maxBytes: kb * 1024 })
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span className="text-muted-foreground text-sm">KB</span>
              </div>
              <div className="flex gap-1">
                {[150, 300, 500, 1000].map((kb) => (
                  <Button
                    key={kb}
                    size="sm"
                    variant={compress.maxBytes === kb * 1024 ? 'secondary' : 'ghost'}
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setMaxKbDraft(String(kb))
                      setCompress({ maxBytes: kb * 1024 })
                    }}
                  >
                    {kb}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>JPEG quality range</Label>
                <span className="text-muted-foreground font-mono text-xs">
                  {qRange[0]}–{qRange[1]}
                </span>
              </div>
              <Slider
                min={30}
                max={100}
                step={1}
                value={qRange}
                onValueChange={setQRange}
                onValueCommit={([a, b]) => setCompress({ minQuality: a, maxQuality: Math.max(a, b) })}
              />
              <p className="text-muted-foreground text-xs">
                Starts at the top of the range and only steps down as far as needed to fit the size limit.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="grid gap-1">
                <Label htmlFor="crisp">Sharper coloured text</Label>
                <span className="text-muted-foreground text-xs">4:4:4 chroma – slightly larger files</span>
              </div>
              <Switch id="crisp" checked={compress.crispText} onCheckedChange={(v) => setCompress({ crispText: v })} />
            </div>

            <Separator />

            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Compressed</span>
                <span>
                  {stats.done}/{stats.total}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total weight</span>
                <span>{formatBytes(stats.bytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Over budget</span>
                <span className={cn(stats.overBudget && 'text-destructive font-medium')}>{stats.overBudget}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Approved</span>
                <span className={cn(allApproved && 'text-success font-medium')}>
                  {stats.approved}/{stats.total}
                </span>
              </div>
            </div>

            {stats.overBudget > 0 && (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertDescription>
                  {stats.overBudget} slice{stats.overBudget > 1 && 's'} can't meet the size limit. Split them into smaller slices, switch to JPEG, or lower the
                  quality floor.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Button
                variant="secondary"
                data-testid="review-start"
                disabled={!stats.done}
                onClick={() => {
                  const first = rows.findIndex((r) => r.result?.status === 'done' && !r.result.approved)
                  setCompareIndex(first >= 0 ? first : 0)
                }}
              >
                <Eye /> Review one by one
              </Button>
              <Button
                variant="outline"
                data-testid="approve-all"
                disabled={stats.done < stats.total || allApproved}
                onClick={() =>
                  setApproved(
                    job.id,
                    rows.map((r) => r.slice.id),
                    true,
                  )
                }
              >
                <CheckCheck /> Approve all {stats.total}
              </Button>
              {stats.approved > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setApproved(
                      job.id,
                      rows.map((r) => r.slice.id),
                      false,
                    )
                  }
                >
                  Clear approvals
                </Button>
              )}
              {stats.errors > 0 && (
                <Button variant="ghost" size="sm" onClick={() => compressJob(job.id)}>
                  <RotateCw /> Retry failed
                </Button>
              )}
            </div>
            {allApproved && (
              <p className="text-success flex items-center gap-1.5 text-sm">
                <Check className="size-4" /> Everything approved — ready to upload.
              </p>
            )}
          </div>
        </ScrollArea>
      </aside>

      <CompareDialog job={job} rows={rows} index={compareIndex} onIndexChange={setCompareIndex} />
    </div>
  )
}
