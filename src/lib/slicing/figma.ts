import { clipRect } from './geometry'
import type { Blocker, BlockerKind, LayoutAnalysis, Rect, Section } from './types'

/** Minimal shape of the Figma REST node JSON we rely on. */
export interface FigmaNode {
  id: string
  name: string
  type: string
  visible?: boolean
  opacity?: number
  isMask?: boolean
  clipsContent?: boolean
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null
  absoluteRenderBounds?: { x: number; y: number; width: number; height: number } | null
  fills?: Array<{ type: string; visible?: boolean; opacity?: number }>
  strokes?: Array<{ type: string; visible?: boolean }>
  effects?: Array<{ type: string; visible?: boolean }>
  characters?: string
  style?: { hyperlink?: { type?: string; url?: string } }
  styleOverrideTable?: Record<string, { hyperlink?: { type?: string; url?: string } }>
  children?: FigmaNode[]
}

/** All visible copy and the first URL hyperlink inside a subtree. */
function collectText(n: FigmaNode): { text: string; link?: string } {
  const parts: string[] = []
  let link: string | undefined
  const walk = (x: FigmaNode) => {
    if (x.visible === false) return
    if (x.type === 'TEXT') {
      if (x.characters?.trim()) parts.push(x.characters.trim().replace(/\s+/g, ' '))
      const urls = [x.style?.hyperlink, ...Object.values(x.styleOverrideTable ?? {}).map((o) => o.hyperlink)]
      link ??= urls.find((h) => h?.type === 'URL' && h.url)?.url
    }
    x.children?.forEach(walk)
  }
  walk(n)
  return { text: parts.join(' '), link }
}

const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'POLYGON', 'REGULAR_POLYGON'])
const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'SECTION', 'COMPONENT_SET', 'INSTANCE', 'COMPONENT'])

const visiblePaints = (p?: FigmaNode['fills']) => (p ?? []).filter((f) => f.visible !== false && (f.opacity ?? 1) > 0)
const hasImageFill = (n: FigmaNode) => visiblePaints(n.fills).some((f) => f.type === 'IMAGE' || f.type === 'VIDEO')
const hasPaint = (n: FigmaNode) =>
  visiblePaints(n.fills).length > 0 ||
  visiblePaints(n.strokes).length > 0 ||
  (n.effects ?? []).some((e) => e.visible !== false && e.type.includes('SHADOW'))

function bounds(n: FigmaNode): Rect | null {
  const a = n.absoluteBoundingBox
  const r = n.absoluteRenderBounds
  if (!a && !r) return null
  if (!a) return { ...r! }
  if (!r) return { ...a }
  const x0 = Math.min(a.x, r.x)
  const y0 = Math.min(a.y, r.y)
  return { x: x0, y: y0, width: Math.max(a.x + a.width, r.x + r.width) - x0, height: Math.max(a.y + a.height, r.y + r.height) - y0 }
}

/**
 * Turn an email frame's Figma subtree into slicing input: blockers (things not to cut through)
 * and sections (full-width top-level bands, used for preferred cuts and slice names).
 * `scale` is the export scale used when rendering the frame.
 */
