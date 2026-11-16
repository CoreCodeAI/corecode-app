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
import { HOUR_SAMPLE, SMALL_SAMPLE } from './lib'
import type { TTFTPoint, TTFTSeries } from './types'

/** The percentile a line draws. */
export type TTFTPercentile = 'p50' | 'p95'

/** A vendor needs this many streamed requests in the range to have a line. */
export const TTFT_VENDOR_SAMPLE = SMALL_SAMPLE

/**
 * The value of a point's percentile in ms. A point with fewer streamed
 * requests than its granularity's floor is a gap: too few to read a percentile
 * from, not a zero.
 */
export function ttftValue(
  point: TTFTPoint,
  percentile: TTFTPercentile,
  hourly: boolean
): number | null {
  const floor = hourly ? HOUR_SAMPLE : SMALL_SAMPLE
  if (point.requests < floor) return null
  return percentile === 'p50' ? point.ttft_p50_ms : point.ttft_p95_ms
}

/** The vendors with a line: those with enough streamed requests in the range, by requests. */
export function ttftVendorsShown(series: TTFTSeries[]): TTFTSeries[] {
  return series
    .filter(
      (vendor) =>
        (vendor.daily ?? []).reduce((sum, point) => sum + point.requests, 0) >=
        TTFT_VENDOR_SAMPLE
    )
    .sort(
      (a, b) =>
        (b.daily ?? []).reduce((sum, point) => sum + point.requests, 0) -
          (a.daily ?? []).reduce((sum, point) => sum + point.requests, 0) ||
        a.vendor.localeCompare(b.vendor)
    )
}

/** The points a line is drawn from: the daily ones, or the hourly ones when the range shows hours. */
export function ttftPointsOf(vendor: TTFTSeries, hourly: boolean): TTFTPoint[] {
  return (hourly ? vendor.hourly : vendor.daily) ?? []
}

/**
 * The vendor whose percentile moved most between its first and last point
 * with a value, counting only points that are whole (not partial). Null when
 * no vendor has two such points.
 */
export function ttftMovement(
  series: TTFTSeries[],
  percentile: TTFTPercentile,
  hourly: boolean,
  isPartial: (start: number) => boolean
): {
  vendor: string
  from: number
  to: number
  start: number
  end: number
} | null {
  let best: {
    vendor: string
    from: number
    to: number
    start: number
    end: number
  } | null = null
  for (const vendor of series) {
    const values = ttftPointsOf(vendor, hourly)
      .filter((point) => hourly || !isPartial(point.start))
      .flatMap((point) => {
        const value = ttftValue(point, percentile, hourly)
        return value == null ? [] : [{ start: point.start, value }]
      })
    const first = values[0]
    const last = values.at(-1)
    if (values.length < 2 || !first || !last) continue
    const change = Math.abs(last.value - first.value)
    if (!best || change > Math.abs(best.to - best.from)) {
      best = {
        vendor: vendor.vendor,
        from: first.value,
        to: last.value,
        start: first.start,
        end: last.start,
      }
    }
  }
  return best
}
