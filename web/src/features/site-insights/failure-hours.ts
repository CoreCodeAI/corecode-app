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
// The hourly failure rule both tabs apply: which failures count, what an
// hour's usual rate is, and when an hour failed far above it. One definition
// keeps the capacity and quality tabs judging an hour the same way.

import { closedHours, median, rateIsAbove } from './analysis'
import {
  FAILURE_WARNING_RATE,
  HOUR_SAMPLE,
  SMALL_SAMPLE,
  SPIKE_FACTOR,
  SPIKE_FLOOR,
} from './lib'

/** An hour's failed requests and its requests, as the rule counts them. */
export type FailureCounts = { requests: number; errors: number }

/** An hour row that may carry the service's own counts. */
export type ServiceCounted = FailureCounts & {
  hour: number
  service_requests?: number
  service_errors?: number
}

/**
 * The hours with the counts the rule reads: the service's failures (requests
 * no channel could take and the customers' 4xx left out) when every hour
 * carries them, else the requests and failures as logged. The series falls
 * back as a whole: mixing the two would read an older hour's routing refusals
 * as an outage.
 */
export function serviceFailureRows<T extends ServiceCounted>(rows: T[]): T[] {
  const served = rows.every(
    (row) => row.service_requests != null && row.service_errors != null
  )
  if (!served) return rows
  return rows.map((row) => {
    const requests = row.service_requests ?? 0
    const errors = row.service_errors ?? 0
    return {
      ...row,
      requests,
      errors,
      error_rate: requests > 0 ? errors / requests : 0,
    }
  })
}

/**
 * The range's usual hour: the median failure rate of its closed hours with
 * enough requests to have one. One bad hour cannot move a median. Null when
 * no closed hour has a rate.
 */
export function usualFailureRate(
  rows: (FailureCounts & { hour: number })[],
  end: number
): number | null {
  const rates = closedHours(rows, end)
    .filter((row) => row.requests >= HOUR_SAMPLE)
    .map((row) => row.errors / row.requests)
  return rates.length ? median(rates) : null
}

/**
 * Whether an hour failed far above the usual rate: at least SMALL_SAMPLE
 * requests and SPIKE_FLOOR failures, and a rate beyond chance (Wilson 95%
 * lower bound) above both SPIKE_FACTOR times usual and FAILURE_WARNING_RATE.
 * The caller leaves the open hour out. False without a usual rate.
 */
export function isFailureSpike(
  row: FailureCounts,
  usual: number | null
): boolean {
  return (
    usual !== null &&
    row.requests >= SMALL_SAMPLE &&
    row.errors >= SPIKE_FLOOR &&
    rateIsAbove(
      row.errors,
      row.requests,
      Math.max(SPIKE_FACTOR * usual, FAILURE_WARNING_RATE)
    )
  )
}
