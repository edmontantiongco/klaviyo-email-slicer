/**
 * Pure helpers for editing Klaviyo drag-and-drop (SYSTEM_DRAGGABLE) template definitions.
 *
 * A definition is: body → sections[] → rows[] → columns[] → blocks[].
 * We find the static image blocks, remove the ones the user picked, and insert the
 * new slices (as native image blocks) where the old images were — so the campaign
 * stays editable in Klaviyo's drag-and-drop editor.
 */

// Loose shapes: we only touch the fields we need and pass everything else through untouched.
export type Json = Record<string, any>

export interface ImageBlockInfo {
  /** Stable key for this request: s{section}.r{row}.c{column}.b{block} (+ block id when present). */
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
  /** Block width in CSS px when set in the editor. */
  width?: number
  /** Part of a universal (shared) block or section — usually header/footer. */
  universal: boolean
  sectionId?: string
}

export interface DefinitionSummary {
  width: number
  sections: number
  blocks: number
  images: ImageBlockInfo[]
  /** Counts of block types, e.g. { text: 3, image: 9, button: 1 } */
  blockTypes: Record<string, number>
}

export interface SliceCellInput {
  src: string
  /** Klaviyo image id from the upload (asset_id). */
  assetId?: string
  href: string
  alt: string
  /** Fraction of the row width this cell occupies (0–1). */
  fraction: number
}

export interface SliceRowInput {
  cells: SliceCellInput[]
}

export interface ReplacePlanRow {
  index: number
  cells: number
  mode: 'image' | 'columns' | 'html'
  columnLayout?: string
}

export interface ReplaceResult {
  definition: Json
  removed: number
  inserted: number
  rows: ReplacePlanRow[]
  insertedAt: { section: number; row: number }
  contentWidth: number
  warnings: string[]
  /** replaceAll: header/footer sections left in place. */
  kept?: number
}

export const blockKey = (s: number, r: number, c: number, b: number, id?: string) => `s${s}.r${r}.c${c}.b${b}${id ? `:${id}` : ''}`

function sectionsOf(def: Json): Json[] {
  return Array.isArray(def?.body?.sections) ? def.body.sections : []
}

export function templateWidth(def: Json): number {
  const w = Number(def?.body?.styles?.width)
  return Number.isFinite(w) && w > 0 ? w : 600
}

/** Lists every block, and details for static image blocks. */
export function summarize(def: Json): DefinitionSummary {
  const images: ImageBlockInfo[] = []
  const blockTypes: Record<string, number> = {}
  let blocks = 0
  sectionsOf(def).forEach((section, si) => {
    ;(section.rows ?? []).forEach((row: Json, ri: number) => {
      const cols: Json[] = row.columns ?? []
      cols.forEach((col, ci) => {
        ;(col.blocks ?? []).forEach((block: Json, bi: number) => {
          blocks++
          blockTypes[block.type] = (blockTypes[block.type] ?? 0) + 1
          const p = block?.data?.properties ?? {}
          if (block.type === 'image' && p.dynamic !== true) {
            images.push({
              key: blockKey(si, ri, ci, bi, block.id),
              blockId: block.id,
              section: si,
              row: ri,
              column: ci,
              block: bi,
              columnsInRow: cols.length,
              src: p.src ?? p.cropping_properties?.src ?? '',
              href: p.href ?? '',
              alt: p.alt_text ?? '',
              width: block?.data?.styles?.width,
              universal: Boolean(block.universal_id || section.universal_id),
              sectionId: section.id,
            })
          }
        })
      })
    })
  })
  return { width: templateWidth(def), sections: sectionsOf(def).length, blocks, images, blockTypes }
}

