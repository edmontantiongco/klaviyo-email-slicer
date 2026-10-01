import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SliceRow } from '@/hooks/useJobStats'
import { cropToPngBlob } from '@/lib/image'
import { sliceIndexLabel } from '@/lib/naming'
import { formatBytes } from '@/lib/utils'
import { useWorkspace, type EmailJob } from '@/store/workspace'

interface Props {
  job: EmailJob
  rows: SliceRow[]
  index: number | null
  onIndexChange: (i: number | null) => void
}

export function CompareDialog({ job, rows, index, onIndexChange }: Props) {
  const setApproved = useWorkspace((s) => s.setApproved)
  const [pos, setPos] = useState(50)
  const [zoom, setZoom] = useState<'fit' | '1' | '2'>('fit')
  const [original, setOriginal] = useState<{ id: string; url: string; size: number } | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const row = index !== null ? rows[index] : undefined
  const slice = row?.slice
  const result = row?.result

  useEffect(() => {
    if (!slice || !job.bitmap) return
    let cancelled = false
    let url: string | undefined
    void cropToPngBlob(job.bitmap, slice).then((blob) => {
      if (cancelled) return
      url = URL.createObjectURL(blob)
      setOriginal({ id: slice.id, url, size: blob.size })
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [slice, job.bitmap])

  const go = (d: number) => {
    if (index === null) return
    const next = index + d
    if (next >= 0 && next < rows.length) onIndexChange(next)
  }

  const approveAndNext = () => {
    if (!slice || result?.status !== 'done') return
    setApproved(job.id, [slice.id], true)
    const nextPending = rows.findIndex((r, i) => i > index! && !r.result?.approved)
    if (nextPending >= 0) onIndexChange(nextPending)
    else onIndexChange(null)
  }

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && !e.shiftKey) go(1)
      if (e.key === 'ArrowLeft' && !e.shiftKey) go(-1)
      if (e.key.toLowerCase() === 'a') approveAndNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const setFromPointer = (clientX: number) => {
    const r = frameRef.current?.getBoundingClientRect()
    if (!r) return
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }

  const width = slice ? (zoom === 'fit' ? undefined : slice.width * Number(zoom)) : undefined
  const origReady = original && slice && original.id === slice.id

  return (
    <Dialog open={index !== null} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-3 sm:max-w-6xl" data-testid="compare-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {slice && (
              <Badge variant="outline" className="font-mono">
                {sliceIndexLabel(slice)}
              </Badge>
            )}
            {slice?.meta.name}
          </DialogTitle>
          <DialogDescription>
            Drag across the image to compare the original (left) with the compressed output (right).{' '}
            <kbd>←</kbd>/<kbd>→</kbd> to navigate, <kbd>A</kbd> to approve and jump to the next unapproved slice.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">
            Original PNG {origReady ? formatBytes(original.size) : '…'}
          </Badge>
          <ChevronRight className="text-muted-foreground size-4" />
          {result?.status === 'done' ? (
            <>
              <Badge variant={result.withinBudget ? 'success' : 'destructive'}>
                {result.format?.toUpperCase()} {result.quality ? `q${result.quality}` : 'lossless'} · {formatBytes(result.size!)}
              </Badge>
              {origReady && (
                <span className="text-muted-foreground text-xs">−{Math.max(0, Math.round((1 - result.size! / original.size) * 100))}%</span>
              )}
              <span className="text-muted-foreground text-xs">{result.notes}</span>
            </>
          ) : (
            <Badge variant="outline">
              <Loader2 className="animate-spin" /> compressing…
            </Badge>
          )}
          <div className="ml-auto">
            <Select value={zoom} onValueChange={(v) => setZoom(v as typeof zoom)}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fit">Fit</SelectItem>
                <SelectItem value="1">100%</SelectItem>
                <SelectItem value="2">200%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="bg-muted/50 checkerboard min-h-0 flex-1 overflow-auto rounded-md border">
          {slice && (
            <div
              ref={frameRef}
              className="relative mx-auto cursor-ew-resize touch-none select-none"
              style={{ width: width ?? '100%', maxWidth: zoom === 'fit' ? slice.width : undefined, aspectRatio: `${slice.width} / ${slice.height}` }}
              onPointerDown={(e) => {
                dragging.current = true
                ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
                setFromPointer(e.clientX)
              }}
              onPointerMove={(e) => dragging.current && setFromPointer(e.clientX)}
              onPointerUp={() => (dragging.current = false)}
            >
              {result?.url && <img src={result.url} alt="compressed" draggable={false} className="absolute inset-0 size-full" style={{ imageRendering: zoom === 'fit' ? 'auto' : 'pixelated' }} />}
              {origReady && (
                <img
                  src={original.url}
                  alt="original"
                  draggable={false}
                  className="absolute inset-0 size-full"
                  style={{ clipPath: `inset(0 ${100 - pos}% 0 0)`, imageRendering: zoom === 'fit' ? 'auto' : 'pixelated' }}
                />
              )}
              <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${pos}%` }}>
                <div className="absolute top-2 -translate-x-[calc(100%+6px)] rounded bg-black/70 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white">Original</div>
                <div className="absolute top-2 translate-x-[6px] rounded bg-black/70 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white">Compressed</div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!index} onClick={() => go(-1)}>
            <ChevronLeft /> Prev
          </Button>
          <span className="text-muted-foreground text-sm">
            {index !== null ? index + 1 : 0} / {rows.length}
          </span>
          <Button variant="outline" size="sm" disabled={index === null || index >= rows.length - 1} onClick={() => go(1)}>
            Next <ChevronRight />
          </Button>
          <div className="ml-auto flex gap-2">
            {result?.approved ? (
              <Button variant="outline" onClick={() => setApproved(job.id, [slice!.id], false)}>
                Revoke approval
              </Button>
            ) : null}
            <Button data-testid="approve-next" disabled={result?.status !== 'done'} onClick={approveAndNext}>
              <Check /> {result?.approved ? 'Next unapproved' : 'Approve & next'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
