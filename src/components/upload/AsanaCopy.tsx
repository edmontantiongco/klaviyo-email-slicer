import { AlertTriangle, CheckCircle2, ExternalLink, Info, ListChecks, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SettingsDialog } from '@/components/layout/SettingsDialog'
import type { AsanaState } from '@/hooks/useAsana'
import type { CampaignState } from '@/hooks/useCampaign'

function Note({ tone, children }: { tone: 'ok' | 'warn' | 'info'; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : Info
  return (
    <span className="flex items-start gap-1.5 text-xs">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-amber-500' : 'text-muted-foreground'}`} />
      <span>{children}</span>
    </span>
  )
}

/** Shows a "Klaviyo now → from Asana" line for the subject or preview text. */
function CopyLine({ label, now, next }: { label: string; now?: string; next: string | null }) {
  return (
    <div className="grid gap-0.5 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      {next ? <span className="font-medium">{next}</span> : <span className="text-amber-600 dark:text-amber-400">Not found in the task description</span>}
      {now !== undefined && now !== next && <span className="text-muted-foreground text-xs">In Klaviyo now: {now || '(empty)'}</span>}
    </div>
  )
}

/** The email's Asana task: subject line + preview text for the first Send, and the campaign link back to Asana. */
export function AsanaCopy({ asana: a, campaign: c }: { asana: AsanaState; campaign: CampaignState }) {
  const { task } = a
  const message = c.info?.message
  // Statuses that mean the copy may still change.
  const draftStatus = task?.status && !/approved|done|complete|ready|scheduled|live|sent/i.test(task.status)

  return (
    <Card className="gap-4" data-testid="asana-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="size-4" /> Subject &amp; preview text from Asana
        </CardTitle>
        <CardDescription>
          The first <b>Send to Klaviyo</b> to the cloned campaign sets its subject line and preview text from the email’s Asana task, and adds the
          campaign link to the task’s Link (US) / Link (CA) field. Later sends leave the subject alone, so edits made in Klaviyo stay.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!a.tokenReady ? (
          <Note tone="info">
            No Asana token yet — the campaign keeps the subject it was cloned with.{' '}
            <SettingsDialog trigger={<button className="underline">Add an Asana token</button>} />
          </Note>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-72 flex-1 gap-1.5">
                <Label>Asana task{a.date ? ` (emails dated ${a.date})` : ''}</Label>
                <Select value={task?.gid ?? ''} onValueChange={(gid) => a.pick(gid)} disabled={a.loading}>
                  <SelectTrigger className="w-full" data-testid="asana-task">
                    <SelectValue placeholder={a.loading ? 'Looking in Asana…' : 'No task found'} />
                  </SelectTrigger>
                  <SelectContent>
                    {task && !a.matches.some((m) => m.gid === task.gid) && <SelectItem value={task.gid}>{task.name}</SelectItem>}
                    {a.matches.map((m) => (
                      <SelectItem key={m.gid} value={m.gid}>
                        {m.name}
                        {m.completed ? ' (completed)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                className="w-64"
                placeholder="…or paste the Asana task link"
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (text.trim()) setTimeout(() => a.pick(text), 0)
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.value.trim() && a.pick(e.currentTarget.value)}
              />
              <Button variant="outline" size="icon" onClick={() => a.search()} disabled={a.loading} aria-label="Search Asana again">
                {a.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              </Button>
            </div>

            {a.error && <Note tone="warn">{a.error}</Note>}

            {task && (
              <div className="grid gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{task.name}</span>
                  {task.status && <Badge variant={draftStatus ? 'warning' : 'secondary'}>{task.status}</Badge>}
                  <a className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs underline" href={task.url} target="_blank" rel="noreferrer">
                    Open in Asana <ExternalLink className="size-3" />
                  </a>
                </div>
                <CopyLine label="Subject line" now={message?.subject} next={task.subject} />
                <CopyLine label="Preview text" now={message?.previewText} next={task.previewText} />

                <div className="grid gap-1.5">
                  {draftStatus && <Note tone="warn">The task is still “{task.status}” — check the copy is final before you send.</Note>}
                  {a.copySet ? (
                    <Note tone="ok">Set from Asana on {new Date(a.copySet.at).toLocaleString()}. Later sends leave the subject and preview text alone.</Note>
                  ) : c.built ? (
                    <Note tone="info">This campaign was built before, so Send leaves its subject and preview text alone — change them in Klaviyo if needed.</Note>
                  ) : !task.subject ? (
                    <Note tone="warn">No “Subject line” label in the task description, so the campaign keeps its own subject.</Note>
                  ) : (
                    <label className="flex items-center gap-2 text-xs">
                      <Switch checked={a.setCopy} onCheckedChange={a.setSetCopy} data-testid="asana-set-copy" />
                      {a.setCopy ? 'Send sets these in the cloned campaign' : 'Keep the campaign’s own subject and preview text'}
                    </label>
                  )}
                  {!a.region ? (
                    <Note tone="info">The campaign name doesn’t say US or CA, so the link isn’t added to Asana.</Note>
                  ) : !a.linkField ? (
                    <Note tone="info">The task has no “Link ({a.region})” field, so the link isn’t added to Asana.</Note>
                  ) : a.linkField.value.trim() === a.campaignUrl || a.linked ? (
                    <Note tone="ok">Link ({a.region}) in Asana points to this campaign.</Note>
                  ) : a.linkField.value.trim() ? (
                    <Note tone="warn">
                      Link ({a.region}) already has a link in Asana ({a.linkField.value}), so it’s left alone.
                    </Note>
                  ) : (
                    <Note tone="info">Send adds this campaign’s link to Link ({a.region}) in Asana.</Note>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
