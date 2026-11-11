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

import {
  accruingChannels,
  addFeeEntry,
  breakEvenDays,
  channelTotals,
  cohortRate,
  contractRows,
  contractStart,
  costParts,
  giftShare,
  monthFees,
  newAccountShare,
  organicLift,
  preFeeChannels,
  resolveFeeEntries,
  revenuePerPayer,
  roiMuted,
  sinceFeeShare,
  worstPaidChannel,
} from '../components/channels-analysis'
import { channelEconomics } from '../lib'
import type { ChannelRow } from '../types'

const DAY = 86400

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
  it('takes the fee at the exchange rate and gifts at ¥1 a quota dollar, leaving a paid channel’s commission out', () => {
    expect(channelEconomics(row, 7)).toEqual({
      fee: 3500,
      commission: 0,
      net: 6000 - 3500 - 200,
      roi: (6000 - 3500 - 200) / 3500,
      cac: 350,
    })
  })

  it('charges commission to a channel without a fee, which has no ROI or fee per payer', () => {
    const free = channelEconomics({ ...row, fee_usd: 0 }, 7)
    expect(free.commission).toBe(100)
    expect(free.net).toBe(5700)
    expect(free.roi).toBeNull()
    expect(free.cac).toBeNull()
    expect(channelEconomics({ ...row, new_payers: 0 }, 7).cac).toBeNull()
  })
})

const organic: ChannelRow = {
  ...row,
  segment: 'organic',
  channel: { user_id: 0, username: '' },
  registered: 100,
  activated: 20,
  paid: 4,
  fee_usd: 0,
}

