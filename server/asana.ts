import { Router, type Request } from 'express'
import { HttpError, fetchWithRetry } from './http.ts'
import { asanaTaskGid, findCopy, LINK_FIELDS, scoreTask, type Region } from './asanaText.ts'

/**
 * Reads an email's Asana task (subject line + preview text) and writes the Klaviyo campaign link
 * back into its "Link (US)" / "Link (CA)" field.
 *
 * Token: an Asana personal access token (Asana → Settings → Apps → Developer apps).
 */

const ASANA_API = process.env.ASANA_API_BASE || 'https://app.asana.com/api/1.0'

function token(req: Request): string {
  const t = (req.header('x-asana-token') || process.env.ASANA_TOKEN || '').trim()
  if (!t) throw new HttpError(401, 'No Asana token configured. Add ASANA_TOKEN to .env or set it in Settings.')
  return t
}

async function asana<T = any>(req: Request, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(`${ASANA_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token(req)}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
  })
  const body = (await res.json().catch(() => ({}))) as any
  if (!res.ok) {
    const msg = body?.errors?.[0]?.message ?? `Asana API error (${res.status})`
    throw new HttpError(res.status, res.status === 401 ? `Asana: ${msg} — check the Asana token in Settings.` : `Asana: ${msg}`)
  }
  return body.data as T
}

// The workspace to search; looked up once per token.
const workspaces = new Map<string, string>()

async function workspace(req: Request): Promise<string> {
  if (process.env.ASANA_WORKSPACE) return process.env.ASANA_WORKSPACE
  const key = token(req)
  const known = workspaces.get(key)
  if (known) return known
  const me = await asana<{ workspaces: { gid: string; name: string }[] }>(req, '/users/me?opt_fields=workspaces.name')
  const ws = me.workspaces?.[0]?.gid
  if (!ws) throw new HttpError(404, 'Asana: this token has no workspace.')
  workspaces.set(key, ws)
  return ws
}

const TASK_FIELDS = 'name,notes,completed,permalink_url,custom_fields.gid,custom_fields.name,custom_fields.text_value,custom_fields.display_value'

async function readTask(req: Request, gid: string) {
  const t = await asana<any>(req, `/tasks/${gid}?opt_fields=${TASK_FIELDS}`)
  const fields: any[] = t.custom_fields ?? []
  const field = (name: string) => fields.find((f) => String(f.name).trim().toLowerCase() === name.toLowerCase())
  const link = (region: Region) => {
    const f = field(LINK_FIELDS[region])
    return f ? { gid: String(f.gid), value: (f.text_value ?? '') as string } : null
  }
  const copy = findCopy(t.notes ?? '')
  return {
    gid: String(t.gid),
    name: String(t.name ?? ''),
    url: String(t.permalink_url ?? ''),
    completed: !!t.completed,
    status: (field('Status')?.display_value ?? null) as string | null,
    subject: copy.subject,
    previewText: copy.previewText,
    links: { US: link('US'), CA: link('CA') },
  }
}

export const asanaRouter = Router()

/** Tasks that may be this email's, best match first. */
asanaRouter.post('/search', async (req, res) => {
  const query = String(req.body?.query ?? '').trim()
  const name = String(req.body?.name ?? '')
  if (!query) throw new HttpError(400, 'query is required')
  const ws = await workspace(req)
  const found = await asana<any[]>(
    req,
    `/workspaces/${ws}/typeahead?resource_type=task&count=30&query=${encodeURIComponent(query)}&opt_fields=name,completed,permalink_url`,
  )
  const tasks = found
    .map((t) => ({ gid: String(t.gid), name: String(t.name ?? ''), url: String(t.permalink_url ?? ''), completed: !!t.completed, score: scoreTask(t.name ?? '', query, name) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
  res.json({ tasks })
})

/** A task's subject line, preview text, status and link fields. Accepts a task gid or Asana link. */
asanaRouter.get('/tasks/:id', async (req, res) => {
  const gid = asanaTaskGid(req.params.id)
  if (!gid) throw new HttpError(400, 'That doesn’t look like an Asana task link.')
  res.json(await readTask(req, gid))
})

/**
 * Puts the Klaviyo campaign link in the task's Link (US) / Link (CA) field — only when it's empty,
 * so a link someone set by hand is never replaced.
 */
asanaRouter.post('/tasks/:id/link', async (req, res) => {
  const gid = asanaTaskGid(req.params.id)
  const region = req.body?.region as Region
  const url = String(req.body?.url ?? '')
  if (!gid || !LINK_FIELDS[region] || !/^https:\/\//.test(url)) throw new HttpError(400, 'task, region (US or CA) and url are required')
  const task = await readTask(req, gid)
  const field = task.links[region]
  if (!field) throw new HttpError(422, `The Asana task has no “${LINK_FIELDS[region]}” field.`)
  if (field.value.trim()) return void res.json({ written: false, existing: field.value })
  await asana(req, `/tasks/${gid}`, { method: 'PUT', body: JSON.stringify({ data: { custom_fields: { [field.gid]: url } } }) })
  res.json({ written: true })
})
