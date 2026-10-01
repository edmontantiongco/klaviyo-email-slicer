import { describe, expect, it } from 'vitest'
import {
  addColCut,
  addRowCut,
  analyzeFigmaFrame,
  analyzePixels,
  assertTiles,
  autoSlice,
  chooseRowCuts,
  DEFAULT_AUTO_OPTIONS,
  discoverEmailFrames,
  getSlices,
  moveRowCut,
  parseFigmaUrl,
  removeColCut,
  removeRowCut,
  setEqualColumns,
  singleSlice,
  validateLayout,
  type Blocker,
  type FigmaNode,
  type LayoutAnalysis,
} from './index'

const W = 1200
const b = (x: number, y: number, width: number, height: number, kind: Blocker['kind'], name: string = kind): Blocker => ({
  x,
  y,
  width,
  height,
  kind,
  name,
})

/** A typical campaign: header, hero, copy, 3-col product grid, CTA, footer. */
function sampleAnalysis(): LayoutAnalysis {
  const blockers: Blocker[] = [
    b(500, 40, 200, 80, 'vector', 'logo'),
    b(0, 200, 1200, 800, 'image', 'hero'),
    b(300, 600, 600, 120, 'text', 'hero headline'), // text on top of hero
    b(150, 1080, 900, 60, 'text', 'intro 1'),
    b(150, 1150, 900, 60, 'text', 'intro 2'),
    // product grid
    b(60, 1320, 340, 340, 'image', 'p1'),
    b(430, 1320, 340, 340, 'image', 'p2'),
    b(800, 1320, 340, 340, 'image', 'p3'),
    b(60, 1680, 340, 60, 'text', 'p1 name'),
    b(430, 1680, 340, 60, 'text', 'p2 name'),
    b(800, 1680, 340, 60, 'text', 'p3 name'),
    b(450, 1860, 300, 90, 'component', 'CTA button'),
    b(200, 2080, 800, 160, 'text', 'footer copy'),
  ]
  const sections = [
    { top: 0, bottom: 200, name: 'Header' },
    { top: 200, bottom: 1000, name: 'Hero' },
    { top: 1000, bottom: 1260, name: 'Intro' },
    { top: 1260, bottom: 1800, name: 'Products' },
    { top: 1800, bottom: 2000, name: 'CTA' },
    { top: 2000, bottom: 2300, name: 'Footer' },
  ]
  const edges = sections.flatMap((s) => [s.top, s.bottom]).filter((e) => e > 0 && e < 2300)
  return { source: 'figma', width: W, height: 2300, blockers, sections, edges: [...new Set(edges)] }
}

describe('layout operations', () => {
  it('keeps rows and columns tiling the image exactly', () => {
    let l = singleSlice(W, 2000)
    l = addRowCut(l, 500)
    l = addRowCut(l, 1200)
    l = addColCut(l, 1, 600)
    l = addColCut(l, 1, 300)
    assertTiles(l)
    expect(l.rows.map((r) => r.bottom)).toEqual([500, 1200, 2000])
    expect(l.rows[1].colCuts).toEqual([300, 600])
    const slices = getSlices(l)
    expect(slices).toHaveLength(5)
    const area = slices.reduce((s, x) => s + x.width * x.height, 0)
    expect(area).toBe(W * 2000)

    l = moveRowCut(l, 0, 5000) // clamped
    expect(l.rows[0].bottom).toBe(1198)
    l = removeColCut(l, 1, 0)
    expect(l.rows[1].colCuts).toEqual([600])
    l = removeRowCut(l, 0)
    assertTiles(l)
    expect(l.rows).toHaveLength(2)
    l = setEqualColumns(l, 1, 4)
    expect(l.rows[1].colCuts).toEqual([300, 600, 900])
    assertTiles(l)
  })

  it('ignores cuts outside the image or too close to an edge', () => {
    const l = singleSlice(W, 100)
    expect(addRowCut(l, 0)).toBe(l)
    expect(addRowCut(l, 100)).toBe(l)
    expect(addRowCut(l, 1)).toBe(l)
  })
})

