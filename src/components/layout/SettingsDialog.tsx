import { useState } from 'react'
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHealth } from '@/hooks/useHealth'
import { api } from '@/lib/api'
import { DEFAULT_FOOTER_HTML } from '@/lib/html'
import { useSettings } from '@/store/settings'

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`flex items-center gap-1 text-xs ${ok ? 'text-success' : 'text-muted-foreground'}`}>
      {ok ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}
      {label}
    </span>
  )
}

export function SettingsDialog({ trigger }: { trigger?: React.ReactNode }) {
  const s = useSettings()
  const health = useHealth()
  const [testing, setTesting] = useState(false)

  const figmaOk = !!s.figmaToken || !!health.data?.figmaTokenConfigured
  const klaviyoOk = !!s.klaviyoKey || !!health.data?.klaviyoKeyConfigured

  return (
    <Dialog onOpenChange={(o) => o && health.refetch()}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" aria-label="Settings" data-testid="open-settings">
            <Settings />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Keys are kept in this browser and only sent to the local API server on your machine. You can also put them in{' '}
            <code className="bg-muted rounded px-1">.env</code> instead.
          </DialogDescription>
        </DialogHeader>

        {health.isError && (
          <p className="text-destructive text-sm">Local API server isn't reachable — start it with <code>npm run dev</code>.</p>
        )}

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="figma-token">Figma personal access token</Label>
            <Status ok={figmaOk} label={s.figmaToken ? 'set here' : health.data?.figmaTokenConfigured ? 'from .env' : 'missing'} />
          </div>
          <Input
            id="figma-token"
            type="password"
            autoComplete="off"
            placeholder="figd_…"
            value={s.figmaToken}
            onChange={(e) => s.set({ figmaToken: e.target.value })}
          />
          <p className="text-muted-foreground text-xs">
            Figma → Settings → Security → Personal access tokens. Scope: <em>File content – read only</em>.
          </p>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="klaviyo-key">Klaviyo private API key</Label>
            <Status ok={klaviyoOk} label={s.klaviyoKey ? 'set here' : health.data?.klaviyoKeyConfigured ? 'from .env' : 'missing'} />
          </div>
          <div className="flex gap-2">
            <Input
              id="klaviyo-key"
              type="password"
              autoComplete="off"
              placeholder="pk_…"
              value={s.klaviyoKey}
              onChange={(e) => s.set({ klaviyoKey: e.target.value })}
            />
            <Button
              variant="outline"
              disabled={testing || !klaviyoOk}
              onClick={async () => {
                setTesting(true)
                try {
                  await api.klaviyoTest()
                  toast.success('Klaviyo key works')
                } catch (e) {
                  toast.error('Klaviyo test failed', { description: (e as Error).message })
                } finally {
                  setTesting(false)
                }
              }}
            >
              {testing && <Loader2 className="animate-spin" />}Test
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Scopes: Campaigns (read + write), Templates (read + write), Images (read + write).{' '}
            <a className="inline-flex items-center gap-0.5 underline" href="https://www.klaviyo.com/settings/account/api-keys" target="_blank" rel="noreferrer">
              Manage keys <ExternalLink className="size-3" />
            </a>
          </p>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Figma export scale</Label>
            <Select value={s.scale} onValueChange={(v) => s.set({ scale: v as typeof s.scale })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (→ 1200px wide)</SelectItem>
                <SelectItem value="1">1×</SelectItem>
                <SelectItem value="2">2×</SelectItem>
                <SelectItem value="3">3×</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="content-width">Email width in HTML (px)</Label>
            <Input
              id="content-width"
              type="number"
              min={320}
              max={1200}
              value={s.contentWidth}
              onChange={(e) => s.set({ contentWidth: Math.max(320, Math.min(1200, Number(e.target.value) || 600)) })}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="footer">Append Klaviyo footer (unsubscribe + address)</Label>
            <Switch id="footer" checked={s.footer} onCheckedChange={(v) => s.set({ footer: v })} />
          </div>
          {s.footer && (
            <>
              <Textarea
                className="font-mono text-xs"
                value={s.footerHtml}
                onChange={(e) => s.set({ footerHtml: e.target.value })}
                rows={2}
              />
              <button className="text-muted-foreground w-fit text-xs underline" onClick={() => s.set({ footerHtml: DEFAULT_FOOTER_HTML })}>
                Reset to default
              </button>
            </>
          )}
          <p className="text-muted-foreground text-xs">
            Klaviyo requires a working unsubscribe link. If your design already has a clickable footer slice linked to{' '}
            <code>{'{% unsubscribe_url %}'}</code>, you can switch this off.
          </p>
        </div>

        <div className="grid gap-4">
          <div className="flex items-end justify-between gap-2 pb-2">
            <Label htmlFor="hide">Hide uploads from asset library</Label>
            <Switch id="hide" checked={s.hideUploadsInLibrary} onCheckedChange={(v) => s.set({ hideUploadsInLibrary: v })} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
