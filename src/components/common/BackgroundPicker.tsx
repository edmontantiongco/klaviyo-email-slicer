import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sampleBackground } from '@/lib/image'
import { useWorkspace, type EmailJob } from '@/store/workspace'

/** Outer background colour of the generated HTML (around the 600px email). */
export function BackgroundPicker({ job }: { job: EmailJob }) {
  const patchJob = useWorkspace((s) => s.patchJob)
  const edge = useMemo(() => (job.bitmap ? sampleBackground(job.bitmap) : null), [job.bitmap])
  const swatches = [...new Set(['#ffffff', '#f4f4f4', '#000000', ...(edge ? [edge] : [])])]
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="bg-color" className="text-muted-foreground text-xs font-normal whitespace-nowrap">
        Outer background
      </Label>
      <input
        id="bg-color"
        type="color"
        value={job.background}
        onChange={(e) => patchJob(job.id, { background: e.target.value })}
        className="size-7 cursor-pointer rounded border bg-transparent p-0.5"
      />
      {swatches.map((c) => (
        <Tooltip key={c}>
          <TooltipTrigger asChild>
            <button
              className="size-5 cursor-pointer rounded-full border shadow-xs"
              style={{ background: c }}
              onClick={() => patchJob(job.id, { background: c })}
              aria-label={`Use ${c}`}
            />
          </TooltipTrigger>
          <TooltipContent>{c === edge ? `Design edge colour ${c}` : c}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
