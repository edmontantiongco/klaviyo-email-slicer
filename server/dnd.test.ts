import { describe, expect, it } from 'vitest'
import { buildRows, idsFromKlaviyoUrl, insertRows, matchColumnLayout, removeBlocks, replaceImages, stripIds, summarize, swapImages, type Json } from './dnd.ts'

const img = (id: string, src: string, href = '', extra: Json = {}): Json => ({
  id,
  data_id: `d-${id}`,
  content_type: 'block',
  type: 'image',
  data: { properties: { dynamic: false, src, href, alt_text: `alt ${id}` }, display_options: {}, styles: { width: 600 } },
  ...extra,
})
const text = (id: string): Json => ({ id, content_type: 'block', type: 'text', data: { content: '<p>Hello</p>', display_options: {}, styles: {} } })
const row = (layout: string, ...cols: Json[][]): Json => ({ id: `row-${Math.random()}`, data: { styles: { column_layout: layout } }, columns: cols.map((blocks) => ({ data: {}, blocks })) })
const section = (id: string, rows: Json[], extra: Json = {}): Json => ({ id, content_type: 'section', type: 'section', data: { properties: {}, display_options: {}, styles: {} }, rows, ...extra })

/** A cloned campaign: header (logo), last month's slices, a 3-up grid, a text block, universal footer. */
function fixture(): Json {
  return {
    id: 'def1',
    template_id: 'T1',
    body: {
      id: 'body',
      properties: {},
      styles: { width: 600, background_color: '#ffffff' },
      sections: [
        section('header', [row('1-column-full-width', [img('logo', 'https://cdn/logo.png', 'https://rove')])]),
        section('content', [
          row('1-column-full-width', [img('old1', 'https://cdn/old1.jpg', 'https://a')]),
          row('1-column-full-width', [img('old2', 'https://cdn/old2.jpg', 'https://b')]),
          row('3-columns-equal-width', [img('g1', 'https://cdn/g1.jpg')], [img('g2', 'https://cdn/g2.jpg')], [img('g3', 'https://cdn/g3.jpg')]),
          row('1-column-full-width', [text('legal')]),
        ]),
        section('footer', [row('1-column-full-width', [img('social', 'https://cdn/social.png'), text('unsub')])], { universal_id: 'U1' }),
      ],
    },
    styles: [],
  }
}

const slices = [
  { cells: [{ src: 'https://k/new1.jpg', assetId: 'A1', href: 'https://x/1', alt: 'Hero', fraction: 1 }] },
  { cells: [0, 1, 2].map((i) => ({ src: `https://k/c${i}.jpg`, href: `https://x/c${i}`, alt: `Cat ${i}`, fraction: 1 / 3 })) },
  { cells: [{ src: 'https://k/a.jpg', href: '', alt: 'A', fraction: 0.4 }, { src: 'https://k/b.jpg', href: '', alt: 'B', fraction: 0.6 }] },
]

describe('summarize', () => {
  it('lists static image blocks with position, links and universal flag', () => {
    const s = summarize(fixture())
    expect(s.images.map((i) => i.blockId)).toEqual(['logo', 'old1', 'old2', 'g1', 'g2', 'g3', 'social'])
    expect(s.images.find((i) => i.blockId === 'social')!.universal).toBe(true)
    expect(s.images.find((i) => i.blockId === 'g2')!).toMatchObject({ section: 1, row: 2, column: 1, columnsInRow: 3 })
    expect(s.blockTypes).toEqual({ image: 7, text: 2 })
    expect(s.width).toBe(600)
  })
})

