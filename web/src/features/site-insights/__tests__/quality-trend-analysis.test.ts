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
  vendorFailureLines,
  worstVendorLine,
  VENDOR_LINE_SAMPLE,
  VENDOR_POINT_SAMPLE,
} from '../quality-trend-analysis'
import type { VendorTrend } from '../types'

const DAY = 86400
const day = (offset: number) => 1761408000 + offset * DAY
const days = [0, 1, 2].map(day)

function trend(
  vendor: string,
  points: [number, number, number][]
): VendorTrend {
  return {
    vendor,
    daily: points.map(([offset, requests, errors]) => ({
      start: day(offset),
      requests,
      errors,
    })),
  }
}

describe('vendor failure lines', () => {
  it('draws a rate per day, with a gap where the vendor had too few requests', () => {
    const [claude] = vendorFailureLines(
      [
        trend('claude', [
          [0, 200, 10],
          [1, VENDOR_POINT_SAMPLE - 1, 5],
          [2, 100, 0],
        ]),
      ],
      days,
      false
    )
    expect(claude.rates).toEqual([0.05, null, 0])
    expect(claude.counts[1]).toEqual({
      requests: VENDOR_POINT_SAMPLE - 1,
      errors: 5,
    })
  })

  it('treats a day the vendor has no point for as a gap with zero counts', () => {
    const [claude] = vendorFailureLines(
      [
        trend('claude', [
          [0, 150, 3],
          [2, 150, 6],
        ]),
      ],
      days,
      false
    )
    expect(claude.rates).toEqual([0.02, null, 0.04])
    expect(claude.counts[1]).toEqual({ requests: 0, errors: 0 })
  })

  it('leaves out a vendor under the range sample and keeps the usual vendor order', () => {
    const lines = vendorFailureLines(
      [
        trend('gemini', [
          [0, 60, 1],
          [1, 60, 1],
        ]),
        trend('small', [[0, VENDOR_LINE_SAMPLE - 1, 0]]),
        trend('claude', [
          [0, 100, 1],
          [1, 100, 1],
        ]),
        trend('codex', [
          [0, 100, 1],
          [1, 100, 1],
        ]),
      ],
      days,
      false
    )
    expect(lines.map((line) => line.vendor)).toEqual([
      'claude',
      'codex',
      'gemini',
    ])
  })

  it('reads the hourly points when the range shows hours', () => {
    const hour = 1761408000
    const [claude] = vendorFailureLines(
      [
        {
          vendor: 'claude',
          daily: [],
          hourly: [
            { start: hour, requests: 120, errors: 12 },
            { start: hour + 3600, requests: 120, errors: 0 },
          ],
        },
      ],
      [hour, hour + 3600],
      true
    )
    expect(claude.rates).toEqual([0.1, 0])
  })

  it('has no lines for a server without the series', () => {
    expect(vendorFailureLines(null, days, false)).toEqual([])
    expect(vendorFailureLines(undefined, days, false)).toEqual([])
  })

  it('names the vendor that failed the largest share, and none when nothing failed', () => {
    const lines = vendorFailureLines(
      [
        trend('claude', [
          [0, 200, 2],
          [1, 200, 2],
        ]),
        trend('codex', [
          [0, 200, 20],
          [1, 200, 20],
        ]),
      ],
      days,
      false
    )
    expect(worstVendorLine(lines)?.vendor).toBe('codex')
    const calm = vendorFailureLines(
      [
        trend('claude', [
          [0, 200, 0],
          [1, 200, 0],
        ]),
      ],
      days,
      false
    )
    expect(worstVendorLine(calm)).toBeUndefined()
  })
})
