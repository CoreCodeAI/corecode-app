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

import type { PricingModel } from '../../types'
import { formatYuan, getBaseUnitPrices } from '../unit-prices'

// Production's models on 2026-10-22.
const opus: PricingModel = {
  id: 1,
  model_name: 'claude-opus-5-5',
  quota_type: 0,
  model_ratio: 2,
  completion_ratio: 5,
  cache_ratio: 0.05,
  create_cache_ratio: 1.25,
  enable_groups: ['Claude 满血'],
  group_ratio: { 'Claude 满血': 1.5 },
}

const haiku: PricingModel = {
  ...opus,
  id: 2,
  model_name: 'claude-haiku-5-5',
  model_ratio: 0.05,
  cache_ratio: 0.1,
  create_cache_ratio: undefined,
  billing_mode: 'tiered_expr',
  billing_expr:
    'len <= 100000 ? tier("standard", p * 0.1 + c * 0.5 + cr * 0.01 + cc * 0.125 + cc1h * 0.2) : tier("long_context", p * 0.5 + c * 2.5 + cr * 0.05 + cc * 0.625 + cc1h * 1)',
}

describe('getBaseUnitPrices', () => {
  test('reads a ratio-priced model before its group ratio', () => {
    expect(getBaseUnitPrices(opus)).toEqual({
      prices: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
      tiered: false,
    })
  })

  test('reads the first tier of a context-priced model', () => {
    const base = getBaseUnitPrices(haiku)
    expect(base?.tiered).toBe(true)
    expect(base?.prices.input).toBeCloseTo(0.1)
    expect(base?.prices.output).toBeCloseTo(0.5)
    expect(base?.prices.cacheWrite).toBeCloseTo(0.125)
    expect(base?.prices.cacheRead).toBeCloseTo(0.01)
  })

  test('reads a model whose expression prices the 12-hour cache write', () => {
    // Production's gpt-6.1-terra on 2026-11-07.
    const base = getBaseUnitPrices({
      ...haiku,
      model_name: 'gpt-6.1-terra',
      billing_expr:
        'len <= 272000 ? tier("0_272k", p * 1 + cr * 0.05 + cc * 1.25 + cc12h * 2.5 + c * 5) : tier("272k_plus", p * 2 + cr * 0.1 + cc * 2.5 + cc12h * 5 + c * 7.5)',
    })
    expect(base?.tiered).toBe(true)
    expect(base?.prices.input).toBeCloseTo(1)
    expect(base?.prices.output).toBeCloseTo(5)
    expect(base?.prices.cacheWrite).toBeCloseTo(1.25)
    expect(base?.prices.cacheRead).toBeCloseTo(0.05)
  })

  test('marks a one-tier expression as not tiered', () => {
    // Production's gpt-6.1-sol on 2026-11-07: one price at every length.
    const base = getBaseUnitPrices({
      ...haiku,
      model_name: 'gpt-6.1-sol',
      billing_expr: 'tier("base", p * 2 + c * 10 + cr * 0.1)',
    })
    expect(base?.tiered).toBe(false)
    expect(base?.prices.input).toBeCloseTo(2)
    expect(base?.prices.output).toBeCloseTo(10)
    expect(base?.prices.cacheRead).toBeCloseTo(0.1)
  })

  test('has no token prices for a per-request model', () => {
    expect(getBaseUnitPrices({ ...opus, quota_type: 1 })).toBeNull()
  })
})

test('formatYuan trims trailing zeros', () => {
  expect(formatYuan(27.2)).toBe('¥27.2')
  expect(formatYuan(0.30000001)).toBe('¥0.3')
  expect(formatYuan(136)).toBe('¥136')
})
