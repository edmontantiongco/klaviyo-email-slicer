import { FigmaImport } from './FigmaImport'
import { UploadImport } from './UploadImport'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Gauge, Layers, ShieldCheck, Upload } from 'lucide-react'

// The app's steps at a glance. Keep in step with the app: update these whenever a step changes
// (see CLAUDE.md).
const PIPELINE = [
  { icon: Layers, title: 'Slices from Figma', text: 'Your Figma Slice layers become the slices, with their names. Areas they don’t cover are kept as “Unsliced area”.' },
  { icon: Gauge, title: 'Squoosh-grade compression', text: 'MozJPEG / OxiPNG in your browser, tuned to stay under your size ceiling.' },
  { icon: ShieldCheck, title: 'Human approval gate', text: 'Compare every slice before/after. Only approved slices upload; unapproved ones are deleted when you send.' },
  {
    icon: Upload,
    title: 'Straight to Klaviyo',
    text: 'One Send, after a review: uploads the approved slices, then rebuilds your cloned draft campaign with them on the White_BG background.',
  },
]

export function ImportView() {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-6xl gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import emails</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Paste a link to a Figma section (e.g. your “October 2026” section) and pick the emails to slice — or drop exported images.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <FigmaImport />
          <div className="grid content-start gap-6">
            <UploadImport />
            <div className="grid gap-3">
              {PIPELINE.map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex gap-3">
                  <div className="bg-slice/10 text-slice flex size-8 shrink-0 items-center justify-center rounded-md">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-muted-foreground text-xs">{text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
