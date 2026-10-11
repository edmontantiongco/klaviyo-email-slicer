import { describe, expect, it } from 'vitest'
import { klaviyoFileName, klaviyoImageName, sliceFileName } from './naming'
import type { Slice } from './slicing'

const slice = (name: string, colCount = 1, colIndex = 0): Slice => ({
  id: 'c1',
  x: 0,
  y: 0,
  width: 1200,
  height: 1400,
  rowIndex: 0,
  colIndex,
  colCount,
  meta: { id: 'c1', name, link: '', alt: '', format: 'auto' },
})

describe('Klaviyo image names', () => {
  it('uses the slice name from the app exactly', () => {
    expect(klaviyoImageName('test-edmon-klaviyo-slicer', slice('Test 1011 - 1'))).toBe('Test 1011 - 1')
    expect(klaviyoFileName('test-edmon-klaviyo-slicer', slice('Test 1011 - 1'), 'jpg')).toBe('Test 1011 - 1.jpg')
  })
  it('tidies whitespace and strips slashes / control characters', () => {
    expect(klaviyoImageName('p', slice('  Hero /  Oct\t1  '))).toBe('Hero Oct 1')
  })
  it('falls back to the generated file name when the name is empty', () => {
    expect(klaviyoImageName('oct-1', slice('   ', 3, 1))).toBe('oct-1_01b')
  })
  it('leaves ZIP/HTML file names unchanged', () => {
    expect(sliceFileName('test-edmon-klaviyo-slicer', slice('Test 1011 - 1'), 'jpg')).toBe('test-edmon-klaviyo-slicer_01_test-1011-1.jpg')
  })
})
