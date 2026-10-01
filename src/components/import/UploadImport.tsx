import { useDropzone } from 'react-dropzone'
import { ImagePlus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

export function UploadImport() {
  const addUploadJobs = useWorkspace((s) => s.addUploadJobs)
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] },
    onDrop: (files) => files.length && addUploadJobs(files),
  })
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Or upload exported images</CardTitle>
        <CardDescription>No Figma access? Drop full-email PNG/JPGs. Slicing uses pixel analysis instead of layers.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          {...getRootProps()}
          data-testid="dropzone"
          className={cn(
            'text-muted-foreground flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition-colors',
            isDragActive ? 'border-slice bg-slice/5 text-foreground' : 'hover:border-foreground/30',
          )}
        >
          <input {...getInputProps()} />
          <ImagePlus className="size-6" />
          {isDragActive ? 'Drop to import' : 'Drag images here, or click to browse'}
        </div>
      </CardContent>
    </Card>
  )
}
