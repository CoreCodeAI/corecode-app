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
import { describe, expect, test } from 'vitest'

import { PAYMENT_TYPES } from '../constants'
import {
  dispatchSelectedPayment,
  isStripePayment,
  isWaffoPayment,
  isWaffoPancakePayment,
} from './payment'

describe('payment type classification', () => {
  test('keeps Waffo and Waffo Pancake on their dedicated flows', () => {
    expect(isWaffoPayment(PAYMENT_TYPES.WAFFO)).toBe(true)
    expect(isWaffoPayment(PAYMENT_TYPES.WAFFO_PANCAKE)).toBe(false)
    expect(isWaffoPancakePayment(PAYMENT_TYPES.WAFFO_PANCAKE)).toBe(true)
    expect(isWaffoPancakePayment(PAYMENT_TYPES.WAFFO)).toBe(false)
    expect(isStripePayment(PAYMENT_TYPES.STRIPE)).toBe(true)
  })

  test('sends every Stripe method through Stripe Checkout', () => {
    expect(isStripePayment(PAYMENT_TYPES.STRIPE_CARD)).toBe(true)
    expect(isStripePayment(PAYMENT_TYPES.STRIPE_WECHAT_PAY)).toBe(true)
    expect(isStripePayment(PAYMENT_TYPES.STRIPE_ALIPAY)).toBe(true)
    expect(isStripePayment(PAYMENT_TYPES.WECHAT)).toBe(false)
    expect(isStripePayment(PAYMENT_TYPES.ALIPAY)).toBe(false)
    expect(isStripePayment(undefined)).toBe(false)
  })
})

describe('payment dispatch', () => {
  test('keeps the selected Waffo method index through confirmation', async () => {
    const calls: string[] = []
    const success = await dispatchSelectedPayment(
      { name: 'Waffo Card', type: PAYMENT_TYPES.WAFFO },
      120,
      3,
      {
        regular: async () => {
          calls.push('regular')
          return false
        },
        waffo: async (amount, index) => {
          calls.push(`waffo:${amount}:${index}`)
          return true
        },
        waffoPancake: async () => {
          calls.push('pancake')
          return false
        },
        nowPayments: async () => {
          calls.push('nowpayments')
          return false
        },
      }
    )

    expect(success).toBe(true)
    expect(calls).toEqual(['waffo:120:3'])
  })

  test('does not create a Waffo order without a selected method index', async () => {
    let called = false
    const success = await dispatchSelectedPayment(
      { name: 'Waffo Card', type: PAYMENT_TYPES.WAFFO },
      120,
      null,
      {
        regular: async () => false,
        waffo: async () => {
          called = true
          return true
        },
        waffoPancake: async () => false,
        nowPayments: async () => false,
      }
    )

    expect(success).toBe(false)
    expect(called).toBe(false)
  })

  test('opens a NOWPayments invoice only for the chosen network', async () => {
    const calls: string[] = []
    const processors = {
      regular: async () => {
        calls.push('regular')
        return false
      },
      waffo: async () => false,
      waffoPancake: async () => false,
      nowPayments: async (amount: number, payCurrency: string) => {
        calls.push(`nowpayments:${amount}:${payCurrency}`)
        return true
      },
    }
    const method = { name: 'USDT / USDC', type: PAYMENT_TYPES.NOWPAYMENTS }

    expect(
      await dispatchSelectedPayment(method, 100, null, processors, null)
    ).toBe(false)
    expect(
      await dispatchSelectedPayment(method, 100, null, processors, 'usdttrc20')
    ).toBe(true)
    expect(calls).toEqual(['nowpayments:100:usdttrc20'])
  })
})
