import { Router, type Request } from 'express'
import { HttpError, fetchWithRetry } from './http.ts'
import { KLAVIYO_API, headers, readKlaviyo } from './klaviyo.ts'
import { idsFromKlaviyoUrl, insertRows, removeBlocks, replaceImages, stripIds, summarize, swapImages, type ImageSwap, type SliceAnchor, type SliceRowInput } from './dnd.ts'
import type { Json } from './dnd.ts'

/**
 * Update a cloned Klaviyo campaign in place: swap its image blocks for the new slices
 * while keeping the email in the drag-and-drop editor.
 *
 * Scopes: campaigns:read, campaigns:write, templates:read, templates:write (+ images:write for uploads).
 */

const JSONAPI = { 'content-type': 'application/vnd.api+json' }

async function kGet(req: Request, p: string) {
  return readKlaviyo(await fetchWithRetry(`${KLAVIYO_API}${p}`, { headers: headers(req) }))
}

async function kSend(req: Request, method: string, p: string, body?: unknown) {
  const r = await fetchWithRetry(`${KLAVIYO_API}${p}`, { method, headers: headers(req, JSONAPI), body: body ? JSON.stringify(body) : undefined })
  if (r.status === 204) return {}
  return readKlaviyo(r)
}

const isNotFound = (e: unknown) => e instanceof HttpError && (e.status === 404 || e.status === 400)

function scopeHint(e: unknown): never {
  if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
    throw new HttpError(
      e.status,
      `${e.message} — the Klaviyo key needs these scopes: Campaigns (Read + Write), Templates (Read + Write), Images (Read + Write).`,
    )
  }
  throw e
}

interface Loaded {
  campaign: { id: string; name: string; status: string; editable: boolean }
  message: { id: string; subject: string; previewText: string; label: string }
  template: { id: string; name: string; editorType: string; updated: string | null }
  definition: Json | null
}

async function findCampaign(req: Request, input: string): Promise<{ campaign: Json; included: Json[] }> {
  const ids = idsFromKlaviyoUrl(input)
  if (!ids.length) throw new HttpError(400, 'Could not find a campaign id in that link. Open the cloned campaign in Klaviyo and copy the URL from the address bar.')
  for (const id of ids) {
    try {
      const body = await kGet(req, `/campaigns/${id}?include=campaign-messages`)
      return { campaign: body.data, included: body.included ?? [] }
    } catch (e) {
      if (!isNotFound(e)) scopeHint(e)
    }
    // The link may point at the email (campaign message) rather than the campaign.
    try {
      const msg = await kGet(req, `/campaign-messages/${id}?include=campaign`)
      const cid = msg.data?.relationships?.campaign?.data?.id ?? msg.included?.find((x: Json) => x.type === 'campaign')?.id
      if (cid) {
        const body = await kGet(req, `/campaigns/${cid}?include=campaign-messages`)
        return { campaign: body.data, included: body.included ?? [] }
      }
    } catch (e) {
      if (!isNotFound(e)) scopeHint(e)
    }
  }
  throw new HttpError(404, 'No campaign found for that link. Check the link, and that the API key belongs to the same Klaviyo account.')
}

export async function loadCampaign(req: Request, input: { url?: string; campaignId?: string }): Promise<Loaded> {
  const { campaign, included } = await findCampaign(req, input.campaignId ?? input.url ?? '')
  const a = campaign.attributes ?? {}
  const messages = included.filter((x) => x.type === 'campaign-message')
  const msg =
    messages.find((m) => (m.attributes?.definition?.channel ?? m.attributes?.channel) === 'email') ??
    messages[0]
  if (!msg) throw new HttpError(422, 'This campaign has no email message.')
  const md = msg.attributes?.definition ?? {}
  const content = md.content ?? msg.attributes?.content ?? {}

  let templateId: string | undefined
  try {
    const rel = await kGet(req, `/campaign-messages/${msg.id}/relationships/template`)
    templateId = rel.data?.id
  } catch (e) {
    scopeHint(e)
  }
  if (!templateId) throw new HttpError(422, 'This campaign’s email has no content yet. Clone a campaign that already has a drag-and-drop email.')

  let t: Json
  try {
    t = (await kGet(req, `/templates/${templateId}?additional-fields[template]=definition`)).data
  } catch (e) {
    scopeHint(e)
  }
  const ta = t!.attributes ?? {}
  return {
    campaign: { id: campaign.id, name: a.name ?? '', status: a.status ?? 'Unknown', editable: a.status === 'Draft' },
    message: { id: msg.id, subject: content.subject ?? '', previewText: content.preview_text ?? '', label: md.label ?? msg.attributes?.label ?? '' },
    template: { id: t!.id, name: ta.name ?? '', editorType: ta.editor_type ?? 'UNKNOWN', updated: ta.updated ?? null },
    definition: ta.definition ?? null,
  }
}

