import { Router, type Request } from 'express'
import { HttpError, fetchWithRetry } from './http.ts'
import { KLAVIYO_API, headers, readKlaviyo } from './klaviyo.ts'
import { DEFAULT_SKELETON, type SectionBackground, idsFromKlaviyoUrl, insertRows, removeBlocks, replaceAll, replaceImages, skeletonOf, stripIds, summarize, swapImages, type ImageSwap, type SliceAnchor, type SliceRowInput } from './dnd.ts'
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
  /** Klaviyo's reason when it can't export the email's layout (the email can still be rebuilt). */
  definitionError?: string
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
  let definitionError: string | undefined
  try {
    t = (await kGet(req, `/templates/${templateId}?additional-fields[template]=definition`)).data
  } catch (e) {
    if (!(e instanceof HttpError && /failed to load definition/i.test(e.message))) scopeHint(e)
    // Klaviyo can't export this layout (e.g. a header block it won't accept). The email can still be
    // rebuilt from the slices, so load the template without its layout.
    definitionError = klaviyoSaid((e as HttpError).message)
    try {
      t = (await kGet(req, `/templates/${templateId}`)).data
    } catch (e2) {
      scopeHint(e2)
    }
  }
  const ta = t!.attributes ?? {}
  return {
    campaign: { id: campaign.id, name: a.name ?? '', status: a.status ?? 'Unknown', editable: a.status === 'Draft' },
    message: { id: msg.id, subject: content.subject ?? '', previewText: content.preview_text ?? '', label: md.label ?? msg.attributes?.label ?? '' },
    template: { id: t!.id, name: ta.name ?? '', editorType: ta.editor_type ?? 'UNKNOWN', updated: ta.updated ?? null },
    definition: ta.definition ?? null,
    definitionError,
  }
}

/** Klaviyo's own words from a "Failed to load definition" error. */
export function klaviyoSaid(raw: string): string {
  return raw.replace(/^[^:]*:\s*/, '').replace(/^Failed to load definition for template \w+:\s*/i, '').replace(/\s*@\s*\$\s*$/, '').trim()
}

/**
 * Klaviyo sometimes can't export an email's drag-and-drop layout because one block has a setting
 * its API doesn't accept (the editor tolerates it). Explain how to fix it in Klaviyo.
 */
export function definitionHelp(raw: string): string {
  const said = klaviyoSaid(raw)
  const tail = ' Save, then click Load campaign again. Tip: make the same fix in the campaign or template you clone from (or the universal header block), so future clones load too.'
  if (/header block/i.test(said) && /logo/i.test(said)) {
    return (
      `Klaviyo can't export this email's drag-and-drop layout, so the app can't edit it. Klaviyo says: “${said}”. ` +
      'Fix it in Klaviyo: open the email, click the Header block (the logo + links bar) and either set its Desktop layout to one that shows the logo ' +
      '(Centered, Inline or Stacked), or remove the logo from it if the header should be links only.' +
      tail
    )
  }
  return (
    `Klaviyo can't export this email's drag-and-drop layout, so the app can't edit it. Klaviyo says: “${said}”. ` +
    'Usually one block has a setting Klaviyo’s API doesn’t accept. Open the email in Klaviyo, adjust or re-add the block it mentions.' +
    tail
  )
}

