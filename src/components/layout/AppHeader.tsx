import { Check, ChevronRight, Download, Monitor, Moon, Scissors, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useActiveJob } from '@/hooks/useActiveJob'
import { useJobSlices } from '@/hooks/useJobStats'
import { exportZip } from '@/lib/exporters'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { useWorkspace, type JobStep } from '@/store/workspace'
import { SettingsDialog } from './SettingsDialog'

type StepId = 'import' | JobStep

export function AppHeader() {
  const view = useWorkspace((s) => s.view)
  const setView = useWorkspace((s) => s.setView)
  const setStep = useWorkspace((s) => s.setStep)
  const activeJob = useActiveJob()
  // On the Import page you're starting a new email, so the later steps show no email until you
  // import one or pick one from the sidebar.
  const job = view === 'import' ? undefined : activeJob
  const { stats } = useJobSlices(job)
  const theme = useSettings((s) => s.theme)
  const setSettings = useSettings((s) => s.set)

  const ready = job?.status === 'ready' && !!job.layout
  const current: StepId = !job ? 'import' : job.step
  const allApproved = stats.total > 0 && stats.approved === stats.total

  const noEmail = job ? undefined : 'Import an email, or pick one from the list on the left'

  const steps: { id: StepId; label: string; enabled: boolean; done: boolean; hint?: string }[] = [
    { id: 'import', label: 'Import', enabled: true, done: !!job },
    { id: 'slice', label: 'Slice', enabled: ready, done: ready && job!.step !== 'slice', hint: noEmail },
    { id: 'optimize', label: 'Optimize & review', enabled: ready, done: allApproved, hint: noEmail },
    {
      id: 'upload',
      label: 'Upload',
      enabled: ready && stats.approved > 0,
      done: stats.total > 0 && stats.uploaded === stats.total,
      hint: noEmail ?? 'Approve at least one slice first',
    },
  ]

  const go = (id: StepId) => {
    if (id === 'import') return setView('import')
    if (!job) return
    setView('job')
    setStep(job.id, id)
  }

  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <header className="bg-card flex h-14 shrink-0 items-center gap-4 border-b px-4">
      <button
        className="flex cursor-pointer items-center gap-2 rounded-md font-semibold tracking-tight transition-opacity hover:opacity-80"
        onClick={() => setView('import')}
        title="Start another email"
        aria-label="Email Slicer — start another email"
      >
        <div className="bg-slice text-white flex size-7 items-center justify-center rounded-md">
          <Scissors className="size-4" />
        </div>
        <span className="hidden sm:inline">Email Slicer</span>
      </button>

      <nav className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto" aria-label="Steps">
        {steps.map((s, i) => {
          const active = s.id === current
          const btn = (
            <button
              type="button"
              disabled={!s.enabled}
              onClick={() => go(s.id)}
              data-testid={`step-${s.id}`}
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground',
                !s.enabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                s.enabled && 'cursor-pointer',
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border text-[11px] font-medium',
                  active ? 'border-primary-foreground/40' : 'border-current/30',
                  s.done && !active && 'bg-success border-success text-white',
                )}
              >
                {s.done && !active ? <Check className="size-3" /> : i + 1}
              </span>
              {s.label}
            </button>
          )
          return (
            <div key={s.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="text-muted-foreground/50 size-4 shrink-0" />}
              {!s.enabled && s.hint && (ready || !job) ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>{btn}</span>
                  </TooltipTrigger>
                  <TooltipContent>{s.hint}</TooltipContent>
                </Tooltip>
              ) : (
                btn
              )}
            </div>
          )
        })}
      </nav>

      <div className="flex items-center gap-1">
        {ready && view === 'job' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={stats.done === 0}
                onClick={async () => {
                  try {
                    const { count, missing } = await exportZip(job!)
                    toast.success(`Exported ${count} slices + index.html`, {
                      description: missing ? `${missing} slices weren't compressed yet and were skipped.` : undefined,
                    })
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              >
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download ZIP (images + HTML + manifest)</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => setSettings({ theme: nextTheme })}>
              <ThemeIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Theme: {theme}</TooltipContent>
        </Tooltip>
        <SettingsDialog />
      </div>
    </header>
  )
}
