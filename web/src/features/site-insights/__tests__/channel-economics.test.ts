/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, it } from 'vitest'

import { channelEconomics } from '../lib'
import type { ChannelRow } from '../types'

const row: ChannelRow = {
  segment: 'channel',
  channel: { user_id: 306, username: 'magpie' },
  tier: 'retail',
  accounts: 345,
  registered: 50,
  activated: 20,
  paid: 8,
  repeat: 3,
  revenue: 6000,
  payers: 40,
  new_payers: 10,
  consumption_usd: 3000,
  gift_consumption_usd: 200,
  granted_usd: 500,
  gift_outstanding_usd: 300,
  commission_usd: 100,
  fee_usd: 500,
}

describe('channelEconomics', () => {
  it('takes the fee at the exchange rate, and commission and gifts at ¥1 a quota dollar', () => {
    expect(channelEconomics(row, 7)).toEqual({
      fee: 3500,
      net: 6000 - 3500 - 100 - 200,
      roi: (6000 - 3500 - 100 - 200) / 3500,
      cac: 350,
    })
  })

  it('has no ROI or fee per payer without a fee', () => {
    const free = channelEconomics({ ...row, fee_usd: 0 }, 7)
    expect(free.net).toBe(5700)
    expect(free.roi).toBeNull()
    expect(free.cac).toBeNull()
    expect(channelEconomics({ ...row, new_payers: 0 }, 7).cac).toBeNull()
  })
})
