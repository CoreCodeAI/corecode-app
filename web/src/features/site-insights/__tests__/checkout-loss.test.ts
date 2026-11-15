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
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { checkoutLossFindings } from '../components/checkout-loss'
import type { InsightsFormat } from '../components/overview-analysis'
import type { OrderMethodFunnel } from '../types'

// Keys stand in for the translated text: these tests read the finding's
// threshold, identity and impact, not its wording.
const t = ((key: string) => key) as unknown as TFunction
const fmt = {
  num: (value: number) => String(value),
  pct: (value: number) => `${(value * 100).toFixed(1)}%`,
  cny: (value: number) => `¥${value.toFixed(0)}`,
} as unknown as InsightsFormat

function method(
  payment_method: string,
  paid: number,
  settled: number,
  paid_money: number
): OrderMethodFunnel {
  return {
    payment_method,
    created: settled,
    paid,
    failed: settled - paid,
    expired: 0,
    pending: 0,
    pending_stale: 0,
    plan_orders: 0,
    paid_money,
    completion_rate: paid / settled,
  }
}

describe('checkoutLossFindings', () => {
  it('names a method whose settled checkouts paid under half, at the sample floor', () => {
    const findings = checkoutLossFindings(t, fmt, [
      method('nowpayments', 4, 10, 400),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      key: 'finance-checkout-loss-nowpayments',
      tone: 'warning',
      tab: 'finance',
      section: 'checkouts',
      impact: 600,
    })
  })

  it('does not name a method that paid exactly half, or one under the sample floor', () => {
    expect(
      checkoutLossFindings(t, fmt, [method('alipay', 5, 10, 500)])
    ).toEqual([])
    expect(checkoutLossFindings(t, fmt, [method('alipay', 0, 9, 0)])).toEqual(
      []
    )
  })

  it('names a method with nothing paid, with no estimate to rank it by', () => {
    const findings = checkoutLossFindings(t, fmt, [method('wechat', 0, 12, 0)])
    expect(findings).toHaveLength(1)
    expect(findings[0].impact).toBe(0)
  })

  it('ranks by the unpaid estimate rather than by the rate', () => {
    // Lowest rate, smallest estimate: the rate order would put it first.
    const findings = checkoutLossFindings(t, fmt, [
      method('a', 1, 20, 500),
      method('b', 3, 20, 300),
      method('c', 2, 20, 100),
    ])
    expect(findings.map((finding) => finding.key)).toEqual([
      'finance-checkout-loss-a',
      'finance-checkout-loss-b',
      'finance-checkout-loss-c',
    ])
    expect(findings.map((finding) => finding.impact)).toEqual([9500, 1700, 900])
  })

  it('names nothing when no method completes under half', () => {
    expect(
      checkoutLossFindings(t, fmt, [method('stripe_alipay', 128, 190, 19451)])
    ).toEqual([])
    expect(checkoutLossFindings(t, fmt, undefined)).toEqual([])
  })
})
