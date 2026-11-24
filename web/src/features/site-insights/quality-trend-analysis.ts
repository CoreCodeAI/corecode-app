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
import { HOUR_SAMPLE, SMALL_SAMPLE, VENDOR_ORDER } from './lib'
import type { VendorTrend, VendorTrendPoint } from './types'

/** A vendor needs this many requests in the range to have a line of its own. */
export const VENDOR_LINE_SAMPLE = SMALL_SAMPLE

/**
 * A day or hour with fewer requests than this has no rate for the vendor: one
 * failure in three requests is not a failure rate, and the line breaks there.
 */
export const VENDOR_POINT_SAMPLE = HOUR_SAMPLE

export type VendorLineData = {
  vendor: string
  /** The vendor's requests and failed requests over the range. */
  requests: number
  errors: number
  /** One failure rate per position; null where the vendor had too few requests. */
  rates: (number | null)[]
  /** The counts the rates are made of, one per position. */
  counts: { requests: number; errors: number }[]
}

function pointsOf(trend: VendorTrend, hourly: boolean): VendorTrendPoint[] {
  return (hourly ? trend.hourly : trend.daily) ?? []
}

/**
 * Each vendor's failure rate at every position of the axis (the range's days,
 * or its hours), for the vendors with enough requests in the range. Vendors
 * come in the order the tabs always list them, so a vendor keeps its place
 * and its color from one range to the next.
 */
export function vendorFailureLines(
  trends: VendorTrend[] | null | undefined,
  starts: number[],
  hourly: boolean
): VendorLineData[] {
  const lines: VendorLineData[] = []
  for (const trend of trends ?? []) {
    const points = pointsOf(trend, hourly)
    const requests = points.reduce((sum, point) => sum + point.requests, 0)
    if (requests < VENDOR_LINE_SAMPLE) continue
    const byStart = new Map(points.map((point) => [point.start, point]))
    const counts = starts.map((start) => {
      const point = byStart.get(start)
      return { requests: point?.requests ?? 0, errors: point?.errors ?? 0 }
    })
    lines.push({
      vendor: trend.vendor,
      requests,
      errors: points.reduce((sum, point) => sum + point.errors, 0),
      counts,
      rates: counts.map((count) =>
        count.requests >= VENDOR_POINT_SAMPLE
          ? count.errors / count.requests
          : null
      ),
    })
  }
  const rank = (vendor: string) => {
    const index = VENDOR_ORDER.indexOf(vendor)
    return index < 0 ? VENDOR_ORDER.length : index
  }
  return lines.sort(
    (a, b) =>
      rank(a.vendor) - rank(b.vendor) || a.vendor.localeCompare(b.vendor)
  )
}

/** The vendor that failed the largest share of its requests over the range. */
export function worstVendorLine(
  lines: VendorLineData[]
): VendorLineData | undefined {
  let worst: VendorLineData | undefined
  for (const line of lines) {
    if (!worst || line.errors / line.requests > worst.errors / worst.requests) {
      worst = line
    }
  }
  return worst && worst.errors > 0 ? worst : undefined
}
