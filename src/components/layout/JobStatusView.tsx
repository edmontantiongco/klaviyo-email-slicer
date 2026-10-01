import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsDialog } from './SettingsDialog'
import { useWorkspace, type EmailJob } from '@/store/workspace'

export function JobStatusView({ job }: { job: EmailJob }) {
  const reload = useWorkspace((s) => s.reloadJob)
  const remove = useWorkspace((s) => s.removeJob)
  if (job.status === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <AlertTriangle className="text-destructive size-10" />
        <div>
          <h2 className="text-lg font-semibold">Couldn't load “{job.name}”</h2>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">{job.error}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => reload(job.id)}>
            <RotateCw /> Retry
          </Button>
          <SettingsDialog trigger={<Button variant="outline">Check settings</Button>} />
          <Button variant="ghost" onClick={() => remove(job.id)}>
            Remove
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3">
      <Loader2 className="size-8 animate-spin" />
      <div className="text-sm">{job.loadingLabel ?? 'Loading…'}</div>
      <div className="text-xs">{job.name}</div>
    </div>
  )
}
