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
  formatInvoiceAmount,
  invoiceTaxCents,
  invoiceTaxQuota,
} from '../lib/amount'

describe('invoiceTaxCents', () => {
  it.each([
    [10990, 4, 440], // 439.6 fen rounds up
    [990, 4, 40], // 39.6
    [5050, 4, 202],
    [1000, 1.15, 12], // 11.5 exactly, despite 1.15 not being exact in binary
    [12345, 0, 0],
  ])(
    'taxes %i fen at %s%% as %i fen, as the server rounds',
    (cents, rate, tax) => {
      expect(invoiceTaxCents(cents, rate)).toBe(tax)
    }
  )
})

describe('invoiceTaxQuota', () => {
  it('converts the tax to balance at the quota per yuan, rounding up', () => {
    expect(invoiceTaxQuota(440, 500000)).toBe(2200000)
    expect(invoiceTaxQuota(1, 333333)).toBe(3334)
    expect(invoiceTaxQuota(0, 500000)).toBe(0)
  })
})

describe('formatInvoiceAmount', () => {
  it('keeps two decimals, as an invoice states amounts', () => {
    expect(formatInvoiceAmount(10000, 'zh-CN')).toBe('¥100.00')
    expect(formatInvoiceAmount(202, 'zh-CN')).toBe('¥2.02')
  })
})