describe('column presets', () => {
  it('matches Klaviyo presets within tolerance', () => {
    expect(matchColumnLayout([0.5, 0.5])).toBe('2-columns-equal-width')
    expect(matchColumnLayout([0.334, 0.333, 0.333])).toBe('3-columns-equal-width')
    expect(matchColumnLayout([0.25, 0.5, 0.25])).toBe('3-columns-25%-50%-25%')
    expect(matchColumnLayout([0.4, 0.6])).toBeNull()
    // 203/195/202 px of 600 is too far from equal thirds for images to line up
    expect(matchColumnLayout([203 / 600, 195 / 600, 202 / 600])).toBeNull()
  })
  it('builds native image blocks with zero padding, or an exact HTML block', () => {
    const { rows, plan } = buildRows(slices, 600)
    expect(plan.map((p) => p.mode)).toEqual(['image', 'columns', 'html'])
    const hero = rows[0].columns[0].blocks[0]
    expect(hero).toMatchObject({ type: 'image', data: { properties: { src: 'https://k/new1.jpg', asset_id: 'A1', href: 'https://x/1', alt_text: 'Hero', dynamic: false } } })
    expect(hero.data.styles).toMatchObject({ width: 600, block_padding_top: 0, block_padding_bottom: 0, block_padding_left: 0, block_padding_right: 0 })
    expect(rows[1].data.styles.column_layout).toBe('3-columns-equal-width')
    expect(rows[1].columns.map((c: Json) => c.blocks[0].data.styles.width)).toEqual([200, 200, 200])
    const html = rows[2].columns[0].blocks[0]
    expect(html.type).toBe('html')
    expect(html.data.content).toContain('width="240"')
    expect(html.data.content).toContain('width="360"')
  })
})

describe('replaceImages', () => {
  const keysFor = (def: Json, ids: string[]) => summarize(def).images.filter((i) => ids.includes(i.blockId!)).map((i) => i.key)

  it('swaps the chosen images in place and keeps everything else', () => {
    const def = fixture()
    const before = JSON.stringify(def)
    const r = replaceImages(def, keysFor(def, ['old1', 'old2', 'g1', 'g2', 'g3']), slices)
    expect(JSON.stringify(def)).toBe(before) // input untouched

    const s = summarize(r.definition)
    expect(s.images.map((i) => i.blockId ?? i.src)).toEqual(['logo', 'https://k/new1.jpg', 'https://k/c0.jpg', 'https://k/c1.jpg', 'https://k/c2.jpg', 'social'])
    const content = r.definition.body.sections[1]
    expect(content.id).toBe('content')
    // new rows sit where old1 was; the emptied rows are gone; the text row stays last
    expect(content.rows).toHaveLength(4)
    expect(content.rows[3].columns[0].blocks[0].id).toBe('legal')
    expect(r).toMatchObject({ removed: 5, inserted: 3, insertedAt: { section: 1, row: 0 }, contentWidth: 600 })
    expect(r.warnings.some((w) => w.includes('HTML block'))).toBe(true)
    // section, body and template ids are preserved for an in-place update
    expect(r.definition.id).toBe('def1')
    expect(r.definition.body.sections.map((x: Json) => x.id)).toEqual(['header', 'content', 'footer'])
  })

  it('drops a section that only held removed images', () => {
    const def = fixture()
    def.body.sections.splice(2, 0, section('promo', [row('1-column-full-width', [img('promo', 'https://cdn/promo.jpg')])]))
    const r = replaceImages(def, keysFor(def, ['old1', 'promo']), [slices[0]])
    expect(r.definition.body.sections.map((x: Json) => x.id)).toEqual(['header', 'content', 'footer'])
  })

  it('keeps the anchor section when it only contains the new rows', () => {
    const def = fixture()
    const r = replaceImages(def, keysFor(def, ['logo']), [slices[0]])
    expect(r.definition.body.sections.map((x: Json) => x.id)).toEqual(['header', 'content', 'footer'])
    expect(r.definition.body.sections[0].rows).toHaveLength(1)
    expect(r.definition.body.sections[0].rows[0].columns[0].blocks[0].data.properties.src).toBe('https://k/new1.jpg')
  })

  it('inserts after a row whose column has content above the image', () => {
    const def = fixture()
    def.body.sections[1].rows.unshift(row('1-column-full-width', [text('intro'), img('mid', 'https://cdn/mid.jpg')]))
    const r = replaceImages(def, keysFor(def, ['mid']), [slices[0]])
    const rows = r.definition.body.sections[1].rows
    expect(rows[0].columns[0].blocks.map((b: Json) => b.id)).toEqual(['intro'])
    expect(rows[1].columns[0].blocks[0].data.properties.src).toBe('https://k/new1.jpg')
  })

  it('accounts for section side padding and warns about universal content', () => {
    const def = fixture()
    def.body.sections[2].data.styles = { inner_padding_left: 20, inner_padding_right: 20 }
    const r = replaceImages(def, keysFor(def, ['social']), [slices[0]])
    expect(r.contentWidth).toBe(560)
    expect(r.warnings.join(' ')).toMatch(/side padding/)
    expect(r.warnings.join(' ')).toMatch(/universal/)
  })

  it('rejects stale or empty selections', () => {
    expect(() => replaceImages(fixture(), ['s9.r9.c9.b9'], slices)).toThrow(/changed/)
    expect(() => replaceImages(fixture(), [], slices)).toThrow(/at least one/)
  })
})

