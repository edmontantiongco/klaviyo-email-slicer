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

export interface CampaignImage {
  key: string
  blockId?: string
  section: number
  row: number
  column: number
  block: number
  columnsInRow: number
  src: string
  href: string
  alt: string
  width?: number
  universal: boolean
}

export interface CampaignInfo {
  campaign: { id: string; name: string; status: string; editable: boolean }
  message: { id: string; subject: string; previewText: string; label: string }
  template: { id: string; name: string; editorType: string; updated: string | null }
  summary: {
    width: number
    sections: number
    blocks: number
    images: CampaignImage[]
    blockTypes: Record<string, number>
  } | null
  /** Klaviyo's reason when it can't export the email's layout. The email can still be rebuilt from the slices. */
  definitionError?: string
  /** Email settings without content (width, colours), when the layout could be read. */
  skeleton?: EmailSkeleton
}

/** An email's settings without its content; used to rebuild emails whose layout Klaviyo can't export. */
export interface EmailSkeleton {
  definition: Record<string, unknown>
}

export interface CampaignSliceRow {
  cells: { src: string; assetId?: string; href: string; alt: string; fraction: number }[]
}

/** Where the slices go after images were removed on their own (saved by earlier versions of the app). */
export interface SliceAnchor {
  section: number
  row: number
  newSection: boolean
  sectionData?: Record<string, unknown>
  label: string
}

export interface CampaignReplaceResult {
  dryRun: boolean
  /** Replace-all: name of the library image set as the slices' section background (White_BG). */
  background?: string
  removed: number
  inserted: number
  rows: { index: number; cells: number; mode: 'image' | 'columns' | 'html'; columnLayout?: string }[]
  insertedAt: { section: number; row: number }
  contentWidth: number
  warnings: string[]
  method?: 'update' | 'assign'
  templateId?: string
  templateUpdated?: string | null
  after?: CampaignInfo['summary']
}

const post = <T>(path: string, body: unknown) =>
  json<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

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

  klaviyoRenameImage: (id: string, name: string) =>
    json<{ id: string; name: string }>(`/api/klaviyo/images/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  klaviyoCreateTemplate: (name: string, html: string, editorType: 'CODE' | 'USER_DRAGGABLE') =>
    json<{ id: string; name: string }>('/api/klaviyo/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, html, editorType }),
    }),

  klaviyoResolveCampaign: (url: string) => post<CampaignInfo>('/api/klaviyo/campaign/resolve', { url }),

  klaviyoReplaceCampaignImages: (body: {
    campaignId: string
    removeKeys: string[]
    rows: CampaignSliceRow[]
    dryRun: boolean
    templateUpdated?: string | null
    /** Replace the email's whole content with the slices. */
    all?: boolean
    /** With `all`, used when Klaviyo can't export the email's current layout. */
    skeleton?: EmailSkeleton
    /** Used when no images are selected: insert where earlier-removed images were. */
    anchor?: SliceAnchor
  }) => post<CampaignReplaceResult>('/api/klaviyo/campaign/replace', body),

  klaviyoSwapCampaignImages: (body: {
    campaignId: string
    swaps: { oldUrl: string; oldAssetId?: string; src: string; assetId?: string; href?: string; alt?: string }[]
    dryRun: boolean
    templateUpdated?: string | null
  }) =>
    post<{ dryRun: boolean; applied: boolean; counts: number[]; templateId?: string; templateUpdated?: string | null; after?: CampaignInfo['summary'] }>(
      '/api/klaviyo/campaign/swap',
      body,
    ),
}
