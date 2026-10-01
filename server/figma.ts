import { Router, type Request } from 'express'
import { HttpError, fetchWithRetry } from './http.ts'

const FIGMA_API = process.env.FIGMA_API_BASE || 'https://api.figma.com/v1'

function token(req: Request): string {
  const t = (req.header('x-figma-token') || process.env.FIGMA_TOKEN || '').trim()
  if (!t) throw new HttpError(401, 'No Figma token configured. Add FIGMA_TOKEN to .env or set it in Settings.')
  return t
}

async function figmaJson<T = any>(req: Request, path: string): Promise<T> {
  const res = await fetchWithRetry(`${FIGMA_API}${path}`, { headers: { 'X-Figma-Token': token(req) } })
  const body = (await res.json().catch(() => ({}))) as any
  if (!res.ok || body?.err || body?.error === true) {
    const msg = body?.err || body?.message || `Figma API error (${res.status})`
    throw new HttpError(res.status === 200 ? 400 : res.status, msg)
  }
  return body as T
}

// Short-lived cache of rendered PNGs so re-slicing doesn't re-render in Figma.
const renderCache = new Map<string, { at: number; buf: Buffer }>()
const RENDER_TTL = 10 * 60 * 1000

export const figmaRouter = Router()

/** Pages and their top-level children (sections / frames) for a file. */
figmaRouter.get('/files/:fileKey/pages', async (req, res) => {
  const data = await figmaJson(req, `/files/${encodeURIComponent(req.params.fileKey)}?depth=2`)
  const pages = (data.document?.children ?? []).map((page: any) => ({
    id: page.id,
    name: page.name,
    children: (page.children ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      width: c.absoluteBoundingBox?.width ?? 0,
      height: c.absoluteBoundingBox?.height ?? 0,
    })),
  }))
  res.json({ name: data.name, lastModified: data.lastModified, version: data.version, pages })
})

/** Full node subtree (used for frame discovery and layer-aware slicing). */
figmaRouter.get('/files/:fileKey/nodes/:nodeId', async (req, res) => {
  const { fileKey, nodeId } = req.params
  const depth = req.query.depth ? `&depth=${Number(req.query.depth)}` : ''
  const data = await figmaJson(req, `/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}${depth}`)
  const node = data.nodes?.[nodeId]
  if (!node) throw new HttpError(404, `Node ${nodeId} not found in file. Check the link's node-id.`)
  res.json({ name: data.name, lastModified: data.lastModified, document: node.document })
})

/** Batch render URLs (used for thumbnails – rendered directly by <img>). */
figmaRouter.get('/files/:fileKey/images', async (req, res) => {
  const ids = String(req.query.ids || '')
  if (!ids) throw new HttpError(400, 'ids is required')
  const scale = Math.min(4, Math.max(0.01, Number(req.query.scale) || 0.2))
  const format = ['png', 'jpg'].includes(String(req.query.format)) ? String(req.query.format) : 'png'
  const data = await figmaJson(
    req,
    `/images/${encodeURIComponent(req.params.fileKey)}?ids=${encodeURIComponent(ids)}&scale=${scale}&format=${format}&use_absolute_bounds=true`,
  )
  res.json({ images: data.images ?? {} })
})

/** Render a single node to PNG and stream the bytes back (same-origin → canvas-safe). */
figmaRouter.get('/files/:fileKey/render/:nodeId', async (req, res) => {
  const { fileKey, nodeId } = req.params
  const scale = Math.min(4, Math.max(0.1, Number(req.query.scale) || 1))
  const cacheKey = `${fileKey}:${nodeId}:${scale}`
  const cached = renderCache.get(cacheKey)
  if (cached && Date.now() - cached.at < RENDER_TTL && req.query.fresh !== '1') {
    res.type('png').send(cached.buf)
    return
  }
  const data = await figmaJson(
    req,
    `/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeId)}&scale=${scale}&format=png&use_absolute_bounds=true`,
  )
  const url = data.images?.[nodeId]
  if (!url) throw new HttpError(422, 'Figma could not render this node (is it empty or hidden?).')
  const img = await fetchWithRetry(url)
  if (!img.ok) throw new HttpError(502, `Downloading render failed (${img.status})`)
  const buf = Buffer.from(await img.arrayBuffer())
  renderCache.set(cacheKey, { at: Date.now(), buf })
  res.type('png').send(buf)
})
