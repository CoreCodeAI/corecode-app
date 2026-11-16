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
  ttftMovement,
  ttftValue,
  ttftVendorsShown,
} from '../ttft-trend-analysis'
import type { TTFTPoint, TTFTSeries } from '../types'

const DAY = 86400
const day = (offset: number) => 1761408000 + offset * DAY

function point(
  offset: number,
  requests: number,
  p50: number,
  p95: number
): TTFTPoint {
  return { start: day(offset), requests, ttft_p50_ms: p50, ttft_p95_ms: p95 }
}

describe('first-token delay series', () => {
  it('leaves a point under its floor as a gap, not a zero: 100 streamed requests for a day, 20 for an hour', () => {
    expect(ttftValue(point(0, 99, 10, 900), 'p95', false)).toBeNull()
    expect(ttftValue(point(0, 100, 10, 900), 'p95', false)).toBe(900)
    expect(ttftValue(point(0, 19, 10, 900), 'p50', true)).toBeNull()
    expect(ttftValue(point(0, 20, 10, 900), 'p50', true)).toBe(10)
  })

  it('draws a line only for a vendor with enough streamed requests in the range, most requests first', () => {
    const series: TTFTSeries[] = [
      { vendor: 'small', daily: [point(0, 60, 1, 2), point(1, 39, 1, 2)] },
      { vendor: 'b', daily: [point(0, 80, 1, 2), point(1, 80, 1, 2)] },
      { vendor: 'a', daily: [point(0, 100, 1, 2)] },
    ]
    expect(ttftVendorsShown(series).map((vendor) => vendor.vendor)).toEqual([
      'b',
      'a',
    ])
  })

  it('names the vendor whose percentile moved most between its first and last whole points', () => {
    const series: TTFTSeries[] = [
      {
        vendor: 'GPT',
        daily: [
          point(0, 200, 100, 1000),
          point(1, 200, 100, 4000),
          point(2, 200, 100, 18000),
        ],
      },
      {
        vendor: 'Claude',
        daily: [point(0, 200, 100, 500), point(1, 200, 100, 600)],
      },
    ]
    const moved = ttftMovement(
      series,
      'p95',
      false,
      (start) => start === day(2)
    )
    expect(moved).toMatchObject({ vendor: 'GPT', from: 1000, to: 4000 })
  })
})
