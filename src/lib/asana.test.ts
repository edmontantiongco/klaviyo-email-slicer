import { describe, expect, it } from 'vitest'
import { campaignRegion, emailDate } from './asana'

describe('emailDate', () => {
  it('reads the date from the email name, else the campaign name', () => {
    expect(emailDate('MS-03 · Nov 6: RC Email | The Black Friday Sale')).toBe('Nov 6')
    expect(emailDate('November 06 Outlet')).toBe('Nov 6')
    expect(emailDate('Flash sale hero', 'Black Friday Flash Sale 1106 - White Footer (US&ROW)')).toBe('Nov 6')
    expect(emailDate('Flash sale hero', 'Black Friday Sale 80 - White Footer (CA)')).toBeNull()
  })
})

describe('campaignRegion', () => {
  it('reads US / CA from the campaign name', () => {
    expect(campaignRegion('Black Friday Flash Sale 1104 - White Footer (CA)')).toBe('CA')
    expect(campaignRegion('Black Friday Flash Sale 1106 - White Footer (US&ROW)')).toBe('US')
    expect(campaignRegion('Black Friday Flash Sale 1106')).toBeNull()
  })
})