describe('channel analysis', () => {
  it('names the largest cost part, gifts at ¥1 a quota dollar and the fee at the rate', () => {
    expect(costParts(row, 7)).toEqual({
      fee: 3500,
      commission: 0,
      gift: 200,
      main: 'fee',
    })
    expect(costParts({ ...row, gift_consumption_usd: 4000 }, 7).main).toBe(
      'gift'
    )
    expect(
      costParts({ ...row, fee_usd: 0, gift_consumption_usd: 0 }, 7)
    ).toEqual({ fee: 0, commission: 100, gift: 0, main: 'commission' })
  })

  it('totals only the paid channels and picks the one with the lowest net', () => {
    const losing = {
      ...row,
      channel: { user_id: 7, username: 'loser' },
      revenue: 100,
    }
    expect(channelTotals([row, losing, organic], 7)).toEqual({
      fee: 7000,
      revenue: 6100,
      net: 2300 + (100 - 3500 - 200),
      gift: 400,
      newPayers: 20,
    })
    expect(worstPaidChannel([row, losing, organic], 7)).toBe(losing)
    expect(worstPaidChannel([organic], 7)).toBeUndefined()
  })

  it('reads gift share, revenue per payer and the new accounts’ share', () => {
    expect(giftShare(row)).toBeCloseTo(200 / 3000)
    expect(giftShare({ ...row, consumption_usd: 0 })).toBeNull()
    expect(revenuePerPayer(row)).toBe(150)
    expect(revenuePerPayer({ ...row, payers: 0 })).toBeNull()
    expect(newAccountShare(row)).toBeNull()
    expect(newAccountShare({ ...row, revenue_new_accounts: 1500 })).toBe(0.25)
  })

  it('lifts against organic only when both cohorts reach the minimum', () => {
    // Channel: 20/50 active, 8/50 paid; organic: 20/100, 4/100.
    expect(organicLift(row, organic)).toEqual({ activated: 2, paid: 4 })
    expect(organicLift({ ...row, registered: 19 }, organic)).toEqual({
      activated: null,
      paid: null,
    })
    expect(organicLift(row, { ...organic, registered: 10 }).paid).toBeNull()
    expect(organicLift(row, { ...organic, paid: 0 }).paid).toBeNull()
    expect(organicLift(row, undefined).activated).toBeNull()
    expect(cohortRate(5, 19)).toBeNull()
    expect(cohortRate(5, 20)).toBe(0.25)
  })

  it('mutes ROI on a short range or too few new payers', () => {
    expect(roiMuted(1, 10)).toBe('short')
    expect(roiMuted(7, 2)).toBe('few')
    expect(roiMuted(7, 3)).toBeNull()
    expect(roiMuted(undefined, 3)).toBeNull()
  })

  it('starts the contract read at the earliest fee, clamped to 366 days', () => {
    const end = 1_000 * DAY
    const cost = (user_id: number, start: number) => ({
      user_id,
      monthly_usd: 100,
      start,
      end: 0,
      note: '',
    })
    expect(contractStart([], end)).toBeNull()
    expect(contractStart([cost(1, 900 * DAY), cost(2, 950 * DAY)], end)).toBe(
      900 * DAY
    )
    expect(contractStart([cost(1, 100 * DAY)], end)).toBe(end - 366 * DAY)
    expect(
      contractStart([{ ...cost(1, 900 * DAY), monthly_usd: 0 }], end)
    ).toBeNull()
  })

  it('reads each paid channel since its own fee started, with days to break even', () => {
    const end = 100 * DAY
    const costs = [
      { user_id: 306, monthly_usd: 500, start: 40 * DAY, end: 0, note: '' },
      { user_id: 7, monthly_usd: 300, start: 70 * DAY, end: 0, note: '' },
    ]
    const late = {
      ...row,
      channel: { user_id: 7, username: 'late' },
      fee_usd: 300,
      revenue: 1000,
    }
    const rows = contractRows([row, late, organic], costs, 7, 40 * DAY, end)
    expect(rows.map((item) => item.row.channel.user_id)).toEqual([7, 306])
    // late: 1000 - 2100 - 200 = -1300 over 60 read days: falling, no date.
    expect(rows[0]).toMatchObject({
      start: 70 * DAY,
      days: 30,
      net: -1300,
      paidBack: false,
      breakEvenDays: null,
      preContractDays: 30,
    })
    expect(rows[1]).toMatchObject({
      net: 2300,
      paidBack: true,
      breakEvenDays: 0,
      preContractDays: 0,
    })
    // At a current daily net of +100, -1300 is 13 days away.
    const climbing = contractRows([late], costs, 7, 40 * DAY, end, () => 100)
    expect(climbing[0].breakEvenDays).toBe(13)
    expect(breakEvenDays(-50, 0)).toBeNull()
  })

  it('accrues this month’s fees a thirtieth a day and sums the fees running now', () => {
    const monthStart = 300 * DAY
    const now = monthStart + 10 * DAY
    expect(
      monthFees(
        [
          { user_id: 1, monthly_usd: 300, start: 0, end: 0, note: '' },
          {
            user_id: 2,
            monthly_usd: 600,
            start: 0,
            end: monthStart + 5 * DAY,
            note: '',
          },
          {
            user_id: 3,
            monthly_usd: 90,
            start: now + DAY,
            end: 0,
            note: '',
          },
        ],
        monthStart,
        now
      )
    ).toEqual({ accrued: 100 + 100, monthly: 300 })
  })

  it('ends an entry where the channel’s next one starts, so overlapping fees do not add up', () => {
    const monthStart = 300 * DAY
    const now = monthStart + 10 * DAY
    const costs = [
      { user_id: 1, monthly_usd: 1000, start: 0, end: 0, note: 'old' },
      {
        user_id: 1,
        monthly_usd: 600,
        start: monthStart + 4 * DAY,
        end: 0,
        note: 'new',
      },
      { user_id: 2, monthly_usd: 300, start: 0, end: 0, note: '' },
    ]
    expect(resolveFeeEntries(costs)).toEqual([
      { ...costs[0], end: monthStart + 4 * DAY },
      costs[1],
      costs[2],
    ])
    // 1000 for 4 days, 600 for 6, 300 for 10.
    const fees = monthFees(costs, monthStart, now)
    expect(fees.accrued).toBeCloseTo((1000 * 4 + 600 * 6 + 300 * 10) / 30, 6)
    expect(fees.monthly).toBe(900)
  })

  it('closes the channel’s running entry when a new one is added', () => {
    const running = {
      user_id: 1,
      monthly_usd: 1000,
      start: 0,
      end: 0,
      note: '',
    }
    const ended = { user_id: 1, monthly_usd: 500, start: 0, end: DAY, note: '' }
    const other = { user_id: 2, monthly_usd: 300, start: 0, end: 0, note: '' }
    const entry = {
      user_id: 1,
      monthly_usd: 600,
      start: 10 * DAY,
      end: 0,
      note: '',
    }
    expect(addFeeEntry([running, ended, other], entry)).toEqual({
      costs: [{ ...running, end: 10 * DAY }, ended, other, entry],
      closed: 1,
    })
  })

  it('lists fee channels still credited commission, largest first, and none from an old server', () => {
    const a = { ...row, commission_accruing: 30 }
    const b = {
      ...row,
      channel: { user_id: 7, username: 'b' },
      commission_accruing: 80,
    }
    const none = { ...row, channel: { user_id: 8, username: 'c' } }
    expect(accruingChannels([a, b, none])).toEqual([b, a])
    expect(accruingChannels([row])).toEqual([])
  })

  it('flags fees that began after the range started, and reads revenue since the fee', () => {
    const late = { ...row, fee_start: 20 * DAY, revenue_since_fee: 1500 }
    const early = {
      ...row,
      channel: { user_id: 7, username: 'b' },
      fee_start: 5 * DAY,
    }
    expect(preFeeChannels([late, early], 10 * DAY)).toEqual([late])
    expect(preFeeChannels([row], 10 * DAY)).toEqual([])
    expect(sinceFeeShare(late)).toBe(0.25)
    expect(sinceFeeShare(row)).toBeNull()
    expect(sinceFeeShare({ ...late, fee_start: 0 })).toBeNull()
  })
})
