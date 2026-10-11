import { describe, expect, it } from 'vitest'
import { carryOverMeta, collectFigmaSlices, getSlices, layoutFromFigmaSlices, analyzeFigmaFrame, type FigmaNode, type FigmaSlice } from './index'

const W = 1200
const sl = (nodeId: string, name: string, x: number, y: number, width: number, height: number): FigmaSlice => ({ nodeId, name, x, y, width, height })
const shape = (l: ReturnType<typeof layoutFromFigmaSlices>['layout']) => getSlices(l).map((s) => [s.meta.name, s.x, s.y, s.width, s.height])

describe('Figma slices → app slices', () => {
  it('stacked full-width slices map 1:1 with Figma names and stable ids', () => {
    const { layout, warnings } = layoutFromFigmaSlices([sl('1:2', 'Slice 37', 0, 0, W, 1400), sl('1:3', 'Slice 38', 0, 1400, W, 600), sl('1:4', 'Footer', 0, 2000, W, 400)], W, 2400)
    expect(warnings).toEqual([])
    expect(shape(layout)).toEqual([
      ['Slice 37', 0, 0, W, 1400],
      ['Slice 38', 0, 1400, W, 600],
      ['Footer', 0, 2000, W, 400],
    ])
    expect(getSlices(layout).map((s) => s.id)).toEqual(['figma:1:2', 'figma:1:3', 'figma:1:4'])
  })

  it('side-by-side slices become columns of one row', () => {
    const { layout } = layoutFromFigmaSlices(
      [sl('h', 'Hero', 0, 0, W, 800), sl('a', 'Sofas', 0, 800, 400, 500), sl('b', 'Lighting', 400, 800, 400, 500), sl('c', 'Dining', 800, 800, 400, 500)],
      W,
      1300,
    )
    expect(layout.rows).toHaveLength(2)
    expect(layout.rows[1].colCuts).toEqual([400, 800])
    expect(shape(layout).slice(1).map((r) => r[0])).toEqual(['Sofas', 'Lighting', 'Dining'])
  })

  it('snaps 1–3px gaps from fractional Figma coordinates', () => {
    const { layout, warnings } = layoutFromFigmaSlices([sl('1', 'A', 1, 2, W - 1, 698), sl('2', 'B', 0, 701, W - 2, 597)], W, 1300)
    expect(warnings).toEqual([])
    expect(shape(layout)).toEqual([
      ['A', 0, 0, W, 701],
      ['B', 0, 701, W, 599],
    ])
  })

  it('keeps unsliced areas as named filler pieces and warns', () => {
    const { layout, warnings } = layoutFromFigmaSlices([sl('1', 'Hero', 0, 100, W, 700), sl('2', 'Left', 0, 900, 500, 300)], W, 1400)
    expect(shape(layout)).toEqual([
      ['Unsliced area', 0, 0, W, 100],
      ['Hero', 0, 100, W, 700],
      ['Unsliced area', 0, 800, W, 100],
      ['Left', 0, 900, 500, 300],
      ['Unsliced area', 500, 900, 700, 300],
      ['Unsliced area', 0, 1200, W, 200],
    ])
    expect(warnings[0]).toMatch(/aren’t covered by a Figma slice/)
  })

  it('warns about uneven heights and overlaps; ignores slices outside the frame', () => {
    const { layout, warnings } = layoutFromFigmaSlices(
      [sl('1', 'Tall', 0, 0, 600, 500), sl('2', 'Short', 600, 0, 600, 300), sl('3', 'Dup', 100, 0, 300, 200), sl('4', 'Outside', 0, 5000, W, 100)],
      W,
      500,
    )
    expect(shape(layout)).toEqual([
      ['Tall', 0, 0, 600, 500],
      ['Short', 600, 0, 600, 500],
    ])
    expect(warnings.join(' ')).toMatch(/“Short” is shorter/)
    expect(warnings.join(' ')).toMatch(/“Dup” overlaps/)
    expect(warnings.join(' ')).toMatch(/“Outside” is outside/)
  })

  it('no slices → one unsliced piece', () => {
    expect(shape(layoutFromFigmaSlices([], W, 900).layout)).toEqual([['Unsliced area', 0, 0, W, 900]])
  })

  it('reads SLICE layers (nested too) from the Figma tree at export scale', () => {
    const frame: FigmaNode = {
      id: '0:1',
      name: 'TEST EDMON - KLAVIYO SLICER',
      type: 'FRAME',
      absoluteBoundingBox: { x: 100, y: 50, width: 600, height: 1000 },
      children: [
        { id: '1:37', name: 'Slice 37', type: 'SLICE', absoluteBoundingBox: { x: 100, y: 50, width: 600, height: 700 } },
        { id: '1:9', name: 'Group', type: 'GROUP', absoluteBoundingBox: { x: 100, y: 750, width: 600, height: 300 }, children: [{ id: '1:38', name: 'Slice 38', type: 'SLICE', absoluteBoundingBox: { x: 100, y: 750, width: 600, height: 300 } }] },
        { id: '1:39', name: 'Hidden', type: 'SLICE', visible: false, absoluteBoundingBox: { x: 100, y: 50, width: 600, height: 10 } },
      ],
    }
    expect(collectFigmaSlices(frame, 2)).toEqual([
      { nodeId: '1:37', name: 'Slice 37', x: 0, y: 0, width: 1200, height: 1400 },
      { nodeId: '1:38', name: 'Slice 38', x: 0, y: 1400, width: 1200, height: 600 },
    ])
    expect(analyzeFigmaFrame(frame, 2).figmaSlices).toHaveLength(2)
  })

  it('carries links/alt/format over by Figma layer id when rebuilt', () => {
    const before = layoutFromFigmaSlices([sl('1', 'Slice 37', 0, 0, W, 700)], W, 700).layout
    before.rows[0].cells[0] = { ...before.rows[0].cells[0], link: 'https://rove', alt: 'Hero', format: 'png' }
    const after = carryOverMeta(layoutFromFigmaSlices([sl('1', 'Slice 37 (renamed)', 0, 0, W, 700)], W, 700).layout, before)
    expect(after.rows[0].cells[0]).toMatchObject({ name: 'Slice 37 (renamed)', link: 'https://rove', alt: 'Hero', format: 'png' })
  })
})
