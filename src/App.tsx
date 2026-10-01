import { AppHeader } from '@/components/layout/AppHeader'
import { JobSidebar } from '@/components/layout/JobSidebar'
import { ImportView } from '@/components/import/ImportView'
import { SliceStep } from '@/components/slice/SliceStep'
import { OptimizeStep } from '@/components/optimize/OptimizeStep'
import { UploadStep } from '@/components/upload/UploadStep'
import { JobStatusView } from '@/components/layout/JobStatusView'
import { useActiveJob } from '@/hooks/useActiveJob'
import { useApplyTheme } from '@/hooks/useTheme'
import { useWorkspace } from '@/store/workspace'
import { Loader2 } from 'lucide-react'

export default function App() {
  useApplyTheme()
  const view = useWorkspace((s) => s.view)
  const hydrated = useWorkspace((s) => s.hydrated)
  const job = useActiveJob()

  let main: React.ReactNode
  if (!hydrated) {
    main = (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Restoring workspace…
      </div>
    )
  } else if (view === 'import' || !job) {
    main = <ImportView />
  } else if (job.status !== 'ready' || !job.layout) {
    main = <JobStatusView job={job} />
  } else if (job.step === 'slice') {
    main = <SliceStep key={job.id} job={job} />
  } else if (job.step === 'optimize') {
    main = <OptimizeStep key={job.id} job={job} />
  } else {
    main = <UploadStep key={job.id} job={job} />
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <JobSidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{main}</main>
      </div>
    </div>
  )
}
