import { useMemo, useRef, useState } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { emailHtml } from '@/lib/exporters'
import { cn } from '@/lib/utils'
import type { EmailJob } from '@/store/workspace'
import { BackgroundPicker } from '@/components/common/BackgroundPicker'

/** Renders the generated email HTML with the compressed slices, exactly as it'll be stitched in the inbox. */
export function EmailPreview({ job }: { job: EmailJob }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [height, setHeight] = useState(800)
  const ref = useRef<HTMLIFrameElement>(null)
  const html = useMemo(() => emailHtml(job, 'local'), [job])

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <div className="bg-muted flex rounded-md p-0.5">
          <Button size="sm" variant="ghost" className={cn(device === 'desktop' && 'bg-background shadow-sm')} onClick={() => setDevice('desktop')}>
            <Monitor /> Desktop
          </Button>
          <Button size="sm" variant="ghost" className={cn(device === 'mobile' && 'bg-background shadow-sm')} onClick={() => setDevice('mobile')}>
            <Smartphone /> Mobile
          </Button>
        </div>
        <span className="text-muted-foreground hidden text-xs xl:inline">Stitched from the compressed slices — check seams, links and alignment.</span>
        <div className="ml-auto">
          <BackgroundPicker job={job} />
        </div>
      </div>
      <div className="bg-muted/40 flex justify-center rounded-lg border p-4">
        <iframe
          ref={ref}
          key={device}
          title="Email preview"
          srcDoc={html}
          className="bg-white shadow-lg transition-[width]"
          style={{ width: device === 'desktop' ? '100%' : 375, maxWidth: 900, height }}
          onLoad={() => {
            const doc = ref.current?.contentDocument
            if (!doc) return
            const measure = () => setHeight(Math.max(400, doc.documentElement.scrollHeight))
            measure()
            doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure))
            // Open links in a new tab rather than inside the frame.
            doc.querySelectorAll('a').forEach((a) => a.setAttribute('target', '_blank'))
          }}
        />
      </div>
    </div>
  )
}
