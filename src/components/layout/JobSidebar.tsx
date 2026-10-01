import { AlertTriangle, CheckCircle2, CloudUpload, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useJobSlices } from '@/hooks/useJobStats'
import { cn } from '@/lib/utils'
import { useWorkspace, type EmailJob } from '@/store/workspace'

function JobItem({ job, active }: { job: EmailJob; active: boolean }) {
  const setActive = useWorkspace((s) => s.setActive)
  const removeJob = useWorkspace((s) => s.removeJob)
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
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              removeJob(job.id)
            }}
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove from workspace</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function JobSidebar() {
  const jobs = useWorkspace((s) => s.jobs)
  const activeId = useWorkspace((s) => s.activeId)
  const view = useWorkspace((s) => s.view)
  const setView = useWorkspace((s) => s.setView)
  if (!jobs.length) return null
  return (
    <aside className="bg-card hidden w-64 shrink-0 flex-col border-r md:flex">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Emails ({jobs.length})</span>
        <Button variant="outline" size="sm" onClick={() => setView('import')}>
          <Plus /> Import
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-1 px-2 pb-3">
          {jobs.map((j) => (
            <JobItem key={j.id} job={j} active={view === 'job' && j.id === activeId} />
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}
