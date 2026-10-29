/** Reading Asana task text: the email copy in a task's description, and which task is the email's. */

export type Region = 'US' | 'CA'

/** The task fields that hold each region's Klaviyo campaign link. */
export const LINK_FIELDS: Record<Region, string> = { US: 'Link (US)', CA: 'Link (CA)' }

const SUBJECT = /^\s*(?:email\s+)?subject(?:\s*line)?\s*[:\-–—]?\s*/i
const PREVIEW = /^\s*(?:preview(?:\s*text)?|pre-?header(?:\s*text)?)\s*[:\-–—]?\s*/i

/**
 * The subject line and preview text from a task description written as labelled lines, e.g.
 * "Subject line: …" / "Preview text: …". The label may be glued to the text (Asana keeps code-styled
 * labels that way) or on its own line with the text below. Unlabelled copy isn't guessed.
 */
export function findCopy(notes: string): { subject: string | null; previewText: string | null } {
  const lines = notes.split(/\r?\n/).map((l) => l.trim())
  const after = (label: RegExp, other: RegExp) => {
    const i = lines.findIndex((l) => label.test(l))
    if (i < 0) return null
    const rest = lines[i].replace(label, '').trim()
    if (rest) return rest
    const next = lines.slice(i + 1).find((l) => l)
    return next && !other.test(next) && !label.test(next) ? next : null
  }
  return { subject: after(SUBJECT, PREVIEW), previewText: after(PREVIEW, SUBJECT) }
}

/** The task gid in an Asana task link (either link format), or a bare gid. */
export function asanaTaskGid(input: string): string | null {
  const s = decodeURIComponent(input).trim()
  if (/^\d{6,}$/.test(s)) return s
  return s.match(/\/task\/(\d+)/)?.[1] ?? s.match(/app\.asana\.com\/0\/\d+\/(\d+)/)?.[1] ?? null
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])

/**
 * How well an Asana task name fits the email. `date` is the email's date as "Nov 6". The task must
 * start with that date ("Nov 6: RC Email | Flash Sale"); tasks that only mention it later — like the
 * "Email Implementation | Nov 6: …" subtask — are left out. Email tasks and shared words rank higher.
 */
export function scoreTask(taskName: string, date: string, emailName: string): number {
  const m = date.match(/^([a-z]{3})[a-z]*\.?\s+0?(\d{1,2})$/i)
  if (!m) return 0
  const starts = new RegExp(`^\\s*${m[1]}[a-z]*\\.?\\s+0?${m[2]}\\b`, 'i')
  if (!starts.test(taskName)) return 0
  let score = 10
  if (/\bemail\b/i.test(taskName)) score += 5
  const mine = words(emailName)
  for (const w of words(taskName)) if (mine.has(w)) score += 1
  return score
}