/** `needsLayout`: the change edits the current layout, so Klaviyo must be able to export it. */
function assertEditable(l: Loaded, needsLayout = true) {
  if (!l.campaign.editable) throw new HttpError(409, `“${l.campaign.name}” is ${l.campaign.status}. Only Draft campaigns can be edited.`)
  if (l.template.editorType !== 'SYSTEM_DRAGGABLE') {
    throw new HttpError(
      422,
      `This campaign’s email uses the ${l.template.editorType === 'CODE' ? 'HTML (code)' : l.template.editorType} editor. Only drag-and-drop emails can be updated block by block — clone a drag-and-drop campaign instead.`,
    )
  }
  if (needsLayout && !l.definition) throw new HttpError(422, definitionHelp(l.definitionError ?? 'Klaviyo did not return the email’s layout.'))
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

/** Names of the section background image the slices always get, in order of preference. */
export const WHITE_BG = /^white[\s_-]*(bg|background)(\.[a-z]+)?$/i
const whiteRank = (name: string) => (/bg/i.test(name) ? 0 : 1)

/**
 * Finds the “White_BG” / “White Background” image in the Klaviyo image library. Uses a name filter
 * when Klaviyo accepts it, otherwise pages through the library.
 */
const backgroundCache = new Map<string, { at: number; value: SectionBackground | undefined }>()

async function findWhiteBackground(req: Request): Promise<SectionBackground | undefined> {
  // Looked up for the review and again for the send; keep it for a few minutes per account.
  const key = headers(req).Authorization ?? ''
  const cached = backgroundCache.get(key)
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value
  const value = await lookupWhiteBackground(req)
  backgroundCache.set(key, { at: Date.now(), value })
  return value
}

async function lookupWhiteBackground(req: Request): Promise<SectionBackground | undefined> {
  const pick = (items: Json[]) =>
    items
      .map((i) => ({ url: i.attributes?.image_url as string, assetId: String(i.id), name: String(i.attributes?.name ?? '') }))
      .filter((i) => i.url && WHITE_BG.test(i.name.trim()))
      .sort((a, b) => whiteRank(a.name) - whiteRank(b.name))[0]
  try {
    // "hite" matches both "White" and "white".
    const body = await kGet(req, `/images?filter=${encodeURIComponent('contains(name,"hite")')}&page[size]=100`)
    const hit = pick(body.data ?? [])
    if (hit) return hit
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) scopeHint(e)
  }
  let next: string | undefined = `${KLAVIYO_API}/images?page[size]=100`
  for (let page = 0; next && page < 20; page++) {
    const r = await fetchWithRetry(next, { headers: headers(req) })
    const body = await readKlaviyo(r).catch((e) => scopeHint(e))
    const hit = pick(body.data ?? [])
    if (hit) return hit
    next = body.links?.next ?? undefined
  }
  return undefined
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
    definitionError: l.definitionError,
    // Saved by the app so emails Klaviyo can't export can still be rebuilt with the same settings/background.
    skeleton: l.definition ? skeletonOf(l.definition) : undefined,
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
 * With `all`, the email's whole content is replaced by the slices.
 */
campaignRouter.post('/replace', async (req, res) => {
  const { campaignId, rows, dryRun, templateUpdated, anchor, all, skeleton } = req.body ?? {}
  const removeKeys = req.body?.removeKeys ?? []
  if (!campaignId || !Array.isArray(removeKeys) || !Array.isArray(rows)) throw new HttpError(400, 'campaignId, removeKeys and rows are required')
  if (!all && !removeKeys.length && !anchor) throw new HttpError(400, 'Pick the images to replace, or remove them first so the app knows where the slices go.')
  for (const r of rows as SliceRowInput[]) {
    if (!Array.isArray(r.cells) || !r.cells.length) throw new HttpError(400, 'Every row needs at least one cell')
    for (const c of r.cells) if (!dryRun && !/^https:\/\//.test(c.src ?? '')) throw new HttpError(400, 'Every slice must be uploaded to Klaviyo before updating the campaign.')
  }
  const l = await loadCampaign(req, { campaignId })
  assertEditable(l, !all)
  const background = all ? await findWhiteBackground(req) : undefined
  checkFresh(l, templateUpdated)
  let result
  try {
    result = all
      ? replaceAll(l.definition ?? (skeleton?.definition?.body ? skeleton : DEFAULT_SKELETON), rows, background)
      : removeKeys.length
      ? replaceImages(l.definition!, removeKeys, rows)
      : { ...insertRows(l.definition!, anchor as SliceAnchor, rows), removed: 0 }
  } catch (e) {
    throw new HttpError(409, (e as Error).message)
  }
  if (all && !background) {
    result.warnings.unshift(`No image named “White_BG” or “White Background” was found in your Klaviyo image library, so the section background image couldn’t be set. Upload it to Klaviyo with one of those names and send again.`)
  }
  if (all && !l.definition) {
    result.warnings.unshift('Klaviyo can’t export this email’s layout, so its header and footer can’t be kept — the whole email is rebuilt. Add them back in Klaviyo after sending.')
  }
  const plan = { background: background?.name, kept: result.kept ?? 0, removed: result.removed, inserted: result.inserted, rows: result.rows, insertedAt: result.insertedAt, contentWidth: result.contentWidth, warnings: result.warnings }
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
