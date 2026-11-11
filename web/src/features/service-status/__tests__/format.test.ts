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
  formatLatency,
  formatPeriod,
  formatRate,
  rateTone,
  stripSummary,
} from '../lib/format'

describe('formatRate', () => {
  it('reads 100% only when the rate rounds there', () => {
    expect(formatRate(0.9995, 'en-US')).toBe('100%')
    expect(formatRate(0.9994, 'en-US')).toBe('99.94%')
  })

  it('keeps one decimal below 99%', () => {
    expect(formatRate(0.873, 'en-US')).toBe('87.3%')
    expect(formatRate(0, 'en-US')).toBe('0.0%')
  })

  it('shows a dash for a missing rate', () => {
    expect(formatRate(null, 'en-US')).toBe('—')
    expect(formatRate(undefined, 'en-US')).toBe('—')
  })
})

describe('formatLatency', () => {
  it('uses milliseconds below a second and seconds above', () => {
    expect(formatLatency(963, 'en-US')).toBe('963 ms')
    expect(formatLatency(1359, 'en-US')).toBe('1.36 sec')
    expect(formatLatency(12_400, 'en-US')).toBe('12 sec')
  })

  it('shows a dash for no latency', () => {
    expect(formatLatency(null, 'en-US')).toBe('—')
    expect(formatLatency(0, 'en-US')).toBe('—')
  })
})

describe('rateTone', () => {
  it('splits at 95% and 50%', () => {
    expect(rateTone(0.95)).toBe('good')
    expect(rateTone(0.94)).toBe('warn')
    expect(rateTone(0.49)).toBe('bad')
    expect(rateTone(null)).toBe('none')
  })
})

describe('stripSummary', () => {
  it('weights each period by its requests', () => {
    expect(
      stripSummary([
        { requests: 100, success_rate: 1 },
        { requests: 300, success_rate: 0.9 },
        { requests: 0, success_rate: null },
      ])
    ).toEqual({ requests: 400, rate: 370 / 400 })
  })

  it('has no rate when nothing was requested', () => {
    expect(stripSummary([{ requests: 0, success_rate: null }])).toEqual({
      requests: 0,
      rate: null,
    })
  })
})

it('formats a period as a clock range', () => {
  const start = Date.UTC(2026, 10, 11, 6) / 1000
  const period = formatPeriod(start, 3600, 'en-US')
  expect(period).toMatch(/^\d{2}:00–\d{2}:00$/)
})
