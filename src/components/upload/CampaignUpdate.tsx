import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, Frame, Loader2, Megaphone, RefreshCw, RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSettings } from '@/store/settings'
import type { EmailJob } from '@/store/workspace'
import type { CampaignState } from '@/hooks/useCampaign'

interface Props {
  job: EmailJob
  campaign: CampaignState
  keyReady: boolean
  /** Approved slices (the ones that go into the email). */
  approved: number
}

/**
 * Optional: pick the cloned (draft) Klaviyo campaign and where the slices go. The Upload step's
 * Send button does the rest, keeping the email in the drag-and-drop editor.
 */
export function CampaignUpdate({ job, campaign: c, keyReady, approved }: Props) {
  const { info, revised } = c
  const hasSkeleton = useSettings((s) => !!s.emailSkeleton)
  // Slices added or removed in Figma since the email was built: updating revised slices can't place
  // or remove those, so say what to do.
  const added = c.built && !c.rebuild ? (job.lastRefresh?.added ?? []) : []
  const removed = c.built && !c.rebuild ? (job.lastRefresh?.removed ?? []) : []

  const last = job.campaign?.lastUpdate

  return (
    <Card className="gap-4" data-testid="campaign-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4" /> Cloned campaign
        </CardTitle>
        <CardDescription>
          Paste the link to your cloned <b>draft</b> campaign — this is where the slices go. The first <b>Send to Klaviyo</b> makes the approved slices
          the whole email, each as a drag-and-drop image block. After that, slices you revise in Figma are swapped in place, so anything you add in
          Klaviyo (timer, footer…) stays.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-72 flex-1 gap-1.5">
            <Label htmlFor="campaign-url">Campaign link</Label>
            <Input
              id="campaign-url"
              placeholder="https://www.klaviyo.com/campaign/01J…/…"
              value={c.url}
              onChange={(e) => c.setUrl(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text')
                if (text.trim() && keyReady) setTimeout(() => c.load(text), 0)
              }}
              onKeyDown={(e) => e.key === 'Enter' && c.url.trim() && c.load()}
            />
          </div>
          <Button variant="outline" onClick={() => c.load()} disabled={!c.url.trim() || c.loading || !keyReady} data-testid="campaign-load">
            {c.loading ? <Loader2 className="animate-spin" /> : info ? <RefreshCw /> : null}
            {info ? 'Reload' : 'Load campaign'}
          </Button>
        </div>

        {revised.length > 0 && (
          <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm" data-testid="campaign-revised">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              <Frame className="size-4" /> {revised.length} slice{revised.length === 1 ? '' : 's'} revised in Figma
            </div>
            <ul className="grid gap-1 text-xs">
              {revised.map(({ slice, approved }) => (
                <li key={slice.id} className="flex items-center gap-1.5">
                  {approved ? <CheckCircle2 className="text-success size-3.5" /> : <CircleDashed className="text-muted-foreground size-3.5" />}
                  <span className="font-medium">{slice.meta.name}</span>
                  <span className="text-muted-foreground">{approved ? 'approved' : 'needs your approval in Optimize & review'}</span>
                </li>
              ))}
            </ul>
            <span className="text-muted-foreground text-xs">
              {c.mode === 'revise'
                ? 'Send to Klaviyo uploads these and swaps just their images in the campaign. Their position and everything else in the email stay the same.'
                : !info
                  ? 'Load the campaign to update just these images in it.'
                  : 'These go in with the rest of the slices when the email is built.'}
            </span>
          </div>
        )}

        {(added.length > 0 || removed.length > 0) && (
          <div className="grid gap-1 rounded-lg border p-3 text-xs" data-testid="campaign-added-removed">
            {added.length > 0 && (
              <span className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <span>
                  New in Figma: <b>{added.join(', ')}</b>. Their images are uploaded, but only revised slices are swapped in the campaign — add them in
                  Klaviyo from the image library, or rebuild the whole email.
                </span>
              </span>
            )}
            {removed.length > 0 && (
              <span className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <span>
                  Removed in Figma: <b>{removed.join(', ')}</b>. {removed.length === 1 ? 'It’s' : 'They’re'} still in the campaign — delete{' '}
                  {removed.length === 1 ? 'it' : 'them'} in Klaviyo, or rebuild the whole email.
                </span>
              </span>
            )}
          </div>
        )}

        {info && (
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{info.campaign.name}</span>
              <Badge variant={info.campaign.editable ? 'success' : 'destructive'}>{info.campaign.status}</Badge>
              <Badge variant={c.editorOk ? 'secondary' : 'destructive'}>{c.editorOk ? 'Drag-and-drop editor' : `${info.template.editorType} editor`}</Badge>
              {info.message.subject && <span className="text-muted-foreground truncate">Subject: {info.message.subject}</span>}
              <a className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs underline" href={c.url} target="_blank" rel="noreferrer">
                Open in Klaviyo <ExternalLink className="size-3" />
              </a>
            </div>

            {c.editorOk && info.summary && (
              <p className="text-sm" data-testid="campaign-plan">
                <span className="text-muted-foreground">
                  Now: {info.summary.sections} section{info.summary.sections === 1 ? '' : 's'}, {info.summary.blocks} block{info.summary.blocks === 1 ? '' : 's'}
                  {info.summary.images.length ? ` (${info.summary.images.length} image${info.summary.images.length === 1 ? '' : 's'})` : ''}.
                </span>{' '}
                {c.mode === 'build' ? (
                  <>
                    <b>Send to Klaviyo</b> removes all of it — header and footer included — and adds your {approved} approved slice
                    {approved === 1 ? '' : 's'}, each as a drag-and-drop image block, on the White_BG background.
                  </>
                ) : (
                  <>Built from the slices already; Send only swaps slices you revise in Figma.</>
                )}
              </p>
            )}
            {c.built && c.editorOk && (
              <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="campaign-rebuild">
                {c.rebuild ? (
                  <>
                    <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-3.5" /> Rebuild on: Send removes everything in this email, including what you added in Klaviyo (timer,
                      footer…).
                    </span>
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => c.setRebuild(false)}>
                      <X /> Keep my additions
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => c.setRebuild(true)}>
                    <RotateCcw /> Rebuild whole email…
                  </Button>
                )}
              </div>
            )}
            {c.editorOk && info.definitionError && (
              <div className="grid gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm" data-testid="campaign-no-layout">
                <span>
                  Klaviyo can’t export this email’s current layout, so the app can’t show what’s in it
                  {c.mode === 'build' ? (
                    <>
                      . That’s fine: <b>Send to Klaviyo</b> replaces all of it with your {approved} approved slice{approved === 1 ? '' : 's'} on the White_BG
                      background.
                    </>
                  ) : (
                    <> or swap single images in it — fix the header block it mentions in Klaviyo, then click Reload.</>
                  )}
                </span>
                <span className="text-muted-foreground text-xs">
                  Klaviyo says: “{info.definitionError}”.{' '}
                  {hasSkeleton
                    ? 'The email width and colours from the last campaign that loaded fully are reused.'
                    : 'No earlier campaign settings are saved yet, so a 600px email on white is used.'}
                </span>
              </div>
            )}
          </div>
        )}

        {last && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" data-testid="campaign-done">
            <CheckCircle2 className="text-success size-4" />
            <span>
              Built {new Date(last.at).toLocaleString()} from {last.inserted} slice row{last.inserted === 1 ? '' : 's'}. Revise slices in Figma, click{' '}
              <b>Refresh from Figma</b>, approve them, and Send swaps just those.
            </span>
          </div>
        )}
      </CardContent>

    </Card>
  )
}