function assertEditable(l: Loaded) {
  if (!l.campaign.editable) throw new HttpError(409, `“${l.campaign.name}” is ${l.campaign.status}. Only Draft campaigns can be edited.`)
  if (l.template.editorType !== 'SYSTEM_DRAGGABLE' || !l.definition) {
    throw new HttpError(
      422,
      `This campaign’s email uses the ${l.template.editorType === 'CODE' ? 'HTML (code)' : l.template.editorType} editor. Only drag-and-drop emails can be updated block by block — clone a drag-and-drop campaign instead.`,
    )
  }
}

/**
 * Writes a definition to the campaign's email. First tries to update the email's own template;
 * if Klaviyo refuses, creates a temporary drag-and-drop template, assigns it to the message
 * (Klaviyo copies it), and deletes the temporary one.
 */
async function applyDefinition(req: Request, l: Loaded, definition: Json): Promise<{ method: 'update' | 'assign'; templateId: string }> {
  try {
    await kSend(req, 'PATCH', `/templates/${l.template.id}`, { data: { type: 'template', id: l.template.id, attributes: { definition } } })
    return { method: 'update', templateId: l.template.id }
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) scopeHint(e)
    if (!(e instanceof HttpError) || e.status >= 500) throw e
    console.warn(`[campaign] direct template update refused (${e.status}: ${e.message}); falling back to assign`)
  }
  const created = await kSend(req, 'POST', '/templates', {
    data: { type: 'template', attributes: { name: `[Email Slicer] ${l.campaign.name}`.slice(0, 200), editor_type: 'SYSTEM_DRAGGABLE', definition: stripIds(definition) } },
  })
  const tempId = created.data.id as string
  try {
    await kSend(req, 'POST', '/campaign-message-assign-template', {
      data: { type: 'campaign-message', id: l.message.id, relationships: { template: { data: { type: 'template', id: tempId } } } },
    })
  } finally {
    await kSend(req, 'DELETE', `/templates/${tempId}`).catch((err) => console.warn('[campaign] could not delete temporary template', tempId, err.message))
  }
  const rel = await kGet(req, `/campaign-messages/${l.message.id}/relationships/template`)
  return { method: 'assign', templateId: rel.data?.id ?? tempId }
}

export const campaignRouter = Router()

/** Load a campaign from a pasted link and list its image blocks. */
campaignRouter.post('/resolve', async (req, res) => {
  const l = await loadCampaign(req, { url: String(req.body?.url ?? '') })
  res.json({
    campaign: l.campaign,
    message: l.message,
    template: { id: l.template.id, name: l.template.name, editorType: l.template.editorType, updated: l.template.updated },
    summary: l.definition ? summarize(l.definition) : null,
  })
})

function checkFresh(l: Loaded, templateUpdated?: string | null) {
  if (templateUpdated && l.template.updated && templateUpdated !== l.template.updated) {
    throw new HttpError(409, 'The campaign’s email was edited in Klaviyo since you loaded it. Reload the campaign and check the images again.')
  }
}

/**
 * Swap revised images in place (after "Refresh from Figma"): each old image in the campaign is
 * replaced by its revised upload. Position, size and everything else in the email stay put.
 */
