import { AlertTriangle, CheckCircle2, CloudUpload, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useJobSlices } from '@/hooks/useJobStats'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { byRecent, isJobSent, useWorkspace, type EmailJob } from '@/store/workspace'

function JobItem({ job, active, onDelete }: { job: EmailJob; active: boolean; onDelete: () => void }) {
  const setActive = useWorkspace((s) => s.setActive)
  const { stats } = useJobSlices(job)

  let status: React.ReactNode
  if (job.status === 'loading')
    status = (
      <span className="flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" /> {job.loadingLabel ?? 'Loading…'}
      </span>
    )
  else if (job.status === 'error')
    status = (
      <span className="text-destructive flex items-center gap-1">
        <AlertTriangle className="size-3" /> Failed
      </span>
    )
  else if (stats.total && stats.uploaded === stats.total)
    status = (
      <span className="text-success flex items-center gap-1">
        <CloudUpload className="size-3" /> Uploaded
      </span>
    )
  else if (stats.total && stats.approved === stats.total)
    status = (
      <span className="text-success flex items-center gap-1">
        <CheckCircle2 className="size-3" /> Approved
      </span>
    )
  else
    status = (
      <span>
        {stats.total} slices
        {stats.done > 0 && ` · ${stats.approved}/${stats.total} approved`}
      </span>
    )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setActive(job.id)}
      onKeyDown={(e) => e.key === 'Enter' && setActive(job.id)}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/60',
      )}
    >
      <div className="bg-muted flex h-12 w-9 shrink-0 items-start justify-center overflow-hidden rounded border">
        {job.imageUrl && <img src={job.imageUrl} alt="" className="w-full" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{job.name}</div>
        <div className="text-muted-foreground truncate text-xs">{status}</div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${job.name}`}
            data-testid="delete-email"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete from the app</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function JobSidebar() {
  const jobs = useWorkspace((s) => s.jobs)
  const activeId = useWorkspace((s) => s.activeId)
  const view = useWorkspace((s) => s.view)
  const setView = useWorkspace((s) => s.setView)
  const removeJob = useWorkspace((s) => s.removeJob)
  const compress = useSettings((s) => s.compress)
  /** Emails waiting for the user to confirm their deletion. */
  const [toDelete, setToDelete] = useState<EmailJob[] | null>(null)
  // Kept while the dialog animates closed, so its text doesn't blank out.
  const [shown, setShown] = useState<EmailJob[]>([])
  if (toDelete && toDelete !== shown) setShown(toDelete)
  if (!jobs.length) return null
  const sent = jobs.filter((j) => isJobSent(j, compress))
  return (
    <aside className="bg-card hidden w-64 shrink-0 flex-col border-r md:flex">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Emails ({jobs.length})</span>
        <Button variant="outline" size="sm" onClick={() => setView('import')}>
          <Plus /> Import
        </Button>
      </div>
      {sent.length > 0 && (
        <button className="text-muted-foreground hover:text-destructive mx-3 mb-2 flex w-fit items-center gap-1 text-xs" onClick={() => setToDelete(sent)} data-testid="delete-sent">
          <Trash2 className="size-3" /> Delete {sent.length} sent email{sent.length === 1 ? '' : 's'}
        </button>
      )}
      {/* Radix sizes its content box to the widest row; keep it to the sidebar's width so long names truncate and the delete button stays visible. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="grid grid-cols-1 gap-1 px-2 pb-3">
          {byRecent(jobs).map((j) => (
            <JobItem key={j.id} job={j} active={view === 'job' && j.id === activeId} onDelete={() => setToDelete([j])} />
          ))}
        </div>
      </ScrollArea>

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{shown.length === 1 ? `Delete “${shown[0].name}”?` : `Delete ${shown.length} sent emails?`}</DialogTitle>
            <DialogDescription>
              {shown.length === 1 ? 'It’s' : 'They’re'} removed from the app with {shown.length === 1 ? 'its' : 'their'} slices. Images already in Klaviyo
              and the Klaviyo campaign stay as they are.
            </DialogDescription>
          </DialogHeader>
          {shown.length > 1 && (
            <ul className="text-muted-foreground max-h-48 list-disc overflow-y-auto pl-5 text-sm">
              {shown.map((j) => (
                <li key={j.id}>{j.name}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="confirm-delete"
              onClick={() => {
                toDelete?.forEach((j) => removeJob(j.id))
                setToDelete(null)
              }}
            >
              <Trash2 /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
