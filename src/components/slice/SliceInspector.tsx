import { useMemo } from 'react'
import { AlertTriangle, Columns3, Link2, Minus, Plus, Sparkles, Type, Wand2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  detectColumns,
  getSlices,
  removeRowCut,
  rowTop,
  setColumns,
  setEqualColumns,
  suggestCellMeta,
  updateCell,
  type AutoSliceOptions,
  type FormatChoice,
  type LayoutIssue,
  type SliceLayout,
} from '@/lib/slicing'
import { sliceIndexLabel } from '@/lib/naming'
import { cn } from '@/lib/utils'
import { useWorkspace, type EmailJob } from '@/store/workspace'
import type { Selection } from './types'

interface Props {
  job: EmailJob
  layout: SliceLayout
  selection: Selection
  onSelect: (s: Selection) => void
  issues: LayoutIssue[]
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 10,
  suffix = 'px',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-muted-foreground font-mono text-xs">
          {value}
          {suffix}
        </span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}

export function SliceInspector({ job, layout, selection, onSelect, issues }: Props) {
  const setLayout = useWorkspace((s) => s.setLayout)
  const runAutoSlice = useWorkspace((s) => s.runAutoSlice)
  const patchJob = useWorkspace((s) => s.patchJob)
  const slices = useMemo(() => getSlices(layout), [layout])
  const opts = job.autoOptions

  const selectedSlice =
    selection?.type === 'cell'
      ? slices.find((s) => s.id === selection.id)
      : selection
        ? slices.find((s) => s.rowIndex === selection.rowIndex)
        : undefined
  const rowIndex = selectedSlice?.rowIndex
  const row = rowIndex !== undefined ? layout.rows[rowIndex] : undefined

  const update = (id: string, patch: Parameters<typeof updateCell>[2]) => setLayout(job.id, updateCell(layout, id, patch))
  const setOpts = (patch: Partial<AutoSliceOptions>) => patchJob(job.id, { autoOptions: { ...opts, ...patch } })

  const errors = issues.filter((i) => i.severity === 'error').length

  return (
    <aside className="bg-card flex w-[360px] shrink-0 flex-col border-l">
      <Tabs defaultValue="slice" className="min-h-0 flex-1 gap-0">
        <div className="border-b p-3">
          <TabsList className="w-full">
            <TabsTrigger value="slice">Slices</TabsTrigger>
            <TabsTrigger value="auto">Auto-slice</TabsTrigger>
            <TabsTrigger value="issues" data-testid="issues-tab">
              Checks
              {issues.length > 0 && (
                <Badge variant={errors ? 'destructive' : 'warning'} className="ml-1 px-1.5 py-0">
                  {issues.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="slice" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="grid gap-4 p-4">
              {selectedSlice && row && rowIndex !== undefined ? (
                <div className="grid gap-3" data-testid="slice-form">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      {sliceIndexLabel(selectedSlice)}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {selectedSlice.width}×{selectedSlice.height}px · x{selectedSlice.x} y{selectedSlice.y}
                    </span>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="slice-name">Name</Label>
                    <Input id="slice-name" value={selectedSlice.meta.name} onChange={(e) => update(selectedSlice.id, { name: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="slice-link">
                      <Link2 className="size-3.5" /> Link
                    </Label>
                    <Input
                      id="slice-link"
                      placeholder="https://… or {% unsubscribe_url %}"
                      value={selectedSlice.meta.link}
                      onChange={(e) => update(selectedSlice.id, { link: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="slice-alt">
                      <Type className="size-3.5" /> Alt text
                    </Label>
                    <Textarea
                      id="slice-alt"
                      rows={2}
                      placeholder="Describe what the image says"
                      value={selectedSlice.meta.alt}
                      onChange={(e) => update(selectedSlice.id, { alt: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Format</Label>
                    <Select value={selectedSlice.meta.format} onValueChange={(v) => update(selectedSlice.id, { format: v as FormatChoice })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Default (from optimize settings)</SelectItem>
                        <SelectItem value="jpeg">JPEG (MozJPEG)</SelectItem>
                        <SelectItem value="png">PNG (OxiPNG, lossless)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-1.5">
                        <Columns3 className="size-3.5" /> Row {rowIndex + 1} columns
                      </Label>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon-sm"
                          variant="outline"
                          disabled={row.cells.length <= 1}
                          onClick={() => setLayout(job.id, setEqualColumns(layout, rowIndex, row.cells.length - 1), { history: true })}
                        >
                          <Minus />
                        </Button>
                        <span className="w-6 text-center font-mono text-sm">{row.cells.length}</span>
                        <Button
                          size="icon-sm"
                          variant="outline"
                          disabled={row.cells.length >= 8}
                          onClick={() => setLayout(job.id, setEqualColumns(layout, rowIndex, row.cells.length + 1), { history: true })}
                        >
                          <Plus />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!job.analysis}
                        onClick={() => {
                          const cuts = detectColumns(job.analysis!, rowTop(layout, rowIndex), row.bottom, { ...opts, autoColumns: true })
                          if (!cuts.length) toast.info('No grid detected in this row')
                          else setLayout(job.id, setColumns(layout, rowIndex, cuts), { history: true })
                        }}
                      >
                        <Wand2 /> Detect grid
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!row.colCuts.length}
                        onClick={() => setLayout(job.id, setColumns(layout, rowIndex, []), { history: true })}
                      >
                        Single column
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rowIndex >= layout.rows.length - 1}
                        onClick={() => {
                          setLayout(job.id, removeRowCut(layout, rowIndex), { history: true })
                          onSelect(null)
                        }}
                      >
                        Merge with row below
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Click a slice to name it and add its link + alt text. Use <kbd className="bg-muted rounded px-1">H</kbd> /{' '}
                  <kbd className="bg-muted rounded px-1">V</kbd> to add horizontal / vertical cuts, drag lines to adjust (hold{' '}
                  <kbd className="bg-muted rounded px-1">Alt</kbd> to disable snapping).
                </p>
              )}

              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">All slices ({slices.length})</span>
                {job.analysis?.blockers.some((b) => b.text || b.link) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setLayout(job.id, suggestCellMeta(layout, job.analysis), { history: true })
                      toast.success('Filled empty alt text & links from Figma copy')
                    }}
                  >
                    <Sparkles /> Fill from Figma
                  </Button>
                )}
              </div>
              <div className="grid gap-1" data-testid="slice-list">
                {slices.map((s) => {
                  const active = selection?.type === 'cell' && selection.id === s.id
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSelect({ type: 'cell', id: s.id })}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        active ? 'bg-slice/15' : 'hover:bg-accent',
                      )}
                    >
                      <span className="text-muted-foreground w-8 shrink-0 font-mono text-xs">{sliceIndexLabel(s)}</span>
                      <span className="min-w-0 flex-1 truncate">{s.meta.name}</span>
                      {s.meta.link && <Link2 className="text-muted-foreground size-3.5 shrink-0" />}
                      {s.meta.alt && <Type className="text-muted-foreground size-3.5 shrink-0" />}
                      <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                        {s.width}×{s.height}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="auto" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="grid gap-5 p-4">
              <p className="text-muted-foreground text-xs">
                {job.analysis?.source === 'figma'
                  ? `Using ${job.analysis.blockers.length} Figma layers and ${job.analysis.sections.length} sections to find safe cut lines.`
                  : 'Using pixel analysis (solid-colour rows) to find safe cut lines.'}
              </p>
              <NumberField label="Max slice height" value={opts.maxHeight} min={200} max={3000} onChange={(v) => setOpts({ maxHeight: v })} />
              <NumberField label="Min slice height" value={opts.minHeight} min={0} max={600} onChange={(v) => setOpts({ minHeight: v })} />
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Slice density</Label>
                  <span className="text-muted-foreground text-xs">{opts.sliceCost > 1.6 ? 'fewer' : opts.sliceCost < 0.8 ? 'more' : 'balanced'}</span>
                </div>
                <Slider min={0.2} max={3} step={0.1} value={[3.2 - opts.sliceCost]} onValueChange={([v]) => setOpts({ sliceCost: Math.round((3.2 - v) * 10) / 10 })} />
                <div className="text-muted-foreground flex justify-between text-[11px]">
                  <span>Fewer, larger slices</span>
                  <span>More, smaller slices</span>
                </div>
              </div>
              <NumberField label="Min whitespace gap to cut in" value={opts.minGap} min={0} max={80} step={2} onChange={(v) => setOpts({ minGap: v })} />
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-cols" className="text-sm">
                  Detect multi-column grids
                </Label>
                <Switch id="auto-cols" checked={opts.autoColumns} onCheckedChange={(v) => setOpts({ autoColumns: v })} />
              </div>
              {opts.autoColumns && (
                <NumberField label="Min gap between columns" value={opts.columnMinGap} min={4} max={120} step={2} onChange={(v) => setOpts({ columnMinGap: v })} />
              )}
              <div className="flex items-center justify-between">
                <Label htmlFor="snap-even" className="text-sm">
                  Snap cuts to even pixels (@2x)
                </Label>
                <Switch id="snap-even" checked={opts.snapEven} onCheckedChange={(v) => setOpts({ snapEven: v })} />
              </div>
              <Button
                data-testid="reslice"
                onClick={() => {
                  runAutoSlice(job.id)
                  onSelect(null)
                  toast.success('Re-sliced', { description: 'Undo with ⌘Z / Ctrl+Z if you preferred the previous cuts.' })
                }}
              >
                <Wand2 /> Re-run auto-slice
              </Button>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="issues" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="grid gap-2 p-4">
              {issues.length === 0 ? (
                <p className="text-success text-sm">All cuts are clear of text, buttons and images. Rows and columns tile the email exactly — no overlaps, no gaps.</p>
              ) : (
                issues.map((i, idx) => (
                  <button
                    key={idx}
                    className="hover:bg-accent flex gap-2 rounded-md border p-2 text-left text-sm"
                    onClick={() =>
                      onSelect(
                        i.cut === 'col'
                          ? { type: 'colcut', rowIndex: i.rowIndex, cutIndex: i.colIndex! }
                          : i.cut === 'row'
                            ? { type: 'rowcut', rowIndex: i.rowIndex }
                            : { type: 'cell', id: layout.rows[i.rowIndex].cells[0].id },
                      )
                    }
                  >
                    {i.severity === 'error' ? (
                      <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    )}
                    <span>{i.message}</span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
