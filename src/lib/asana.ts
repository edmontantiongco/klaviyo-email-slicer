export type Region = 'US' | 'CA'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The email's send date as Asana task names write it ("Nov 6"): from the email's name
 * ("MS-03 · Nov 6: RC Email | …"), else from the Klaviyo campaign name ("Flash Sale 1106 - …").
 */
export function emailDate(emailName: string, campaignName = ''): string | null {
  const named = emailName.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+0?(\d{1,2})\b/i)
  if (named) return `${named[1][0].toUpperCase()}${named[1].slice(1, 3).toLowerCase()} ${Number(named[2])}`
  for (const [, mm, dd] of campaignName.matchAll(/\b(\d{2})(\d{2})\b/g)) {
    const m = Number(mm)
    const d = Number(dd)
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${MONTHS[m - 1]} ${d}`
  }
  return null
}

/** Which Asana link field a Klaviyo campaign belongs in, from its name: "… (CA)" or "… (US&ROW)". */
export function campaignRegion(campaignName: string): Region | null {
  if (/\bCA\b/.test(campaignName) || /canad/i.test(campaignName)) return 'CA'
  if (/\bUSA?\b/.test(campaignName)) return 'US'
  return null
}

/** A Klaviyo campaign's page, as stored in Asana. */
export const klaviyoCampaignUrl = (campaignId: string) => `https://www.klaviyo.com/campaign/${campaignId}/wizard`
