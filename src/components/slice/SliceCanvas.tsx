import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  addColCut,
  addRowCut,
  findRowAt,
  getSlices,
  moveColCut,
  moveRowCut,
  removeColCut,
  removeRowCut,
  rowTop,
  type LayoutIssue,
  type SliceLayout,
} from '@/lib/slicing'
import { sliceIndexLabel } from '@/lib/naming'
import { cn } from '@/lib/utils'
import { useWorkspace, type EmailJob } from '@/store/workspace'
import { safeColTargets, safeRowTargets, snapTo } from './snapping'
import type { EditorMode, Selection, Zoom } from './types'

const KIND_COLORS: Record<string, string> = {
  text: 'border-sky-500/70 bg-sky-500/10',
  component: 'border-orange-500/80 bg-orange-500/10',
  image: 'border-emerald-500/60 bg-emerald-500/5',
  vector: 'border-fuchsia-500/60 bg-fuchsia-500/5',
  shape: 'border-zinc-500/50 bg-zinc-500/5',
  content: 'border-sky-500/50 bg-sky-500/5',
}

interface Props {
  job: EmailJob
  layout: SliceLayout
  mode: EditorMode
  zoom: Zoom
  showLayers: boolean
  selection: Selection
  onSelect: (s: Selection) => void
  issues: LayoutIssue[]
}

type Drag = { type: 'row'; rowIndex: number } | { type: 'col'; rowIndex: number; cutIndex: number; targets: number[] }

