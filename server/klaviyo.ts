import { Router, type Request } from 'express'
import multer from 'multer'
import { HttpError, fetchWithRetry } from './http.ts'
import { createLimiter } from './limiter.ts'

export const KLAVIYO_API = process.env.KLAVIYO_API_BASE || 'https://a.klaviyo.com/api'
export const KLAVIYO_REVISION = process.env.KLAVIYO_REVISION || '2026-07-15'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // Klaviyo hard limit

// Klaviyo image upload limits: burst 3/s, steady 100/m (daily 500/d).
const uploadLimiter = createLimiter({ perSecond: 3, perMinute: 100 })

export function apiKey(req: Request): string {
  const k = (req.header('x-klaviyo-key') || process.env.KLAVIYO_PRIVATE_KEY || '').trim()
  if (!k) throw new HttpError(401, 'No Klaviyo private API key configured. Add KLAVIYO_PRIVATE_KEY to .env or set it in Settings.')
  return k
}

export function headers(req: Request, extra: Record<string, string> = {}) {
  return {
    Authorization: `Klaviyo-API-Key ${apiKey(req)}`,
    revision: KLAVIYO_REVISION,
    accept: 'application/vnd.api+json',
    ...extra,
  }
}

export async function readKlaviyo(res: Response) {
  const body = (await res.json().catch(() => ({}))) as any
  if (!res.ok) {
    const first = body?.errors?.[0]
    const msg = first ? `${first.title ?? 'Error'}: ${first.detail ?? ''}`.trim() : `Klaviyo API error (${res.status})`
    throw new HttpError(res.status, msg, body?.errors)
  }
  return body
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } })

export const klaviyoRouter = Router()

/** Validates the key by listing a single image (needs images:read). Campaign updates also need campaigns:read/write + templates:read/write. */
klaviyoRouter.get('/test', async (req, res) => {
  const r = await fetchWithRetry(`${KLAVIYO_API}/images?page[size]=1`, { headers: headers(req) })
  await readKlaviyo(r)
  res.json({ ok: true, revision: KLAVIYO_REVISION })
})

klaviyoRouter.post('/images', upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) throw new HttpError(400, 'file is required')
  if (!/^image\/(jpeg|png|gif)$/.test(file.mimetype)) throw new HttpError(400, `Unsupported type ${file.mimetype}`)
  const name = String(req.body?.name || file.originalname)
  const hidden = String(req.body?.hidden) === 'true'

  const result = await uploadLimiter(async () => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname)
    form.append('name', name)
    form.append('hidden', String(hidden))
    const r = await fetchWithRetry(`${KLAVIYO_API}/image-upload`, { method: 'POST', headers: headers(req), body: form })
    return readKlaviyo(r)
  })

  const a = result.data?.attributes ?? {}
  res.status(201).json({ id: result.data?.id, url: a.image_url, name: a.name, size: a.size, format: a.format })
})

klaviyoRouter.post('/templates', async (req, res) => {
  const { name, html, text, editorType } = req.body ?? {}
  if (!name || !html) throw new HttpError(400, 'name and html are required')
  const editor_type = editorType === 'USER_DRAGGABLE' ? 'USER_DRAGGABLE' : 'CODE'
  const r = await fetchWithRetry(`${KLAVIYO_API}/templates`, {
    method: 'POST',
    headers: headers(req, { 'content-type': 'application/vnd.api+json' }),
    body: JSON.stringify({ data: { type: 'template', attributes: { name, editor_type, html, ...(text ? { text } : {}) } } }),
  })
  const body = await readKlaviyo(r)
  res.status(201).json({ id: body.data?.id, name: body.data?.attributes?.name })
})
