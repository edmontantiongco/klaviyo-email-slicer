import { HARD_KINDS, crossesX, crossesY } from './geometry'
import { rowTop } from './layout'
import type { AutoSliceOptions, Blocker, LayoutAnalysis, LayoutIssue, SliceLayout } from './types'

function describe(blockers: Blocker[]): string {
  const names = [...new Set(blockers.map((b) => (b.kind === 'content' ? 'content' : `${b.kind} “${b.name}”`)))]
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '')
}

export function validateLayout(
  layout: SliceLayout,
  analysis: LayoutAnalysis | null,
  opts: Pick<AutoSliceOptions, 'maxHeight'>,
): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const blockers = analysis?.blockers ?? []
  layout.rows.forEach((row, rowIndex) => {
    const top = rowTop(layout, rowIndex)
    const h = row.bottom - top
    if (rowIndex < layout.rows.length - 1) {
      const hit = blockers.filter((b) => crossesY(b, row.bottom))
      if (hit.length) {
        issues.push({
          severity: hit.some((b) => HARD_KINDS.has(b.kind)) ? 'error' : 'warning',
          rowIndex,
          cut: 'row',
          message: `Cut at y=${row.bottom} goes through ${describe(hit)}`,
        })
      }
    }
    row.colCuts.forEach((x, colIndex) => {
      const hit = blockers.filter((b) => crossesX(b, x, top, row.bottom))
      if (hit.length) {
        issues.push({
          severity: hit.some((b) => HARD_KINDS.has(b.kind)) ? 'error' : 'warning',
          rowIndex,
          colIndex,
          cut: 'col',
          message: `Column cut at x=${x} goes through ${describe(hit)}`,
        })
      }
    })
    if (h > opts.maxHeight * 1.5) {
      issues.push({ severity: 'warning', rowIndex, cut: 'size', message: `Row ${rowIndex + 1} is ${h}px tall` })
    }
    if (h < 4) issues.push({ severity: 'warning', rowIndex, cut: 'size', message: `Row ${rowIndex + 1} is only ${h}px tall` })
  })
  return issues
}
