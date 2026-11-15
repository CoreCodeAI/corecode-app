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
  financeMargins,
  groupMarginExtremes,
  groupMargins,
  marginTone,
} from '../finance-analysis'
import type { FinanceInsights, GroupAllocation } from '../types'

const DAY = 86400

// A 30-day range with two Pro accounts on claude: $20 each a month, so $40 a
// month, which at 7 yuan a dollar is 280 for the range.
function data(allocations: GroupAllocation[] | undefined): FinanceInsights {
  return {
    start_time: 0,
    end_time: 30 * DAY,
    vendor_revenue: [
      { vendor: 'claude', customer_usd: 0, share: 0, recognized_revenue: 480 },
      { vendor: 'codex', customer_usd: 0, share: 0, recognized_revenue: 20 },
    ],
    plan_accounts: [
      {
        vendor: 'claude',
        plan: 'Pro',
        tier: 'default_claude_ai',
        accounts: 2,
        eligible: 2,
      },
    ],
    vendor_upstream: [
      {
        vendor: 'codex',
        bill_usd: 10,
        fee_usd: 2,
        costed_revenue_usd: 80,
        uncosted_revenue_usd: 0,
        oldest_bill_at: 0,
        channels: [3],
      },
    ],
    upstream_unattributed_bill_usd: 0,
    upstream_unattributed_fee_usd: 0,
    group_allocations: allocations,
  } as unknown as FinanceInsights
}

const ALLOCATIONS: GroupAllocation[] = [
  {
    group: 'GPT 福利',
    kind: 'group',
    recognized_revenue: 80,
    bill_usd: 10,
    fee_usd: 2,
    pool_share: { claude: 0.25 },
  },
  {
    group: 'Claude 满血',
    kind: 'group',
    recognized_revenue: 400,
    bill_usd: 0,
    fee_usd: 0,
    pool_share: { claude: 0.75 },
  },
  {
    group: '',
    kind: 'staff',
    recognized_revenue: 0,
    bill_usd: 0,
    fee_usd: 0,
    pool_share: {},
  },
  {
    group: '',
    kind: 'unattributed',
    recognized_revenue: 20,
    bill_usd: 0,
    fee_usd: 0,
    pool_share: {},
  },
  {
    group: '',
    kind: 'unattributed',
    recognized_revenue: 0,
    bill_usd: 0,
    fee_usd: 0,
    pool_share: { grok: 1 },
  },
]

describe('groupMargins', () => {
  it('shares the pool, bills and fees by fraction, a fee at the rate', () => {
    const rows = groupMargins(data(ALLOCATIONS), 7)
    expect(rows).toEqual([
      {
        group: 'Claude 满血',
        kind: 'group',
        revenue: 400,
        cost: 210,
        margin: 190,
        marginRate: 190 / 400,
      },
      {
        group: 'GPT 福利',
        kind: 'group',
        revenue: 80,
        cost: 94,
        margin: -14,
        marginRate: -14 / 80,
      },
      {
        group: '',
        kind: 'staff',
        revenue: 0,
        cost: 0,
        margin: 0,
        marginRate: null,
      },
      {
        group: '',
        kind: 'unattributed',
        revenue: 20,
        cost: 0,
        margin: 20,
        marginRate: 1,
      },
    ])
  })

  it('adds up to the finance margins: cost and revenue', () => {
    const finance = data(ALLOCATIONS)
    const margins = financeMargins(finance, 7)
    const rows = groupMargins(finance, 7) ?? []
    const cost = rows.reduce((sum, row) => sum + row.cost, 0)
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
    expect(cost).toBeCloseTo(margins.cost, 9)
    expect(revenue).toBeCloseTo(margins.revenue, 9)
  })

  it('is null on a server that sends no allocations', () => {
    expect(groupMargins(data(undefined), 7)).toBeNull()
  })

  it('leaves out an unattributed row with neither revenue nor cost', () => {
    const rows = groupMargins(data(ALLOCATIONS), 7) ?? []
    expect(rows.filter((row) => row.kind === 'unattributed')).toHaveLength(1)
  })

  it('names the best and worst customer groups by margin rate', () => {
    const rows = groupMargins(data(ALLOCATIONS), 7) ?? []
    const extremes = groupMarginExtremes(rows)
    expect(extremes?.best.group).toBe('Claude 满血')
    expect(extremes?.worst.group).toBe('GPT 福利')
  })

  it('names none with one group or fewer', () => {
    const rows = groupMargins(data(ALLOCATIONS.slice(0, 1)), 7) ?? []
    expect(groupMarginExtremes(rows)).toBeNull()
  })

  it('colours a margin as the vendor table does', () => {
    expect(marginTone(-14, 80)).toBe('danger')
    expect(marginTone(10, 100)).toBe('warning')
    expect(marginTone(190, 400)).toBe('good')
  })
})