campaignRouter.post('/swap', async (req, res) => {
  const { campaignId, swaps, dryRun, templateUpdated } = req.body ?? {}
  if (!campaignId || !Array.isArray(swaps) || !swaps.length) throw new HttpError(400, 'campaignId and swaps are required')
  for (const sw of swaps as ImageSwap[]) {
    if (!sw.oldUrl) throw new HttpError(400, 'Every swap needs the old image URL')
    if (!dryRun && !/^https:\/\//.test(sw.src ?? '')) throw new HttpError(400, 'Upload the revised slices to Klaviyo before updating the campaign.')
  }
  const l = await loadCampaign(req, { campaignId })
  assertEditable(l)
  checkFresh(l, templateUpdated)
  const result = swapImages(l.definition!, swaps)
  const found = result.counts.filter((c) => c > 0).length
  if (dryRun || !found) return void res.json({ dryRun: !!dryRun, counts: result.counts, applied: false })
  const applied = await applyDefinition(req, l, result.definition)
  const after = await loadCampaign(req, { campaignId })
  res.json({
    dryRun: false,
    applied: true,
    counts: result.counts,
    method: applied.method,
    templateId: applied.templateId,
    templateUpdated: after.template.updated,
    after: after.definition ? summarize(after.definition) : null,
  })
})

/**
 * Remove the chosen image blocks right away, without inserting anything (dryRun = preview only).
 * Returns the spot they occupied so the slices can be inserted there later.
 */
campaignRouter.post('/remove', async (req, res) => {
  const { campaignId, removeKeys, dryRun, templateUpdated } = req.body ?? {}
  if (!campaignId || !Array.isArray(removeKeys) || !removeKeys.length) throw new HttpError(400, 'campaignId and at least one image are required')
  const l = await loadCampaign(req, { campaignId })
  assertEditable(l)
  checkFresh(l, templateUpdated)
  let result
  try {
    result = removeBlocks(l.definition!, removeKeys)
  } catch (e) {
    throw new HttpError(409, (e as Error).message)
  }
  if (dryRun) return void res.json({ dryRun: true, removed: result.removed, anchor: result.anchor, warnings: result.warnings })
  const applied = await applyDefinition(req, l, result.definition)
  const after = await loadCampaign(req, { campaignId })
  res.json({
    dryRun: false,
    removed: result.removed,
    anchor: result.anchor,
    warnings: result.warnings,
    method: applied.method,
    templateId: applied.templateId,
    templateUpdated: after.template.updated,
    after: after.definition ? summarize(after.definition) : null,
  })
})

/**
 * Preview (dryRun) or apply: remove the chosen image blocks and insert the slices in their place.
 * With no images chosen, `anchor` (from an earlier /remove) says where the slices go.
 */
campaignRouter.post('/replace', async (req, res) => {
  const { campaignId, removeKeys, rows, dryRun, templateUpdated, anchor } = req.body ?? {}
  if (!campaignId || !Array.isArray(removeKeys) || !Array.isArray(rows)) throw new HttpError(400, 'campaignId, removeKeys and rows are required')
  if (!removeKeys.length && !anchor) throw new HttpError(400, 'Pick the images to replace, or remove them first so the app knows where the slices go.')
  for (const r of rows as SliceRowInput[]) {
    if (!Array.isArray(r.cells) || !r.cells.length) throw new HttpError(400, 'Every row needs at least one cell')
    for (const c of r.cells) if (!dryRun && !/^https:\/\//.test(c.src ?? '')) throw new HttpError(400, 'Every slice must be uploaded to Klaviyo before updating the campaign.')
  }
  const l = await loadCampaign(req, { campaignId })
  assertEditable(l)
  checkFresh(l, templateUpdated)
  let result
  try {
    result = removeKeys.length
      ? replaceImages(l.definition!, removeKeys, rows)
      : { ...insertRows(l.definition!, anchor as SliceAnchor, rows), removed: 0 }
  } catch (e) {
    throw new HttpError(409, (e as Error).message)
  }
  const plan = { removed: result.removed, inserted: result.inserted, rows: result.rows, insertedAt: result.insertedAt, contentWidth: result.contentWidth, warnings: result.warnings }
  if (dryRun) return void res.json({ dryRun: true, ...plan })

  const applied = await applyDefinition(req, l, result.definition)
  // Read back what Klaviyo stored, so the UI reports reality rather than intent.
  const after = await loadCampaign(req, { campaignId })
  res.json({
    dryRun: false,
    ...plan,
    method: applied.method,
    templateId: applied.templateId,
    templateUpdated: after.template.updated,
    after: after.definition ? summarize(after.definition) : null,
  })
})