/** Klaviyo's fixed column presets, as width fractions. */
export const COLUMN_LAYOUTS: Record<string, number[]> = {
  '1-column-full-width': [1],
  '2-columns-equal-width': [1 / 2, 1 / 2],
  '2-columns-25%-75%': [1 / 4, 3 / 4],
  '2-columns-33%-67%': [1 / 3, 2 / 3],
  '2-columns-67%-33%': [2 / 3, 1 / 3],
  '2-columns-75%-25%': [3 / 4, 1 / 4],
  '3-columns-equal-width': [1 / 3, 1 / 3, 1 / 3],
  '3-columns-25%-25%-50%': [1 / 4, 1 / 4, 1 / 2],
  '3-columns-25%-50%-25%': [1 / 4, 1 / 2, 1 / 4],
  '3-columns-50%-25%-25%': [1 / 2, 1 / 4, 1 / 4],
  '4-columns-equal-width': [1 / 4, 1 / 4, 1 / 4, 1 / 4],
}

/** Closest preset for these fractions, if every column is within `tolerance` (fraction of row width). */
export function matchColumnLayout(fractions: number[], tolerance = 0.005): string | null {
  for (const [name, preset] of Object.entries(COLUMN_LAYOUTS)) {
    if (preset.length !== fractions.length) continue
    if (preset.every((f, i) => Math.abs(f - fractions[i]) <= tolerance)) return name
  }
  return null
}

const ZERO_PADDING = {
  block_padding_top: 0,
  block_padding_bottom: 0,
  block_padding_left: 0,
  block_padding_right: 0,
}