describe('remove now, insert later', () => {
  const keysFor = (def: Json, ids: string[]) => summarize(def).images.filter((i) => ids.includes(i.blockId!)).map((i) => i.key)

  it('removes images only and remembers where they were', () => {
    const def = fixture()
    const r = removeBlocks(def, keysFor(def, ['old1', 'old2']))
    expect(r.removed).toBe(2)
    expect(summarize(r.definition).images.map((i) => i.blockId)).toEqual(['logo', 'g1', 'g2', 'g3', 'social'])
    expect(r.anchor).toMatchObject({ section: 1, row: 0, newSection: false, label: 'Section 2 · Row 1' })
    expect(r.definition.body.sections[1].rows).toHaveLength(2) // grid + text left
  })

  it('later inserts the slices at that spot — same result as replacing in one go', () => {
    const def = fixture()
    const keys = keysFor(def, ['old1', 'old2', 'g1', 'g2', 'g3'])
    const removed = removeBlocks(def, keys)
    const later = insertRows(removed.definition, removed.anchor, slices)
    const atOnce = replaceImages(def, keys, slices)
    expect(later.definition).toEqual(atOnce.definition)
    expect(later.insertedAt).toEqual(atOnce.insertedAt)
  })

  it('drops an emptied section, then recreates it with its settings when inserting', () => {
    const def = fixture()
    def.body.sections[0].data.styles = { background_color: '#f4efe8' }
    const removed = removeBlocks(def, keysFor(def, ['logo']))
    expect(removed.definition.body.sections.map((x: Json) => x.id)).toEqual(['content', 'footer'])
    expect(removed.anchor).toMatchObject({ section: 0, row: 0, newSection: true })
    const later = insertRows(removed.definition, removed.anchor, [slices[0]])
    const first = later.definition.body.sections[0]
    expect(first.data.styles.background_color).toBe('#f4efe8')
    expect(first.rows[0].columns[0].blocks[0].data.properties.src).toBe('https://k/new1.jpg')
    expect(later.definition.body.sections).toHaveLength(3)
  })

  it('refuses an anchor that no longer fits the layout', () => {
    expect(() => insertRows(fixture(), { section: 9, row: 0, newSection: false, label: '' }, slices)).toThrow(/layout changed/)
    expect(() => insertRows(fixture(), { section: 1, row: 99, newSection: false, label: '' }, slices)).toThrow(/layout changed/)
  })
})