export function SliceCanvas({ job, layout, mode, zoom, showLayers, selection, onSelect, issues }: Props) {
  const setLayout = useWorkspace((s) => s.setLayout)
  const pushHistory = useWorkspace((s) => s.pushHistory)
  const scrollRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(800)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth))
    ro.observe(el)
    setContainerW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const k = zoom === 'fit' ? Math.min(1, Math.max(0.1, (containerW - 120) / layout.width)) : zoom
  const dispW = Math.round(layout.width * k)
  const dispH = Math.round(layout.height * k)
  const slices = useMemo(() => getSlices(layout), [layout])
  const rowTargets = useMemo(() => safeRowTargets(job.analysis, job.autoOptions), [job.analysis, job.autoOptions])
  // When adding a cut, don't snap onto a line that already exists.
  const addTargets = useMemo(() => {
    const existing = layout.rows.map((r) => r.bottom)
    return rowTargets.filter((t) => existing.every((e) => Math.abs(e - t) > 2))
  }, [rowTargets, layout.rows])
  const snapThreshold = 8 / k

  const issueFor = (cut: 'row' | 'col', rowIndex: number, colIndex?: number) =>
    issues.find((i) => i.cut === cut && i.rowIndex === rowIndex && (cut === 'row' || i.colIndex === colIndex))

  const toImage = (clientX: number, clientY: number) => {
    const r = overlayRef.current!.getBoundingClientRect()
    return {
      x: Math.min(layout.width, Math.max(0, (clientX - r.left) / k)),
      y: Math.min(layout.height, Math.max(0, (clientY - r.top) / k)),
    }
  }

  // Global pointer handling while dragging a cut line.
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const p = toImage(e.clientX, e.clientY)
      const l = layoutRef.current
      if (drag.type === 'row') {
        const y = e.altKey ? p.y : snapTo(p.y, rowTargets, snapThreshold)
        setLayout(job.id, moveRowCut(l, drag.rowIndex, y))
      } else {
        const x = e.altKey ? p.x : snapTo(p.x, drag.targets, snapThreshold)
        setLayout(job.id, moveColCut(l, drag.rowIndex, drag.cutIndex, x))
      }
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, k])

  // Keep the selected slice/cut in view when chosen from the inspector.
  useEffect(() => {
    if (!selection || !scrollRef.current) return
    let y: number | undefined
    if (selection.type === 'cell') y = slices.find((s) => s.id === selection.id)?.y
    else y = layout.rows[selection.rowIndex]?.bottom
    if (y === undefined) return
    const el = scrollRef.current
    const top = y * k
    if (top < el.scrollTop + 40 || top > el.scrollTop + el.clientHeight - 80) {
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  const ghost = (() => {
    if (!hover || drag || mode === 'select') return null
    if (mode === 'row') {
      const y = snapTo(hover.y, addTargets, snapThreshold)
      return { type: 'row' as const, y: Math.round(y) }
    }
    const rowIndex = findRowAt(layout, hover.y)
    if (rowIndex < 0) return null
    const top = rowTop(layout, rowIndex)
    const targets = safeColTargets(job.analysis, top, layout.rows[rowIndex].bottom).filter((t) =>
      layout.rows[rowIndex].colCuts.every((c) => Math.abs(c - t) > 2),
    )
    return { type: 'col' as const, x: Math.round(snapTo(hover.x, targets, snapThreshold)), top, bottom: layout.rows[rowIndex].bottom, rowIndex }
  })()

  const onOverlayClick = (e: React.MouseEvent) => {
    const p = toImage(e.clientX, e.clientY)
    if (mode === 'row' && ghost?.type === 'row') {
      const next = addRowCut(layout, ghost.y)
      if (next !== layout) {
        setLayout(job.id, next, { history: true })
        onSelect({ type: 'rowcut', rowIndex: findRowAt(next, ghost.y - 1) })
      }
    } else if (mode === 'col' && ghost?.type === 'col') {
      const next = addColCut(layout, ghost.rowIndex, ghost.x)
      if (next !== layout) {
        setLayout(job.id, next, { history: true })
        onSelect({ type: 'colcut', rowIndex: ghost.rowIndex, cutIndex: next.rows[ghost.rowIndex].colCuts.indexOf(ghost.x) })
      }
    } else {
      const hit = slices.find((s) => p.x >= s.x && p.x < s.x + s.width && p.y >= s.y && p.y < s.y + s.height)
      onSelect(hit ? { type: 'cell', id: hit.id } : null)
    }
  }

  const startRowDrag = (e: React.PointerEvent, rowIndex: number) => {
    e.stopPropagation()
    e.preventDefault()
    pushHistory(job.id)
    onSelect({ type: 'rowcut', rowIndex })
    setDrag({ type: 'row', rowIndex })
  }

  const startColDrag = (e: React.PointerEvent, rowIndex: number, cutIndex: number) => {
    e.stopPropagation()
    e.preventDefault()
    pushHistory(job.id)
    onSelect({ type: 'colcut', rowIndex, cutIndex })
    const top = rowTop(layout, rowIndex)
    setDrag({ type: 'col', rowIndex, cutIndex, targets: safeColTargets(job.analysis, top, layout.rows[rowIndex].bottom) })
  }

  const lineColor = (sev?: 'error' | 'warning') => (sev === 'error' ? 'bg-destructive' : sev === 'warning' ? 'bg-warning' : 'bg-slice')

  return (
    <div ref={scrollRef} className="bg-muted/40 relative min-h-0 flex-1 overflow-auto" data-testid="slice-canvas">
      <div className="relative mx-auto my-8 shadow-lg" style={{ width: dispW, height: dispH }}>
        <img src={job.imageUrl} alt={job.name} draggable={false} className="block select-none" style={{ width: dispW, height: dispH }} />

        <div
          ref={overlayRef}
          className={cn('absolute inset-0', mode === 'row' && 'cursor-row-resize', mode === 'col' && 'cursor-col-resize', drag && (drag.type === 'row' ? 'cursor-row-resize' : 'cursor-col-resize'))}
          onPointerMove={(e) => setHover(toImage(e.clientX, e.clientY))}
          onPointerLeave={() => setHover(null)}
          onClick={onOverlayClick}
        >
          {/* layer boxes */}
          {showLayers &&
            job.analysis?.blockers.map((b, i) => (
              <div
                key={i}
                title={`${b.kind}: ${b.name}`}
                className={cn('pointer-events-none absolute border', KIND_COLORS[b.kind])}
                style={{ left: b.x * k, top: b.y * k, width: b.width * k, height: b.height * k }}
              />
            ))}

          {/* slice cells */}
          {slices.map((s) => {
            const selected = selection?.type === 'cell' && selection.id === s.id
            const hovered = !!hover && !drag && hover.x >= s.x && hover.x < s.x + s.width && hover.y >= s.y && hover.y < s.y + s.height
            const expanded = selected || hovered
            return (
              <div
                key={s.id}
                className={cn('pointer-events-none absolute', selected && 'bg-slice/15 ring-slice ring-2 ring-inset')}
                style={{ left: s.x * k, top: s.y * k, width: s.width * k, height: s.height * k }}
              >
                {s.height * k > 14 && (
                  <span
                    className={cn(
                      'absolute top-1 left-1 z-[5] max-w-[calc(100%-8px)] truncate rounded px-1 py-px font-mono text-[10px] leading-tight shadow-sm transition-opacity',
                      selected ? 'bg-slice text-white' : 'bg-background/90 text-foreground',
                      !expanded && 'opacity-60',
                    )}
                  >
                    {sliceIndexLabel(s)}
                    {expanded && ` · ${s.meta.name} · ${s.width}×${s.height}`}
                  </span>
                )}
              </div>
            )
          })}

          {/* horizontal cuts */}
          {layout.rows.slice(0, -1).map((row, rowIndex) => {
            const issue = issueFor('row', rowIndex)
            const selected = selection?.type === 'rowcut' && selection.rowIndex === rowIndex
            return (
              <div
                key={row.id}
                data-testid={`rowcut-${rowIndex}`}
                className="group absolute right-0 left-0 z-10 h-3 -translate-y-1/2 cursor-row-resize"
                style={{ top: row.bottom * k }}
                onPointerDown={(e) => startRowDrag(e, rowIndex)}
                onClick={(e) => e.stopPropagation()}
                title={issue?.message}
              >
                <div className={cn('absolute top-1/2 right-0 left-0 -translate-y-1/2', lineColor(issue?.severity), selected ? 'h-[3px]' : 'h-[2px] group-hover:h-[3px]')} />
                <div
                  className={cn(
                    'absolute top-1/2 -right-2 flex translate-x-full -translate-y-1/2 items-center gap-1 rounded-full py-0.5 pr-0.5 pl-2 font-mono text-[10px] text-white shadow',
                    lineColor(issue?.severity),
                    selected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
                  )}
                >
                  {row.bottom}
                  <button
                    className="flex size-4 cursor-pointer items-center justify-center rounded-full hover:bg-black/20"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setLayout(job.id, removeRowCut(layout, rowIndex), { history: true })
                      onSelect(null)
                    }}
                    aria-label="Remove cut"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
            )
          })}

          {/* vertical cuts */}
          {layout.rows.map((row, rowIndex) => {
            const top = rowTop(layout, rowIndex)
            return row.colCuts.map((x, cutIndex) => {
              const issue = issueFor('col', rowIndex, cutIndex)
              const selected = selection?.type === 'colcut' && selection.rowIndex === rowIndex && selection.cutIndex === cutIndex
              return (
                <div
                  key={`${row.id}-${cutIndex}`}
                  className="group absolute z-10 w-3 -translate-x-1/2 cursor-col-resize"
                  style={{ left: x * k, top: top * k, height: (row.bottom - top) * k }}
                  onPointerDown={(e) => startColDrag(e, rowIndex, cutIndex)}
                  onClick={(e) => e.stopPropagation()}
                  title={issue?.message}
                >
                  <div className={cn('absolute top-0 bottom-0 left-1/2 -translate-x-1/2', lineColor(issue?.severity), selected ? 'w-[3px]' : 'w-[2px] group-hover:w-[3px]')} />
                  <button
                    className={cn(
                      'absolute top-1 left-1/2 flex size-4 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full text-white shadow',
                      lineColor(issue?.severity),
                      selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setLayout(job.id, removeColCut(layout, rowIndex, cutIndex), { history: true })
                      onSelect(null)
                    }}
                    aria-label="Remove column cut"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })
          })}

          {/* ghost line for adding cuts */}
          {ghost?.type === 'row' && (
            <div className="pointer-events-none absolute right-0 left-0 z-20" style={{ top: ghost.y * k }}>
              <div className="border-slice border-t-2 border-dashed" />
              <span className="bg-slice absolute -top-5 left-1 rounded px-1 font-mono text-[10px] text-white">y {ghost.y}</span>
            </div>
          )}
          {ghost?.type === 'col' && (
            <div
              className="border-slice pointer-events-none absolute z-20 border-l-2 border-dashed"
              style={{ left: ghost.x * k, top: ghost.top * k, height: (ghost.bottom - ghost.top) * k }}
            >
              <span className="bg-slice absolute top-1 left-1 rounded px-1 font-mono text-[10px] text-white">x {ghost.x}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
