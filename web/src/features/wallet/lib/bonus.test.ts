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
  bonusRateToPercent,
  calculateBonus,
  findBonusTier,
  findNextBonusTier,
  isBonusEligiblePayment,
} from './bonus'

const tiers = { 300: 0.05, 1000: 0.1, 2000: 0.15 }

describe('bonus tier selection', () => {
  test('picks the highest tier at or below the amount', () => {
    expect(findBonusTier(tiers, 300)?.rate).toBe(0.05)
    expect(findBonusTier(tiers, 999)?.rate).toBe(0.05)
    expect(findBonusTier(tiers, 1000)?.rate).toBe(0.1)
    expect(findBonusTier(tiers, 1200)).toEqual({ threshold: 1000, rate: 0.1 })
    expect(findBonusTier(tiers, 99999)?.rate).toBe(0.15)
  })

  test('gives nothing below the lowest tier', () => {
    expect(findBonusTier(tiers, 299)).toBeNull()
    expect(findBonusTier(tiers, 0)).toBeNull()
  })

  test('ignores empty, missing and unusable tiers', () => {
    expect(findBonusTier(undefined, 500)).toBeNull()
    expect(findBonusTier({}, 500)).toBeNull()
    expect(findBonusTier({ 100: 0, 200: -0.1, 0: 0.5 }, 500)).toBeNull()
  })

  test('computes the bonus in the amount unit', () => {
    expect(calculateBonus(tiers, 1000)).toBe(100)
    expect(calculateBonus(tiers, 1200)).toBeCloseTo(120)
    expect(calculateBonus(tiers, 100)).toBe(0)
  })

  test('finds the next tier above the amount', () => {
    expect(findNextBonusTier(tiers, 0)?.threshold).toBe(300)
    expect(findNextBonusTier(tiers, 300)?.threshold).toBe(1000)
    expect(findNextBonusTier(tiers, 2000)).toBeNull()
  })

  test('turns a fraction into a clean percent', () => {
    expect(bonusRateToPercent(0.07)).toBe(7)
    expect(bonusRateToPercent(0.125)).toBe(12.5)
  })
})

describe('bonus payment eligibility', () => {
  test('rewards methods priced like epay', () => {
    expect(isBonusEligiblePayment('alipay')).toBe(true)
    expect(isBonusEligiblePayment('wxpay')).toBe(true)
    expect(isBonusEligiblePayment(PAYMENT_TYPES.STRIPE)).toBe(true)
    expect(isBonusEligiblePayment(PAYMENT_TYPES.CREEM)).toBe(false)
    expect(isBonusEligiblePayment(PAYMENT_TYPES.WAFFO)).toBe(false)
    expect(isBonusEligiblePayment(PAYMENT_TYPES.WAFFO_PANCAKE)).toBe(false)
    expect(isBonusEligiblePayment(undefined)).toBe(false)
    expect(isBonusEligiblePayment('')).toBe(false)
  })
})
