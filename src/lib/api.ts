import { useSettings } from '@/store/settings'
import type { FigmaNode } from './slicing'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function authHeaders(): Record<string, string> {
  const { figmaToken, klaviyoKey } = useSettings.getState()
  const h: Record<string, string> = {}
  if (figmaToken.trim()) h['x-figma-token'] = figmaToken.trim()
  if (klaviyoKey.trim()) h['x-klaviyo-key'] = klaviyoKey.trim()
  return h
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string>) } })
  } catch {
    throw new ApiError(0, 'Cannot reach the local API server. Is `npm run dev` running?')
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* not json */
    }
    if (res.status === 502 || res.status === 504) msg ||= 'Local API server is not running'
    throw new ApiError(res.status, msg)
  }
  return res
}

const json = async <T>(path: string, init?: RequestInit) => (await request(path, init)).json() as Promise<T>

export interface HealthResponse {
  ok: boolean
  figmaTokenConfigured: boolean
  klaviyoKeyConfigured: boolean
  klaviyoRevision: string
}

export interface FigmaPagesResponse {
  name: string
  lastModified: string
  pages: { id: string; name: string; children: { id: string; name: string; type: string; width: number; height: number }[] }[]
}

export const api = {
  health: () => json<HealthResponse>('/api/health'),

  figmaPages: (fileKey: string) => json<FigmaPagesResponse>(`/api/figma/files/${fileKey}/pages`),

  figmaNode: (fileKey: string, nodeId: string, depth?: number) =>
    json<{ name: string; lastModified: string; document: FigmaNode }>(
      `/api/figma/files/${fileKey}/nodes/${encodeURIComponent(nodeId)}${depth ? `?depth=${depth}` : ''}`,
    ),

  figmaThumbnails: (fileKey: string, ids: string[], scale = 0.15) =>
    json<{ images: Record<string, string | null> }>(
      `/api/figma/files/${fileKey}/images?ids=${encodeURIComponent(ids.join(','))}&scale=${scale}`,
    ),

  figmaRender: async (fileKey: string, nodeId: string, scale: number, fresh = false) =>
    (await request(`/api/figma/files/${fileKey}/render/${encodeURIComponent(nodeId)}?scale=${scale}${fresh ? '&fresh=1' : ''}`)).blob(),

  klaviyoTest: () => json<{ ok: boolean; revision: string }>('/api/klaviyo/test'),

  klaviyoUpload: (file: Blob, fileName: string, name: string, hidden: boolean) => {
    const form = new FormData()
    form.append('file', file, fileName)
    form.append('name', name)
    form.append('hidden', String(hidden))
    return json<{ id: string; url: string; name: string; size: number; format: string }>('/api/klaviyo/images', {
      method: 'POST',
      body: form,
    })
  },

  klaviyoCreateTemplate: (name: string, html: string, editorType: 'CODE' | 'USER_DRAGGABLE') =>
    json<{ id: string; name: string }>('/api/klaviyo/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, html, editorType }),
    }),
}
