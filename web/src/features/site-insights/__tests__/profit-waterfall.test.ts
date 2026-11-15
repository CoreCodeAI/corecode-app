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
  checkoutValue,
  financeMargins,
  orderFunnels,
  profitWaterfall,
} from '../finance-analysis'
import type { FinanceInsights, OrderMethodFunnel } from '../types'

// The 2026-11-15 range as the funds view reads it, in yuan: 38,655 earned,
// 3,813 of upstream bills, 2,577 of channel fees (US$ at 7), 3,082 of commission.
const RATE = 7
const codexBill = {
  vendor: 'codex',
  bill_usd: 3813,
  fee_usd: 0,
  costed_revenue_usd: 0,
  uncosted_revenue_usd: 0,
  oldest_bill_at: 0,
  channels: [],
}
const range = {
  start_time: 0,
  end_time: 7 * 86400,
  vendor_revenue: [
    {
      vendor: 'claude',
      customer_usd: 0,
      share: 0.6,
      recognized_revenue: 23193,
    },
    { vendor: 'codex', customer_usd: 0, share: 0.4, recognized_revenue: 15462 },
  ],
  plan_accounts: [],
  vendor_upstream: [codexBill],
  upstream_unattributed_bill_usd: 0,
  upstream_unattributed_fee_usd: 0,
  channel_fee_usd: 368.14,
  commission_usd: 3082,
} as unknown as FinanceInsights

function waterfallOf(data: FinanceInsights) {
  const margins = financeMargins(data, RATE)
  return { margins, waterfall: profitWaterfall(data, margins, RATE) }
}

describe('profitWaterfall', () => {
  it('reproduces the vendor panel gross margin after the first three steps', () => {
    const { margins, waterfall } = waterfallOf(range)
    expect(waterfall).toBeDefined()
    if (!waterfall) return
    expect(waterfall.revenue).toBe(margins.revenue)
    expect(waterfall.grossMargin).toBeCloseTo(margins.margin, 6)
    expect(waterfall.steps.map((step) => step.key)).toEqual([
      'accounts',
      'bills',
      'fees',
      'channels',
      'commission',
    ])
    const [accounts, bills, fees] = waterfall.steps
    expect(accounts.amount).toBe(0)
    expect(bills.amount).toBe(3813)
    expect(fees.amount).toBe(0)
  })

  it('leaves revenue less every step, which is the remainder', () => {
    const { waterfall } = waterfallOf(range)
    if (!waterfall) throw new Error('the waterfall is hidden')
    const costs = waterfall.steps.reduce((sum, step) => sum + step.amount, 0)
    expect(waterfall.left).toBeCloseTo(waterfall.revenue - costs, 6)
    expect(waterfall.left).toBeCloseTo(29183, 0)
  })

  it('takes the 2026-11-15 figures down to 90.1%, 83.5% and 75.5%', () => {
    const { waterfall } = waterfallOf(range)
    if (!waterfall) throw new Error('the waterfall is hidden')
    expect(waterfall.grossMargin / waterfall.revenue).toBeCloseTo(0.901, 3)
    expect((waterfall.grossMargin - 2577) / waterfall.revenue).toBeCloseTo(
      0.835,
      3
    )
    expect(waterfall.left / waterfall.revenue).toBeCloseTo(0.755, 3)
  })

  it('converts fees in US dollars at the rate and adds unattributed upstream cost', () => {
    const data = {
      ...range,
      vendor_upstream: [{ ...codexBill, fee_usd: 2 }],
      upstream_unattributed_bill_usd: 10,
      upstream_unattributed_fee_usd: 1,
    } as unknown as FinanceInsights
    const { margins, waterfall } = waterfallOf(data)
    if (!waterfall) throw new Error('the waterfall is hidden')
    expect(waterfall.steps[1].amount).toBe(3823)
    expect(waterfall.steps[2].amount).toBe(21)
    expect(waterfall.grossMargin).toBeCloseTo(margins.margin, 6)
  })

  it('is hidden on a server that does not send channel_fee_usd', () => {
    const older = { ...range, channel_fee_usd: undefined } as FinanceInsights
    const { waterfall } = waterfallOf(older)
    expect(waterfall).toBeUndefined()
  })
})

function funnel(overrides: Partial<OrderMethodFunnel>): OrderMethodFunnel {
  return {
    payment_method: 'stripe_card',
    created: 0,
    paid: 0,
    failed: 0,
    expired: 0,
    pending: 0,
    pending_stale: 0,
    plan_orders: 0,
    paid_money: 0,
    completion_rate: 0,
    ...overrides,
  }
}

describe('checkoutValue', () => {
  it('values the unpaid settled checkouts at the average paid amount', () => {
    const value = checkoutValue(
      funnel({ created: 46, paid: 6, failed: 10, expired: 30, paid_money: 600 })
    )
    expect(value.settled).toBe(46)
    expect(value.unpaid).toBe(40)
    expect(value.settledRate).toBeCloseTo(6 / 46)
    expect(value.averagePaid).toBe(100)
    expect(value.estimate).toBe(4000)
  })

  it('leaves out fresh pending checkouts, and counts refunds as settled but not unpaid', () => {
    // 5 of the 16 were refunded: paid once, so settled, but not unpaid.
    const value = checkoutValue(
      funnel({
        created: 16,
        paid: 2,
        failed: 3,
        refunded: 5,
        pending: 6,
        pending_stale: 2,
        paid_money: 200,
      })
    )
    expect(value.settled).toBe(12)
    expect(value.unpaid).toBe(3 + 2)
    expect(value.refunded).toBe(5)
    expect(value.estimate).toBe(500)
    // The refunded five went through: 7 of the 12 settled completed.
    expect(value.settledRate).toBeCloseTo(7 / 12)
  })

  it('reads a method whose payments were refunded as one that completes', () => {
    // Stripe cards on production, 2026-11-16: 58 opened, 6 paid, 35 paid and
    // refunded, 15 failed or expired, 2 pending past the hour.
    const value = checkoutValue(
      funnel({
        created: 58,
        paid: 6,
        refunded: 35,
        failed: 15,
        pending: 2,
        pending_stale: 2,
        paid_money: 340,
      })
    )
    expect(value.settledRate).toBeCloseTo(41 / 58)
    expect(value.unpaid).toBe(17)
  })

  it('takes a server that sends no refunds as having none', () => {
    const value = checkoutValue(funnel({ created: 10, paid: 4, failed: 6 }))
    expect(value.refunded).toBe(0)
    expect(value.settledRate).toBe(0.4)
  })

  it('has no average and no estimate when nothing paid', () => {
    const value = checkoutValue(funnel({ created: 12, failed: 12 }))
    expect(value.averagePaid).toBeNull()
    expect(value.estimate).toBeNull()
    expect(value.settledRate).toBe(0)
  })

  it('is attached to every funnel row', () => {
    const [row] = orderFunnels(
      [funnel({ created: 10, paid: 1, failed: 9, paid_money: 50 })],
      null
    )
    expect(row.estimate).toBe(450)
    expect(row.judged).toBe(true)
  })
})
