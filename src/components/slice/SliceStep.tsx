import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Eye, EyeOff, MousePointer2, Redo2, RotateCw, SeparatorHorizontal, SeparatorVertical, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { moveColCut, moveRowCut, removeColCut, removeRowCut, validateLayout } from '@/lib/slicing'
import { cn } from '@/lib/utils'
import { useWorkspace, type EmailJob } from '@/store/workspace'
import { FigmaSliceBanner, RefreshFromFigmaButton } from '@/components/common/FigmaSync'
import { SliceCanvas } from './SliceCanvas'
import { SliceInspector } from './SliceInspector'
import type { EditorMode, Selection, Zoom } from './types'

export function SliceStep({ job }: { job: EmailJob }) {
  const layout = job.layout!
  const [mode, setMode] = useState<EditorMode>('select')
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [showLayers, setShowLayers] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const { undo, redo, setLayout, setStep, reloadJob } = useWorkspace()

  const issues = useMemo(() => validateLayout(layout, job.analysis, job.autoOptions), [layout, job.analysis, job.autoOptions])
  const errors = issues.filter((i) => i.severity === 'error').length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable], [role="combobox"], [role="slider"]')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo(job.id)
        else undo(job.id)
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo(job.id)
        return
      }
      if (mod) return
      const key = e.key.toLowerCase()
      if (key === 's' || key === 'escape') {
        setMode('select')
        if (key === 'escape') setSelection(null)
      } else if (key === 'h') setMode('row')
      else if (key === 'v') setMode('col')
      else if (key === 'l') setShowLayers((v) => !v)
      else if ((key === 'delete' || key === 'backspace') && selection) {
        if (selection.type === 'rowcut') setLayout(job.id, removeRowCut(layout, selection.rowIndex), { history: true })
        else if (selection.type === 'colcut') setLayout(job.id, removeColCut(layout, selection.rowIndex, selection.cutIndex), { history: true })
        else return
        setSelection(null)
        e.preventDefault()
      } else if (key.startsWith('arrow') && selection && selection.type !== 'cell') {
        const d = (e.shiftKey ? 10 : 1) * (key === 'arrowup' || key === 'arrowleft' ? -1 : 1)
        e.preventDefault()
        if (selection.type === 'rowcut' && (key === 'arrowup' || key === 'arrowdown'))
          setLayout(job.id, moveRowCut(layout, selection.rowIndex, layout.rows[selection.rowIndex].bottom + d), { history: true })
        if (selection.type === 'colcut' && (key === 'arrowleft' || key === 'arrowright'))
          setLayout(
            job.id,
            moveColCut(layout, selection.rowIndex, selection.cutIndex, layout.rows[selection.rowIndex].colCuts[selection.cutIndex] + d),
            { history: true },
          )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [job.id, layout, selection, undo, redo, setLayout])

  const modes: { id: EditorMode; icon: typeof MousePointer2; label: string; key: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select slices', key: 'S' },
    { id: 'row', icon: SeparatorHorizontal, label: 'Add horizontal cut', key: 'H' },
    { id: 'col', icon: SeparatorVertical, label: 'Add column cut', key: 'V' },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="bg-card flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="bg-muted flex rounded-md p-0.5">
            {modes.map((m) => (
              <Tooltip key={m.id}>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    data-testid={`mode-${m.id}`}
                    className={cn(mode === m.id && 'bg-background shadow-sm')}
                    onClick={() => setMode(m.id)}
                  >
                    <m.icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {m.label} <kbd className="ml-1 opacity-70">{m.key}</kbd>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <Separator orientation="vertical" className="!h-6" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" disabled={!job.past.length} onClick={() => undo(job.id)}>
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo ⌘Z</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" disabled={!job.future.length} onClick={() => redo(job.id)}>
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo ⇧⌘Z</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => setShowLayers((v) => !v)} className={cn(showLayers && 'bg-accent')}>
                {showLayers ? <Eye /> : <EyeOff />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Show detected layers <kbd className="ml-1 opacity-70">L</kbd>
            </TooltipContent>
          </Tooltip>
          <Select value={String(zoom)} onValueChange={(v) => setZoom(v === 'fit' ? 'fit' : Number(v))}>
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fit">Fit</SelectItem>
              <SelectItem value="0.25">25%</SelectItem>
              <SelectItem value="0.5">50%</SelectItem>
              <SelectItem value="1">100%</SelectItem>
            </SelectContent>
          </Select>
          {job.source.kind === 'figma' && (
            <>
              <RefreshFromFigmaButton job={job} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm('Start over from Figma? This discards compression, approvals and uploads for this email.')) reloadJob(job.id)
                    }}
                  >
                    <RotateCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Start over from Figma (discards everything)</TooltipContent>
              </Tooltip>
            </>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted-foreground hidden text-xs lg:inline">
              {job.name} · {job.width}×{job.height}px
              {job.scale !== 1 && ` @${job.scale}×`}
            </span>
            {issues.length > 0 ? (
              <Badge variant={errors ? 'destructive' : 'warning'}>
                {errors ? `${errors} cut${errors > 1 ? 's' : ''} through text/buttons` : `${issues.length} warning${issues.length > 1 ? 's' : ''}`}
              </Badge>
            ) : (
              <Badge variant="success">Clean cuts</Badge>
            )}
            <Button data-testid="to-optimize" onClick={() => setStep(job.id, 'optimize')}>
              Optimize <ArrowRight />
            </Button>
          </div>
        </div>
        <FigmaSliceBanner job={job} />
        <SliceCanvas
          job={job}
          layout={layout}
          mode={mode}
          zoom={zoom}
          showLayers={showLayers}
          selection={selection}
          onSelect={setSelection}
          issues={issues}
        />
      </div>
      <SliceInspector job={job} layout={layout} selection={selection} onSelect={setSelection} issues={issues} />
    </div>
  )
}
