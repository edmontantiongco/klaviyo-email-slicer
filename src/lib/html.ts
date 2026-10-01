import { getSlices } from './slicing'
import type { Slice, SliceLayout } from './slicing'

export interface HtmlOptions {
  title: string
  /** Display width of the email in CSS px (Klaviyo default 600). */
  contentWidth: number
  background: string
  preheader?: string
  /** Append a Klaviyo-compliant footer (unsubscribe + org address). */
  footer: boolean
  footerHtml: string
  /** Resolve the <img src> for a slice (Klaviyo URL, blob URL or relative file). */
  srcFor: (slice: Slice) => string
}

export const DEFAULT_FOOTER_HTML =
  '{% unsubscribe %} &nbsp;·&nbsp; {{ organization.name }}, {{ organization.full_address }}'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Don't escape Klaviyo template tags ({% … %} / {{ … }}) inside hrefs. */
const escHref = (s: string) =>
  s
    .split(/({%[^%]*%}|{{[^}]*}})/g)
    .map((part, i) => (i % 2 ? part : esc(part)))
    .join('')

function textColorFor(bg: string): string {
  const m = bg.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return '#666666'
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.5 ? '#666666' : '#bbbbbb'
}

/** Integer display widths for a row's cells that add up exactly to contentWidth. */
function displayWidths(slices: Slice[], imageWidth: number, contentWidth: number): number[] {
  const raw = slices.map((s) => (s.width * contentWidth) / imageWidth)
  const out = raw.map(Math.floor)
  let rest = contentWidth - out.reduce((a, b) => a + b, 0)
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac)
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k].i]++
  return out
}

function imgTag(s: Slice, width: number, height: number, src: string): string {
  const img = `<img src="${esc(src)}" width="${width}" height="${height}" alt="${esc(s.meta.alt)}" class="es-img" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;" />`
  return s.meta.link.trim()
    ? `<a href="${escHref(s.meta.link.trim())}" target="_blank" style="display:block;text-decoration:none;">${img}</a>`
    : img
}

/** Table rows (no <html> wrapper) – paste into a Klaviyo HTML block or an existing template. */
export function buildEmailRows(layout: SliceLayout, o: HtmlOptions): string {
  const slices = getSlices(layout)
  const lines: string[] = []
  layout.rows.forEach((_, rowIndex) => {
    const cells = slices.filter((s) => s.rowIndex === rowIndex)
    const widths = displayWidths(cells, layout.width, o.contentWidth)
    const heights = cells.map((s, i) => Math.round((s.height * widths[i]) / s.width))
    const td = 'padding:0;margin:0;line-height:0;font-size:0;mso-line-height-rule:exactly;'
    if (cells.length === 1) {
      lines.push(`<tr><td style="${td}">${imgTag(cells[0], widths[0], heights[0], o.srcFor(cells[0]))}</td></tr>`)
    } else {
      const tds = cells
        .map(
          (s, i) =>
            `<td width="${widths[i]}" valign="top" style="${td}width:${((widths[i] / o.contentWidth) * 100).toFixed(4)}%;">${imgTag(s, widths[i], heights[i], o.srcFor(s))}</td>`,
        )
        .join('')
      lines.push(
        `<tr><td style="${td}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${tds}</tr></table></td></tr>`,
      )
    }
  })
  if (o.footer) {
    lines.push(
      `<tr><td style="padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${textColorFor(o.background)};text-align:center;">${o.footerHtml}</td></tr>`,
    )
  }
  return lines.join('\n')
}

export function buildEmailHtml(layout: SliceLayout, o: HtmlOptions): string {
  const rows = buildEmailRows(layout, o)
    .split('\n')
    .map((l) => `          ${l}`)
    .join('\n')
  const pre = o.preheader?.trim()
    ? `\n    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${o.background};">${esc(o.preheader.trim())}</div>`
    : ''
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
    <title>${esc(o.title)}</title>
    <!--[if mso]><style>table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}</style><![endif]-->
    <style>
      body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
      img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; display:block; }
      table { border-collapse:collapse; }
      @media only screen and (max-width:${o.contentWidth + 20}px) {
        .es-container { width:100% !important; max-width:100% !important; }
        .es-img { width:100% !important; height:auto !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${o.background};">${pre}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${o.background};">
      <tr>
        <td align="center" style="padding:0;">
          <table role="presentation" class="es-container" width="${o.contentWidth}" cellpadding="0" cellspacing="0" border="0" style="width:${o.contentWidth}px;max-width:${o.contentWidth}px;">
${rows}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`
}
