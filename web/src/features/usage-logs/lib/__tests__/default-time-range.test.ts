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

import { isDefaultTimeRange } from '../default-time-range'
import { getDefaultTimeRange } from '../utils'

const now = new Date(2026, 10, 11, 15, 30, 0)
const midnight = new Date(2026, 10, 11, 0, 0, 0, 0)

describe('isDefaultTimeRange', () => {
  test('accepts the range getDefaultTimeRange returns', () => {
    const range = getDefaultTimeRange()
    expect(isDefaultTimeRange(range.start, range.end)).toBe(true)
  })

  test('accepts the default taken a few minutes earlier', () => {
    const end = new Date(now.getTime() + 50 * 60 * 1000)
    expect(isDefaultTimeRange(midnight, end, now)).toBe(true)
  })

  test('accepts the Today preset, which ends at the end of the day', () => {
    const end = new Date(2026, 10, 11, 23, 59, 59, 999)
    expect(isDefaultTimeRange(midnight, end, now)).toBe(true)
  })

  test('rejects a range that starts on an earlier day', () => {
    const start = new Date(2026, 10, 5, 0, 0, 0, 0)
    const end = new Date(2026, 10, 11, 23, 59, 59, 999)
    expect(isDefaultTimeRange(start, end, now)).toBe(false)
  })

  test('rejects a range that ends before the present', () => {
    const end = new Date(2026, 10, 11, 12, 0, 0)
    expect(isDefaultTimeRange(midnight, end, now)).toBe(false)
  })

  test('rejects a range that ends on a later day', () => {
    const end = new Date(2026, 10, 12, 23, 59, 59, 999)
    expect(isDefaultTimeRange(midnight, end, now)).toBe(false)
  })

  test('rejects a missing bound', () => {
    expect(isDefaultTimeRange(midnight, undefined, now)).toBe(false)
  })
})