describe('auto slicing', () => {
  it('cuts at section boundaries and never through text or buttons', () => {
    const a = sampleAnalysis()
    const layout = autoSlice(a, DEFAULT_AUTO_OPTIONS)
    assertTiles(layout)
    const cuts = layout.rows.slice(0, -1).map((r) => r.bottom)
    expect(cuts).toEqual(expect.arrayContaining([200, 1000, 1800, 2000]))
    const issues = validateLayout(layout, a, DEFAULT_AUTO_OPTIONS)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    // named after Figma sections
    expect(layout.rows[0].cells[0].name).toBe('Header')
  })

  it('detects a 3-column product grid', () => {
    const a = sampleAnalysis()
    const layout = autoSlice(a, DEFAULT_AUTO_OPTIONS)
    const productRows = layout.rows.filter((r) => r.colCuts.length === 2)
    expect(productRows.length).toBeGreaterThanOrEqual(1)
    const [c1, c2] = productRows[0].colCuts
    expect(c1).toBeGreaterThanOrEqual(400)
    expect(c1).toBeLessThanOrEqual(430)
    expect(c2).toBeGreaterThanOrEqual(770)
    expect(c2).toBeLessThanOrEqual(800)
    // header (single centred logo) must not be split
    expect(layout.rows[0].colCuts).toEqual([])
  })

  it('splits a very tall section without cutting text', () => {
    const blockers: Blocker[] = []
    for (let i = 0; i < 30; i++) blockers.push(b(100, 40 + i * 140, 1000, 80, 'text', `para ${i}`))
    const a: LayoutAnalysis = { source: 'figma', width: W, height: 4300, blockers, sections: [], edges: [] }
    const opts = { ...DEFAULT_AUTO_OPTIONS, maxHeight: 1000 }
    const cuts = chooseRowCuts(a, opts)
    const bottoms = [...cuts, 4300]
    let top = 0
    for (const bt of bottoms) {
      expect(bt - top).toBeLessThanOrEqual(1000)
      top = bt
    }
    const layout = autoSlice(a, opts)
    expect(validateLayout(layout, a, opts)).toEqual([])
  })

  it('cuts through a giant photo only when it must, never through text on it', () => {
    const a: LayoutAnalysis = {
      source: 'figma',
      width: W,
      height: 3000,
      blockers: [b(0, 0, 1200, 3000, 'image', 'photo'), b(200, 1400, 800, 200, 'text', 'overlay')],
      sections: [],
      edges: [],
    }
    const layout = autoSlice(a, DEFAULT_AUTO_OPTIONS)
    expect(layout.rows.length).toBeGreaterThan(1)
    const issues = validateLayout(layout, a, DEFAULT_AUTO_OPTIONS)
    expect(issues.some((i) => i.severity === 'error')).toBe(false)
    expect(issues.some((i) => i.severity === 'warning')).toBe(true)
  })

  it('snaps cuts to even pixels when there is room', () => {
    const a: LayoutAnalysis = {
      source: 'figma',
      width: W,
      height: 1201,
      blockers: [b(0, 0, 1200, 500, 'image'), b(0, 551, 1200, 650, 'image')],
      sections: [],
      edges: [],
    }
    const cuts = chooseRowCuts(a, { ...DEFAULT_AUTO_OPTIONS, maxHeight: 800 })
    expect(cuts.length).toBe(1)
    expect(cuts[0] % 2).toBe(0)
    expect(cuts[0]).toBeGreaterThanOrEqual(500)
    expect(cuts[0]).toBeLessThanOrEqual(551)
  })
})