export function analyzeFigmaFrame(frame: FigmaNode, scale: number): LayoutAnalysis {
  const fb = frame.absoluteBoundingBox
  if (!fb) throw new Error('Frame has no bounding box')
  const frameRect: Rect = { x: fb.x, y: fb.y, width: fb.width, height: fb.height }
  const fullWidth = fb.width * 0.9
  const blockers: Blocker[] = []

  const toLocal = (r: Rect): Rect => ({
    x: Math.floor((r.x - fb.x) * scale),
    y: Math.floor((r.y - fb.y) * scale),
    width: Math.ceil(r.width * scale),
    height: Math.ceil(r.height * scale),
  })

  const push = (n: FigmaNode, r: Rect, kind: BlockerKind) => {
    const local = toLocal(r)
    // Ignore hairlines (dividers) – cutting next to them is harmless.
    if (local.height <= 2 * scale && local.width >= fullWidth * scale) return
    const { text, link } = kind === 'text' || kind === 'component' || kind === 'shape' ? collectText(n) : { text: '', link: undefined }
    blockers.push({ ...local, kind, name: n.name, id: n.id, ...(text ? { text } : {}), ...(link ? { link } : {}) })
  }

  const visit = (n: FigmaNode, clip: Rect) => {
    if (n.visible === false || n.opacity === 0) return
    const raw = bounds(n)
    if (!raw) return
    const r = clipRect(raw, clip)
    if (!r) return
    const isFullWidth = r.width >= fullWidth

    if (n.type === 'TEXT') return push(n, r, 'text')
    if (VECTOR_TYPES.has(n.type)) return push(n, r, 'vector')
    if (n.type === 'RECTANGLE') {
      if (hasImageFill(n)) return push(n, r, 'image')
      if (!isFullWidth && hasPaint(n)) return push(n, r, 'shape')
      return // full-width solid rectangles are backgrounds
    }
    if (CONTAINER_TYPES.has(n.type)) {
      const childClip = n.clipsContent ? (clipRect(r, clip) ?? r) : clip
      if (!isFullWidth) {
        // Buttons, cards, logos, product tiles: keep them whole.
        if (n.type === 'INSTANCE' || n.type === 'COMPONENT') return push(n, r, 'component')
        if (hasImageFill(n)) return push(n, r, 'image')
        if (hasPaint(n)) return push(n, r, 'shape')
      } else if (hasImageFill(n)) {
        push(n, r, 'image')
      }
      for (const c of n.children ?? []) visit(c, childClip)
      return
    }
    // Unknown node types: treat as generic shape if they paint something.
    if (hasPaint(n)) push(n, r, 'shape')
  }

  for (const c of frame.children ?? []) visit(c, frameRect)

  // Sections: descend through single full-width wrappers, then take full-width children.
  let level: FigmaNode[] = (frame.children ?? []).filter((c) => c.visible !== false)
  while (level.length === 1 && level[0].children?.length && (level[0].absoluteBoundingBox?.width ?? 0) >= fullWidth) {
    level = level[0].children!.filter((c) => c.visible !== false)
  }
  const sections: Section[] = []
  for (const c of level) {
    const b = c.absoluteBoundingBox
    if (!b || b.width < fullWidth) continue
    const top = Math.max(0, Math.round((b.y - fb.y) * scale))
    const bottom = Math.min(Math.round(fb.height * scale), Math.round((b.y + b.height - fb.y) * scale))
    if (bottom > top) sections.push({ top, bottom, name: c.name })
  }
  sections.sort((a, b) => a.top - b.top)
  const height = Math.round(fb.height * scale)
  const edges = [...new Set(sections.flatMap((s) => [s.top, s.bottom]))].filter((e) => e > 0 && e < height)

  return { source: 'figma', width: Math.round(fb.width * scale), height, blockers, sections, edges }
}

export interface EmailFrameInfo {
  id: string
  name: string
  width: number
  height: number
  x: number
  y: number
}

const EMAIL_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE'])
const GROUPING_TYPES = new Set(['SECTION', 'CANVAS', 'GROUP', 'DOCUMENT'])

/**
 * Find the email frames inside whatever node the user linked:
 * a page, a section (optionally nested), or a single email frame.
 */
export function discoverEmailFrames(node: FigmaNode): EmailFrameInfo[] {
  const out: EmailFrameInfo[] = []
  const isEmailSized = (n: FigmaNode) => {
    const b = n.absoluteBoundingBox
    return !!b && b.width >= 320 && b.height >= 200
  }
  const add = (n: FigmaNode) => {
    const b = n.absoluteBoundingBox!
    out.push({ id: n.id, name: n.name, width: b.width, height: b.height, x: b.x, y: b.y })
  }
  const walk = (n: FigmaNode, depth: number) => {
    if (n.visible === false) return
    for (const c of n.children ?? []) {
      if (c.visible === false) continue
      if (EMAIL_TYPES.has(c.type) && isEmailSized(c)) add(c)
      else if (GROUPING_TYPES.has(c.type) && depth < 4) walk(c, depth + 1)
    }
  }

  if (EMAIL_TYPES.has(node.type)) {
    // A frame that contains several side-by-side email-sized frames is a container (e.g. "October").
    const kids = (node.children ?? []).filter((c) => EMAIL_TYPES.has(c.type) && isEmailSized(c))
    const xs = new Set(kids.map((k) => Math.round(k.absoluteBoundingBox!.x)))
    if (kids.length >= 2 && xs.size >= 2) kids.forEach(add)
    else if (isEmailSized(node)) add(node)
  } else {
    walk(node, 0)
  }

  // Reading order: left→right columns of designs, top→bottom inside a column.
  return out.sort((a, b) => (Math.abs(a.x - b.x) > 40 ? a.x - b.x : a.y - b.y))
}

/** Parse a Figma URL into file key and (optional) node id. */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } | null {
  const trimmed = input.trim()
  try {
    const url = new URL(trimmed)
    if (!/figma\.com$/.test(url.hostname)) return null
    const m = url.pathname.match(/\/(?:file|design|proto|board)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/)
    if (!m) return null
    const fileKey = m[2] || m[1]
    const raw = url.searchParams.get('node-id')
    const nodeId = raw ? decodeURIComponent(raw).replace(/-/g, ':') : undefined
    return { fileKey, nodeId }
  } catch {
    // Allow bare file keys.
    if (/^[A-Za-z0-9]{10,}$/.test(trimmed)) return { fileKey: trimmed }
    return null
  }
}