function imageBlock(cell: SliceCellInput, widthPx: number): Json {
  return {
    content_type: 'block',
    type: 'image',
    data: {
      properties: {
        dynamic: false,
        src: cell.src,
        ...(cell.assetId ? { asset_id: cell.assetId } : {}),
        alt_text: cell.alt,
        href: cell.href,
      },
      display_options: {},
      styles: { align: 'center', ...ZERO_PADDING, width: Math.round(widthPx), full_width_mobile: true },
    },
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Exact-width fallback for column splits that don't match a Klaviyo preset (still a drag-and-drop HTML block). */
function htmlRowBlock(row: SliceRowInput, widthPx: number): Json {
  let used = 0
  const widths = row.cells.map((c, i) => {
    const w = i === row.cells.length - 1 ? Math.round(widthPx) - used : Math.round(c.fraction * widthPx)
    used += w
    return w
  })
  const tds = row.cells
    .map((c, i) => {
      const img = `<img src="${esc(c.src)}" width="${widths[i]}" alt="${esc(c.alt)}" style="display:block;width:100%;max-width:${widths[i]}px;height:auto;border:0;" />`
      const inner = c.href ? `<a href="${esc(c.href)}" target="_blank" style="display:block;">${img}</a>` : img
      return `<td width="${widths[i]}" valign="top" style="padding:0;font-size:0;line-height:0;">${inner}</td>`
    })
    .join('')
  return {
    content_type: 'block',
    type: 'html',
    data: {
      content: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${tds}</tr></table>`,
      display_options: {},
    },
  }
}

export function buildRows(rows: SliceRowInput[], contentWidth: number): { rows: Json[]; plan: ReplacePlanRow[] } {
  const out: Json[] = []
  const plan: ReplacePlanRow[] = []
  rows.forEach((row, index) => {
    if (row.cells.length === 1) {
      out.push({ data: { styles: { column_layout: '1-column-full-width' } }, columns: [{ data: {}, blocks: [imageBlock(row.cells[0], contentWidth)] }] })
      plan.push({ index, cells: 1, mode: 'image', columnLayout: '1-column-full-width' })
      return
    }
    const layout = matchColumnLayout(row.cells.map((c) => c.fraction))
    if (layout) {
      // Size each image to its preset column so all columns line up (the match is within ~0.5%).
      const preset = COLUMN_LAYOUTS[layout]
      out.push({
        data: { styles: { column_layout: layout } },
        columns: row.cells.map((c, i) => ({ data: {}, blocks: [imageBlock(c, Math.floor(preset[i] * contentWidth))] })),
      })
      plan.push({ index, cells: row.cells.length, mode: 'columns', columnLayout: layout })
    } else {
      out.push({ data: { styles: { column_layout: '1-column-full-width' } }, columns: [{ data: {}, blocks: [htmlRowBlock(row, contentWidth)] }] })
      plan.push({ index, cells: row.cells.length, mode: 'html' })
    }
  })
  return { rows: out, plan }
}

/**
 * Where slices go once the old images are gone. Saved after a "remove only" so a later update
 * can put the slices back in the same spot.
 */
export interface SliceAnchor {
  section: number
  row: number
  /** The removal emptied the whole section, so the slices need a new section at `section`. */
  newSection: boolean
  /** Section settings (styles) to reuse when recreating it. */
  sectionData?: Json
  /** Human label, e.g. "Section 1 · Row 1". */
  label: string
}

export interface RemoveResult {
  definition: Json
  removed: number
  anchor: SliceAnchor
  warnings: string[]
}

const SENTINEL = '__slicer_anchor__'

/**
 * Removes the selected image blocks and prunes rows/sections they leave empty.
 * Returns the spot where the first removed image was (the anchor for the slices).
 * `keepAnchorSection` keeps that section even if it ends up empty (used when slices go in immediately).
 */
export function removeBlocks(original: Json, removeKeys: string[], opts: { keepAnchorSection?: boolean } = {}): RemoveResult {
  if (!removeKeys.length) throw new Error('Pick at least one image.')
  const def: Json = structuredClone(original)
  const byKey = new Map(summarize(def).images.map((i) => [i.key, i]))
  if (removeKeys.some((k) => !byKey.has(k))) throw new Error('The campaign changed since it was loaded. Reload the campaign and pick the images again.')

  const targets = removeKeys.map((k) => byKey.get(k)!).sort((a, b) => a.section - b.section || a.row - b.row || a.column - b.column || a.block - b.block)
  const sections = sectionsOf(def)
  const removeSet = new Set<Json>(targets.map((t) => sections[t.section].rows[t.row].columns[t.column].blocks[t.block]))

  // Anchor on the row holding the first selected image. If other content sits above the image
  // in the same column, the slices go after that row instead of before it.
  const first = targets[0]
  const anchorSection = sections[first.section]
  const anchorRow = anchorSection.rows[first.row]
  const contentAbove = (anchorRow.columns[first.column].blocks as Json[]).slice(0, first.block).some((b) => !removeSet.has(b))
  const sentinel: Json = { [SENTINEL]: true }
  anchorSection.rows.splice(first.row + (contentAbove ? 1 : 0), 0, sentinel)

  for (const section of sections) {
    for (const row of section.rows ?? []) {
      if (row === sentinel) continue
      for (const col of row.columns ?? []) col.blocks = (col.blocks ?? []).filter((b: Json) => !removeSet.has(b))
    }
    section.rows = (section.rows ?? []).filter((row: Json) => row === sentinel || (row.columns ?? []).some((c: Json) => c.blocks.length))
  }
  const hasContent = (s: Json) => (s.rows ?? []).some((r: Json) => r !== sentinel)
  const kept = sections.filter((s) => hasContent(s) || (s === anchorSection && opts.keepAnchorSection))

  let anchor: SliceAnchor
  if (kept.includes(anchorSection)) {
    const row = anchorSection.rows.indexOf(sentinel)
    anchor = { section: kept.indexOf(anchorSection), row, newSection: false, label: `Section ${kept.indexOf(anchorSection) + 1} · Row ${row + 1}` }
  } else {
    // Section emptied: remember its position and settings so it can be recreated.
    const section = sections.slice(0, sections.indexOf(anchorSection)).filter((s) => kept.includes(s)).length
    anchor = { section, row: 0, newSection: true, sectionData: structuredClone(anchorSection.data ?? {}), label: `New section ${section + 1} (the removed images’ section)` }
  }
  anchorSection.rows = anchorSection.rows.filter((r: Json) => r !== sentinel)
  def.body.sections = kept

  const warnings: string[] = []
  if (targets.some((t) => t.universal)) warnings.push('Some selected images are in universal (shared) content. Removing them only affects this campaign.')
  return { definition: def, removed: targets.length, anchor, warnings }
}

/** Inserts slice rows at an anchor (from removeBlocks, now or earlier). */
export function insertRows(original: Json, anchor: SliceAnchor, sliceRows: SliceRowInput[]): Omit<ReplaceResult, 'removed'> {
  if (!sliceRows.length) throw new Error('There are no slices to insert.')
  const def: Json = structuredClone(original)
  const sections = sectionsOf(def)
  const stale = new Error('The campaign layout changed since the images were removed. Reload the campaign and pick where the slices go.')
  let section: Json
  if (anchor.newSection) {
    if (anchor.section > sections.length) throw stale
    section = { content_type: 'section', type: 'section', data: structuredClone(anchor.sectionData ?? { properties: {}, display_options: {}, styles: {} }), rows: [] }
    sections.splice(anchor.section, 0, section)
    def.body.sections = sections
  } else {
    section = sections[anchor.section]
    if (!section || anchor.row > (section.rows ?? []).length) throw stale
  }

  const warnings: string[] = []
  const st = section?.data?.styles ?? {}
  const padL = Number(st.inner_padding_left) || 0
  const padR = Number(st.inner_padding_right) || 0
  const contentWidth = templateWidth(def) - padL - padR
  if (padL || padR) warnings.push(`The target section has ${padL + padR}px of side padding, so slices will display ${contentWidth}px wide instead of ${templateWidth(def)}px.`)

  const { rows: newRows, plan } = buildRows(sliceRows, contentWidth)
  const html = plan.filter((p) => p.mode === 'html').length
  if (html) warnings.push(`${html} multi-column row${html > 1 ? 's don’t' : ' doesn’t'} match a Klaviyo column preset, so ${html > 1 ? 'they were' : 'it was'} added as an HTML block with exact widths (still drag-and-drop).`)
  section.rows = section.rows ?? []
  section.rows.splice(anchor.newSection ? 0 : anchor.row, 0, ...newRows)

  return {
    definition: def,
    inserted: newRows.length,
    rows: plan,
    insertedAt: { section: sections.indexOf(section), row: section.rows.indexOf(newRows[0]) },
    contentWidth,
    warnings,
  }
}

const hasBackground = (section: Json) => Boolean(section?.data?.styles?.background_url || section?.data?.styles?.background_color)

/**
 * Settings for the section that holds the slices: copied from the email's existing section that
 * has a background (e.g. the White_BG background image), preferring non-universal ones, so the
 * background is kept. Inner padding is zeroed so the slices display at full width.
 */
function sliceSectionData(sections: Json[]): Json | undefined {
  const source =
    sections.find((s) => !s.universal_id && hasBackground(s)) ?? sections.find(hasBackground) ?? sections.find((s) => !s.universal_id) ?? sections[0]
  if (!source?.data) return undefined
  const data = structuredClone(source.data)
  for (const k of Object.keys(data.styles ?? {})) if (/^inner_padding_/.test(k)) data.styles[k] = 0
  return data
}

/**
 * What an email looks like without its content: email-level settings plus the settings for the
 * slices' section (with its background). Lets the app rebuild an email whose current layout
 * Klaviyo can't export.
 */
export interface EmailSkeleton {
  definition: Json
  sectionData?: Json
}

export function skeletonOf(def: Json): EmailSkeleton {
  const sectionData = sliceSectionData(sectionsOf(def))
  const definition = stripIds(structuredClone(def))
  definition.body = { ...(definition.body ?? {}), sections: [] }
  return { definition, sectionData }
}

/** Used when neither the email nor a saved skeleton is available: a 600px email on white. */
export const DEFAULT_SKELETON: EmailSkeleton = {
  definition: { body: { properties: {}, styles: { width: 600, background_color: '#ffffff' }, sections: [] }, styles: [] },
  sectionData: { properties: {}, display_options: {}, styles: { background_color: '#ffffff' } },
}

/**
 * Replaces everything in the email (every section, including header and footer) with the slices,
 * in one section that keeps the email's section background. Email-level styles stay too.
 * Pass a skeleton instead of the email when Klaviyo can't export the email's current layout.
 */
const blocksOf = (section: Json): Json[] => (section.rows ?? []).flatMap((r: Json) => (r.columns ?? []).flatMap((c: Json) => c.blocks ?? []))

/**
 * Header and footer sections added in Klaviyo, which replaceAll leaves in place: universal
 * sections, sections with a universal block or a header block, and sections with the unsubscribe link.
 */
export function isHeaderOrFooter(section: Json): boolean {
  if (section.universal_id) return true
  const blocks = blocksOf(section)
  return blocks.some((b) => b.universal_id || b.type === 'header') || /unsubscribe/i.test(JSON.stringify(blocks))
}

/**
 * Replaces the email's content with the slices, in one section that keeps the email's section
 * background. Header and footer sections (see isHeaderOrFooter) stay, so sending again after
 * changing slices doesn't undo them; the slices go between them. Email-level styles stay too.
 * Pass a skeleton instead of the email when Klaviyo can't export the email's current layout
 * (then nothing can be kept and the whole email is rebuilt).
 */
/** An image from the Klaviyo library to use as the slices' section background. */
export interface SectionBackground {
  url: string
  assetId: string
  name: string
}

export function replaceAll(original: Json | EmailSkeleton, sliceRows: SliceRowInput[], background?: SectionBackground): ReplaceResult {
  if (!sliceRows.length) throw new Error('There are no slices to insert.')
  const fromSkeleton = 'definition' in original && !('body' in original)
  const def: Json = structuredClone(fromSkeleton ? (original as EmailSkeleton).definition : original)
  const sections = sectionsOf(def)
  const removedSections = sections.filter((s) => !isHeaderOrFooter(s))
  const kept = sections.filter(isHeaderOrFooter)
  const removed = removedSections.reduce((n, s) => n + blocksOf(s).length, 0)
  // Background from the content being replaced (e.g. the previous slices' White_BG section) first.
  let sectionData: Json | undefined = fromSkeleton ? structuredClone((original as EmailSkeleton).sectionData) : (sliceSectionData(removedSections) ?? sliceSectionData(kept))
  if (background) {
    // Klaviyo's section style fields for a background image (SectionStyles in the Templates API).
    sectionData = sectionData ?? { properties: {}, display_options: {}, styles: {} }
    sectionData.styles = { ...(sectionData.styles ?? {}), background_url: background.url, background_asset_id: background.assetId }
  }
  // Where the slices go: where the replaced content started; with nothing to replace, before the
  // last kept section (usually the footer) or at the end.
  const firstRemoved = sections.findIndex((s) => !isHeaderOrFooter(s))
  const at = firstRemoved >= 0 ? sections.slice(0, firstRemoved).length : kept.length >= 2 ? kept.length - 1 : kept.length
  def.body = def.body ?? {}
  def.body.sections = kept
  const ins = insertRows(def, { section: at, row: 0, newSection: true, sectionData, label: 'Email content' }, sliceRows)
  const warnings = [...ins.warnings]
  if (!background && !sectionData?.styles?.background_url) {
    warnings.push('No section background image was set for the slices. Set it in Klaviyo if needed.')
  }
  return { ...ins, removed, kept: kept.length, warnings }
}

/** Removes the selected image blocks and inserts the slice rows where the first of them was. */
export function replaceImages(original: Json, removeKeys: string[], sliceRows: SliceRowInput[]): ReplaceResult {
  if (!removeKeys.length) throw new Error('Pick at least one image to replace.')
  if (!sliceRows.length) throw new Error('There are no slices to insert.')
  const removed = removeBlocks(original, removeKeys, { keepAnchorSection: true })
  const ins = insertRows(removed.definition, removed.anchor, sliceRows)
  return { ...ins, removed: removed.removed, warnings: [...ins.warnings, ...removed.warnings] }
}

export interface ImageSwap {
  /** Image currently in the campaign (the URL Klaviyo gave the old upload). */
  oldUrl: string
  oldAssetId?: string
  /** Revised image. */
  src: string
  assetId?: string
  /** Link / alt text from the app; omitted = keep what the block has. */
  href?: string
  alt?: string
}

export interface SwapResult {
  definition: Json
  /** Blocks updated per swap (same order as the input). */
  counts: number[]
}

/**
 * Replaces revised images in place: every image block whose src (or asset id) is the old image
 * gets the new src/asset id (and link/alt if given). HTML blocks have the URL replaced in their markup.
 * Nothing else moves.
 */
export function swapImages(original: Json, swaps: ImageSwap[]): SwapResult {
  const def: Json = structuredClone(original)
  const counts = swaps.map(() => 0)
  for (const section of sectionsOf(def)) {
    for (const row of section.rows ?? []) {
      for (const col of row.columns ?? []) {
        for (const block of col.blocks ?? []) {
          if (block.type === 'image') {
            const p = block?.data?.properties
            if (!p || p.dynamic === true) continue
            const i = swaps.findIndex((sw) => (sw.oldUrl && p.src === sw.oldUrl) || (sw.oldAssetId && p.asset_id === sw.oldAssetId))
            if (i < 0) continue
            const sw = swaps[i]
            p.src = sw.src
            if (sw.assetId) p.asset_id = sw.assetId
            else delete p.asset_id
            if (p.cropping_properties) delete p.cropping_properties
            if (sw.href !== undefined) p.href = sw.href
            if (sw.alt !== undefined) p.alt_text = sw.alt
            counts[i]++
          } else if (block.type === 'html' && typeof block?.data?.content === 'string') {
            swaps.forEach((sw, i) => {
              if (sw.oldUrl && block.data.content.includes(sw.oldUrl)) {
                block.data.content = block.data.content.split(sw.oldUrl).join(sw.src)
                counts[i]++
              }
            })
          }
        }
      }
    }
  }
  return { definition: def, counts }
}

/** Drops ids so a definition can be used to create a brand-new template. */
export function stripIds(def: Json): Json {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o: Json = {}
      for (const [k, val] of Object.entries(v)) if (k !== 'id' && k !== 'data_id' && k !== 'template_id') o[k] = walk(val)
      return o
    }
    return v
  }
  return walk(def)
}

/** Finds a Klaviyo id in a pasted link (or accepts a bare id). Returns candidates, most likely first. */
export function idsFromKlaviyoUrl(input: string): string[] {
  const s = input.trim()
  if (/^[A-Za-z0-9]{6,}$/.test(s)) return [s]
  let parts: string[] = []
  try {
    const u = new URL(s)
    parts = [...u.pathname.split('/'), ...[...u.searchParams.values()]]
  } catch {
    parts = s.split(/[/?&=#]/)
  }
  const words = new Set(['campaign', 'campaigns', 'email', 'editor', 'edit', 'content', 'wizard', 'overview', 'reports', 'template', 'templates', 'preview', 'summary', 'recipients', 'design'])
  const ids = parts.filter((p) => /^[A-Za-z0-9]{6,}$/.test(p) && !words.has(p.toLowerCase()) && /\d/.test(p))
  // ULIDs (26 chars) are campaign/message ids in current Klaviyo URLs.
  return [...new Set(ids)].sort((a, b) => Number(b.length === 26) - Number(a.length === 26))
}
