import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronRight, FolderOpen, Frame, History, Loader2, Search, Settings2, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SettingsDialog } from '@/components/layout/SettingsDialog'
import { useHealth } from '@/hooks/useHealth'
import { api } from '@/lib/api'
import { discoverEmailFrames, parseFigmaUrl } from '@/lib/slicing'
import { cn } from '@/lib/utils'
import { resolveScale, useSettings } from '@/store/settings'
import { useWorkspace } from '@/store/workspace'

interface Target {
  fileKey: string
  nodeId?: string
}

export function FigmaImport() {
  const [url, setUrl] = useState('')
  const [target, setTarget] = useState<Target | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const { figmaToken, recentFigmaUrls, rememberUrl, forgetUrl, scale } = useSettings()
  const health = useHealth()
  const addFigmaJobs = useWorkspace((s) => s.addFigmaJobs)
  const tokenMissing = !figmaToken && health.data && !health.data.figmaTokenConfigured

  const pages = useQuery({
    queryKey: ['figma-pages', target?.fileKey],
    queryFn: () => api.figmaPages(target!.fileKey),
    enabled: !!target && !target.nodeId,
  })

  const node = useQuery({
    queryKey: ['figma-node', target?.fileKey, target?.nodeId],
    queryFn: () => api.figmaNode(target!.fileKey, target!.nodeId!, 4),
    enabled: !!target?.nodeId,
  })

  const frames = useMemo(() => (node.data ? discoverEmailFrames(node.data.document) : []), [node.data])

  const thumbs = useQuery({
    queryKey: ['figma-thumbs', target?.fileKey, frames.map((f) => f.id).join(',')],
    queryFn: () => api.figmaThumbnails(target!.fileKey, frames.map((f) => f.id), 0.2),
    enabled: !!target && frames.length > 0,
    staleTime: 10 * 60_000,
  })

  useEffect(() => {
    setSelected(new Set())
    setFilter('')
  }, [target?.fileKey, target?.nodeId])

  useEffect(() => {
    if (node.data && target) rememberUrl(url, `${node.data.name} › ${node.data.document.name}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.data])

  const submit = (value = url) => {
    const parsed = parseFigmaUrl(value)
    if (!parsed) {
      setTarget(null)
      return
    }
    setUrl(value)
    setTarget(parsed)
  }

  const visibleFrames = frames.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()))
  const invalidUrl = url.trim() !== '' && !parseFigmaUrl(url)
  const error = (pages.error || node.error) as Error | null

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Frame className="size-4" /> From Figma
        </CardTitle>
        <CardDescription>
          Right-click your month's section in Figma → <em>Copy link to selection</em>, then paste it here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {tokenMissing && (
          <Alert variant="warning">
            <Settings2 />
            <AlertTitle>Figma token needed</AlertTitle>
            <AlertDescription>
              <span>
                Add a personal access token in Settings (or <code>FIGMA_TOKEN</code> in <code>.env</code>).
              </span>
              <SettingsDialog trigger={<Button size="sm" variant="outline">Open settings</Button>} />
            </AlertDescription>
          </Alert>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Input
            data-testid="figma-url"
            placeholder="https://www.figma.com/design/…?node-id=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={invalidUrl}
          />
          <Button type="submit" disabled={!url.trim() || invalidUrl}>
            {(pages.isFetching || node.isFetching) && <Loader2 className="animate-spin" />}
            Load
          </Button>
        </form>
        {invalidUrl && <p className="text-destructive -mt-2 text-xs">That doesn't look like a Figma file link.</p>}

        {!target && recentFigmaUrls.length > 0 && (
          <div className="grid gap-1">
            <div className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
              <History className="size-3" /> Recent
            </div>
            {recentFigmaUrls.map((r) => (
              <div key={r.url} className="hover:bg-accent group flex items-center rounded">
                <button className="min-w-0 flex-1 truncate px-2 py-1 text-left text-sm" onClick={() => submit(r.url)}>
                  {r.label}
                </button>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground shrink-0" aria-label="Remove from recent" onClick={() => forgetUrl(r.url)}>
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Figma request failed</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        {/* No node in the link: let the user pick a section/frame. */}
        {target && !target.nodeId && pages.data && (
          <div className="grid gap-3">
            <div className="text-sm">
              <span className="font-medium">{pages.data.name}</span>
              <span className="text-muted-foreground"> — pick a section or frame</span>
            </div>
            <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
              {pages.data.pages.map((p) => (
                <div key={p.id}>
                  <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">{p.name}</div>
                  <div className="grid gap-1">
                    {p.children
                      .filter((c) => ['SECTION', 'FRAME', 'GROUP', 'COMPONENT', 'INSTANCE'].includes(c.type))
                      .map((c) => (
                        <button
                          key={c.id}
                          className="hover:bg-accent flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
                          onClick={() => setTarget({ fileKey: target.fileKey, nodeId: c.id })}
                        >
                          <FolderOpen className="text-muted-foreground size-4" />
                          <span className="flex-1 truncate">{c.name}</span>
                          <Badge variant="outline">{c.type.toLowerCase()}</Badge>
                          <ChevronRight className="text-muted-foreground size-4" />
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {target?.nodeId && node.data && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {!parseFigmaUrl(url)?.nodeId && (
                <Button variant="ghost" size="sm" onClick={() => setTarget({ fileKey: target.fileKey })}>
                  <ArrowLeft /> Back
                </Button>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <span className="text-muted-foreground">{node.data.name} › </span>
                <span className="font-medium">{node.data.document.name}</span>
                <span className="text-muted-foreground"> · {frames.length} emails found</span>
              </div>
              <div className="relative">
                <Search className="text-muted-foreground absolute top-2.5 left-2 size-4" />
                <Input className="h-9 w-44 pl-8" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelected((s) => (s.size === visibleFrames.length ? new Set() : new Set(visibleFrames.map((f) => f.id))))
                }
              >
                {selected.size === visibleFrames.length && visibleFrames.length ? 'Clear' : 'Select all'}
              </Button>
            </div>

            {frames.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No email-sized frames in this node. Link the section that contains your email frames, or a single email frame.
              </p>
            ) : (
              <div className="grid max-h-[560px] grid-cols-2 gap-3 overflow-y-auto p-1 sm:grid-cols-3 xl:grid-cols-4" data-testid="frame-grid">
                {visibleFrames.map((f) => {
                  const on = selected.has(f.id)
                  const thumb = thumbs.data?.images[f.id]
                  const s = resolveScale(scale, f.width)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggle(f.id)}
                      aria-pressed={on}
                      className={cn(
                        'group bg-card relative flex flex-col overflow-hidden rounded-lg border text-left transition-all',
                        on ? 'ring-slice border-slice ring-2' : 'hover:border-foreground/30',
                      )}
                    >
                      <div className="bg-muted checkerboard relative h-44 overflow-hidden">
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full" loading="lazy" />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            {thumbs.isFetching ? <Loader2 className="text-muted-foreground size-4 animate-spin" /> : null}
                          </div>
                        )}
                        <span
                          aria-hidden
                          className={cn(
                            'absolute top-2 left-2 flex size-5 items-center justify-center rounded border shadow',
                            on ? 'bg-slice border-slice text-white' : 'bg-background',
                          )}
                        >
                          {on && <Check className="size-3.5" />}
                        </span>
                      </div>
                      <div className="grid gap-0.5 p-2">
                        <div className="truncate text-sm font-medium">{f.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {Math.round(f.width)}×{Math.round(f.height)} → {Math.round(f.width * s)}px @{s}×
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <span className="text-muted-foreground text-sm">{selected.size} selected</span>
              <Button
                data-testid="import-selected"
                disabled={!selected.size}
                onClick={() => {
                  addFigmaJobs(
                    target.fileKey,
                    node.data!.name,
                    frames.filter((f) => selected.has(f.id)),
                  )
                  setSelected(new Set())
                }}
              >
                Slice {selected.size || ''} {selected.size === 1 ? 'email' : 'emails'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
