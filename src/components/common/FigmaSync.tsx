import { useState } from 'react'
import { AlertTriangle, Frame, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace, type EmailJob } from '@/store/workspace'
import { cn } from '@/lib/utils'

/** "Refresh from Figma": re-render the frame, keep unchanged slices, flag revised ones. */
export function RefreshFromFigmaButton({ job, size = 'sm', className }: { job: EmailJob; size?: 'sm' | 'default'; className?: string }) {
  const refresh = useWorkspace((s) => s.refreshFromFigma)
  const [busy, setBusy] = useState(false)
  if (job.source.kind !== 'figma') return null
  return (
    <Button
      size={size}
      variant="outline"
      className={className}
      disabled={busy || job.status !== 'ready'}
      data-testid="refresh-figma"
      title="Re-render this email from Figma. Unchanged slices keep their compression, approval and upload; revised slices are flagged."
      onClick={async () => {
        setBusy(true)
        try {
          await refresh(job.id)
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {busy ? 'Checking Figma…' : 'Refresh from Figma'}
    </Button>
  )
}

/** Explains where the slices come from and what the last refresh found. */
export function FigmaSliceBanner({ job, className }: { job: EmailJob; className?: string }) {
  if (job.source.kind !== 'figma') return null
  const count = job.layout?.rows.reduce((n, r) => n + r.cells.filter((c) => c.id.startsWith('figma:')).length, 0) ?? 0
  const last = job.lastRefresh
  const warnings = job.sliceWarnings ?? []
  return (
    <div className={cn('grid gap-1 border-b px-4 py-2 text-xs', className)} data-testid="figma-slice-banner">
      <div className="flex items-start gap-2">
        <Frame className="mt-0.5 size-3.5 shrink-0" />
        <div className="flex flex-wrap gap-x-2 gap-y-1">
        {job.sliceSource === 'figma' ? (
          <span>
            Slices come from <b>{count} Figma Slice layer{count === 1 ? '' : 's'}</b> and use their names. To revise a section, edit it in Figma, then click{' '}
            <b>Refresh from Figma</b>. Cuts changed here are replaced on the next refresh.
          </span>
        ) : (
          <span className="text-muted-foreground">
            No Slice layers found in this Figma frame, so the app sliced it automatically. Add slices in Figma (Slice tool, S) and refresh to use your own.
          </span>
        )}
        {last && (
          <span className="text-muted-foreground">
            Last refresh {new Date(last.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}:{' '}
            {last.changed.length || last.added.length || last.removed.length
              ? [
                  last.changed.length && `${last.changed.length} changed (${last.changed.join(', ')})`,
                  last.added.length && `${last.added.length} new`,
                  last.removed.length && `${last.removed.length} removed`,
                ]
                  .filter(Boolean)
                  .join(', ')
              : 'no changes'}
            .
          </span>
        )}
        </div>
      </div>
      {warnings.map((w) => (
        <div key={w} className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
        </div>
      ))}
    </div>
  )
}