describe('figma extraction', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
  const frame: FigmaNode = {
    id: '1:1',
    name: 'Oct 1 – Launch',
    type: 'FRAME',
    absoluteBoundingBox: box(1000, 500, 600, 900),
    children: [
      {
        id: '1:2',
        name: 'Header',
        type: 'FRAME',
        absoluteBoundingBox: box(1000, 500, 600, 100),
        fills: [{ type: 'SOLID' }],
        children: [{ id: '1:3', name: 'Logo', type: 'VECTOR', absoluteBoundingBox: box(1250, 520, 100, 40) }],
      },
      {
        id: '1:4',
        name: 'Hero',
        type: 'FRAME',
        absoluteBoundingBox: box(1000, 600, 600, 500),
        fills: [{ type: 'SOLID' }],
        children: [
          { id: '1:5', name: 'bg', type: 'RECTANGLE', absoluteBoundingBox: box(1000, 600, 600, 500), fills: [{ type: 'SOLID' }] },
          { id: '1:6', name: 'Title', type: 'TEXT', absoluteBoundingBox: box(1050, 700, 500, 60) },
          { id: '1:7', name: 'Hidden', type: 'TEXT', visible: false, absoluteBoundingBox: box(1050, 900, 500, 60) },
          { id: '1:8', name: 'Shop now', type: 'INSTANCE', absoluteBoundingBox: box(1200, 1000, 200, 50), children: [] },
        ],
      },
      { id: '1:9', name: 'Footer', type: 'FRAME', absoluteBoundingBox: box(1000, 1100, 600, 300), children: [] },
    ],
  }

  it('maps layers to blockers in export-pixel space', () => {
    const a = analyzeFigmaFrame(frame, 2)
    expect(a.width).toBe(1200)
    expect(a.height).toBe(1800)
    const names = a.blockers.map((x) => x.name)
    expect(names).toEqual(['Logo', 'Title', 'Shop now'])
    expect(a.blockers.find((x) => x.name === 'Title')).toMatchObject({ x: 100, y: 400, width: 1000, height: 120, kind: 'text' })
    expect(a.sections.map((s) => s.name)).toEqual(['Header', 'Hero', 'Footer'])
    expect(a.edges).toEqual([200, 1200])
  })

  it('discovers email frames in a section in reading order', () => {
    const section: FigmaNode = {
      id: '0:1',
      name: 'October 2026',
      type: 'SECTION',
      children: [
        { id: '2:1', name: 'Oct 8', type: 'FRAME', absoluteBoundingBox: box(1400, 0, 1200, 4000) },
        { id: '2:2', name: 'Oct 1', type: 'FRAME', absoluteBoundingBox: box(0, 0, 1200, 3000) },
        { id: '2:3', name: 'note', type: 'TEXT', absoluteBoundingBox: box(0, -100, 400, 40) },
        {
          id: '2:4',
          name: 'Week 3',
          type: 'SECTION',
          children: [{ id: '2:5', name: 'Oct 15', type: 'FRAME', absoluteBoundingBox: box(2800, 0, 1200, 3500) }],
        },
      ],
    }
    expect(discoverEmailFrames(section).map((f) => f.name)).toEqual(['Oct 1', 'Oct 8', 'Oct 15'])
    expect(discoverEmailFrames(frame).map((f) => f.name)).toEqual(['Oct 1 – Launch'])
  })

  it('parses Figma URLs', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/AbCdEf123456/Emails?node-id=12-345&t=x')).toEqual({
      fileKey: 'AbCdEf123456',
      nodeId: '12:345',
    })
    expect(parseFigmaUrl('https://www.figma.com/file/AbCdEf123456/Emails')).toEqual({ fileKey: 'AbCdEf123456', nodeId: undefined })
    expect(parseFigmaUrl('https://example.com/design/x')).toBeNull()
  })
})

describe('pixel analysis', () => {
  function makeImage(width: number, height: number, paint: (x: number, y: number) => [number, number, number]) {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const [r, g, bl] = paint(x, y)
        const i = (y * width + x) * 4
        data[i] = r
        data[i + 1] = g
        data[i + 2] = bl
        data[i + 3] = 255
      }
    return { data, width, height }
  }

  it('finds content blobs, colour bands and grid columns', () => {
    // white band 0-400 with a "photo" (noise) 50-350; black band 400-800 with 3 tiles at 450-750
    const img = makeImage(600, 800, (x, y) => {
      if (y < 400) return y >= 50 && y < 350 && x >= 50 && x < 550 ? [(x * 7 + y * 13) % 255, (x * y) % 255, 90] : [255, 255, 255]
      const inTile = y >= 450 && y < 750 && [[30, 180], [210, 390], [420, 570]].some(([a, c]) => x >= a && x < c)
      return inTile ? [(x * 3 + y * 5) % 255, 120, (y * 11) % 255] : [0, 0, 0]
    })
    const a = analyzePixels(img)
    expect(a.edges).toContain(400)
    const opts = { ...DEFAULT_AUTO_OPTIONS, minHeight: 60, maxHeight: 600, columnMinGap: 12 }
    const layout = autoSlice(a, opts)
    assertTiles(layout)
    expect(layout.rows.map((r) => r.bottom)).toContain(400)
    const grid = layout.rows.find((r) => r.colCuts.length === 2)
    expect(grid).toBeDefined()
    expect(validateLayout(layout, a, opts).filter((i) => i.severity === 'error')).toEqual([])
  })
})


describe('meta suggestions', () => {
  it('fills alt text and links from Figma copy inside each slice', async () => {
    const { suggestCellMeta } = await import('./suggest')
    const a = sampleAnalysis()
    a.blockers.find((x) => x.name === 'CTA button')!.text = 'Shop the sale'
    a.blockers.find((x) => x.name === 'CTA button')!.link = 'https://shop.example.com/sale'
    a.blockers.find((x) => x.name === 'hero headline')!.text = 'Autumn Drop'
    const l = suggestCellMeta(autoSlice(a, DEFAULT_AUTO_OPTIONS), a)
    const cta = l.rows.find((r) => r.cells[0].name === 'CTA')!.cells[0]
    expect(cta).toMatchObject({ alt: 'Shop the sale', link: 'https://shop.example.com/sale' })
    expect(l.rows.find((r) => r.cells[0].name === 'Hero')!.cells[0].alt).toBe('Autumn Drop')
  })
})