describe('swapImages (revised in Figma)', () => {
  it('replaces only the revised images, in place, keeping everything else', () => {
    const def = fixture()
    const r = swapImages(def, [
      { oldUrl: 'https://cdn/old2.jpg', src: 'https://k/old2-v2.jpg', assetId: 'A9', href: 'https://x/new', alt: 'Revised' },
      { oldUrl: 'https://cdn/not-in-campaign.jpg', src: 'https://k/x.jpg' },
    ])
    expect(r.counts).toEqual([1, 0])
    const s = summarize(r.definition)
    expect(s.images.map((i) => i.src)).toEqual(['https://cdn/logo.png', 'https://cdn/old1.jpg', 'https://k/old2-v2.jpg', 'https://cdn/g1.jpg', 'https://cdn/g2.jpg', 'https://cdn/g3.jpg', 'https://cdn/social.png'])
    const b = r.definition.body.sections[1].rows[1].columns[0].blocks[0]
    expect(b.id).toBe('old2') // same block, same place
    expect(b.data.properties).toMatchObject({ asset_id: 'A9', href: 'https://x/new', alt_text: 'Revised' })
    expect(JSON.stringify(def)).toContain('https://cdn/old2.jpg') // input untouched
  })
  it('matches by asset id too, and rewrites URLs inside HTML blocks', () => {
    const def = fixture()
    def.body.sections[1].rows[0].columns[0].blocks[0].data.properties.asset_id = 'OLD1'
    def.body.sections[1].rows[3].columns[0].blocks.push({ type: 'html', data: { content: '<img src="https://cdn/g1.jpg">', display_options: {} } })
    const r = swapImages(def, [
      { oldUrl: 'https://elsewhere/old1.jpg', oldAssetId: 'OLD1', src: 'https://k/hero.jpg' },
      { oldUrl: 'https://cdn/g1.jpg', src: 'https://k/g1-v2.jpg' },
    ])
    expect(r.counts).toEqual([1, 2])
    expect(r.definition.body.sections[1].rows[0].columns[0].blocks[0].data.properties.src).toBe('https://k/hero.jpg')
    expect(r.definition.body.sections[1].rows[3].columns[0].blocks[1].data.content).toContain('https://k/g1-v2.jpg')
  })
})

describe('Klaviyo definition errors', () => {
  it('turns the header/logo error into fix steps', async () => {
    const { definitionHelp } = await import('./campaign.ts')
    const msg = definitionHelp("Unprocessable Content.: Failed to load definition for template QVWHgA: Header blocks with 'links' desktop layout must not include a logo subblock @ $")
    expect(msg).toContain("“Header blocks with 'links' desktop layout must not include a logo subblock”")
    expect(msg).toMatch(/Desktop layout to one that shows the logo \(Centered, Inline or Stacked\)/)
    expect(msg).toMatch(/remove the logo/)
    expect(definitionHelp('Bad: Failed to load definition for template X: Something else @ $')).toMatch(/Klaviyo says: “Something else”/)
  })
})

describe('helpers', () => {
  it('strips ids for template creation', () => {
    const s = JSON.stringify(stripIds(fixture()))
    expect(s).not.toMatch(/"id"|"data_id"|"template_id"/)
    expect(s).toContain('universal_id')
  })
  it('extracts campaign ids from Klaviyo links', () => {
    expect(idsFromKlaviyoUrl('https://www.klaviyo.com/campaign/01J9ZB7Q4W8XG2Y3T5R6N7M8K9/wizard/1')).toEqual(['01J9ZB7Q4W8XG2Y3T5R6N7M8K9'])
    expect(idsFromKlaviyoUrl('01J9ZB7Q4W8XG2Y3T5R6N7M8K9')).toEqual(['01J9ZB7Q4W8XG2Y3T5R6N7M8K9'])
    expect(idsFromKlaviyoUrl('https://www.klaviyo.com/email-editor/campaign/01J9ZB7Q4W8XG2Y3T5R6N7M8K9/content/edit')[0]).toBe('01J9ZB7Q4W8XG2Y3T5R6N7M8K9')
    expect(idsFromKlaviyoUrl('https://www.klaviyo.com/campaigns/list')).toEqual([])
  })
})
