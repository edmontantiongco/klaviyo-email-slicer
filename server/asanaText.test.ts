import { describe, expect, it } from 'vitest'
import { asanaTaskGid, findCopy, scoreTask } from './asanaText.ts'

describe('findCopy', () => {
  it('reads labels glued to the text (Asana code-styled labels)', () => {
    expect(findCopy('Subject lineBlack Friday Flash Sale - for the rooms that matter most \nPreview textUp to 80% off sitewide')).toEqual({
      subject: 'Black Friday Flash Sale - for the rooms that matter most',
      previewText: 'Up to 80% off sitewide',
    })
  })
  it('reads "Label:" lines and labels with the text on the next line', () => {
    expect(findCopy('Brief: https://docs.google.com/x\n\nSubject:\nNew arrivals are here\n\nPreheader: Shop the drop')).toEqual({
      subject: 'New arrivals are here',
      previewText: 'Shop the drop',
    })
  })
  it('doesn’t guess unlabelled copy', () => {
    expect(findCopy('New arrivals are here\nShop the drop')).toEqual({ subject: null, previewText: null })
    expect(findCopy('Subject line\nPreview text\nShop the drop')).toEqual({ subject: null, previewText: 'Shop the drop' })
  })
})

describe('asanaTaskGid', () => {
  it('reads both link formats and bare ids', () => {
    expect(asanaTaskGid('https://app.asana.com/1/398529804021475/project/1215543399645634/task/1219817125915047')).toBe('1219817125915047')
    expect(asanaTaskGid('https://app.asana.com/0/1215543399645634/1219817125915047/f')).toBe('1219817125915047')
    expect(asanaTaskGid('1219817125915047')).toBe('1219817125915047')
    expect(asanaTaskGid('flash sale')).toBeNull()
  })
})

describe('scoreTask', () => {
  const email = 'MS-03 · Nov 6: RC Email | The Black Friday Sale, in the rooms you live in'
  it('prefers the email task that starts with the date', () => {
    const task = scoreTask('Nov 6: RC Email | Flash Sale', 'Nov 6', email)
    expect(task).toBeGreaterThan(scoreTask('Nov 6: RC SMS | Flash Sale', 'Nov 6', email))
    expect(scoreTask('Email Implementation | Nov 6: RC Email | Flash Sale', 'Nov 6', email)).toBe(0)
    expect(scoreTask('Nov 16: RC Email | Flash Sale', 'Nov 6', email)).toBe(0)
    expect(scoreTask('November 06 - RC Email', 'Nov 6', email)).toBeGreaterThan(0)
  })
})
