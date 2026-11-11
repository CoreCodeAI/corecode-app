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
/**
 * CoreCode fork: stable query inputs for the log page's aggregate requests,
 * so re-rendering or paging the table does not rerun them.
 */
import { buildApiParams } from './utils'

const HOUR_SECONDS = 3600

/**
 * The search fields the log stats depend on. The stats request always asks
 * for page 1 of size 1, so paging the table must not change its query key.
 */
export function logStatsSearch(
  searchParams: Record<string, unknown>
): Record<string, unknown> {
  const statsSearch = { ...searchParams }
  delete statsSearch.page
  delete statsSearch.pageSize
  return statsSearch
}

/**
 * The range "Spend by key" reads from the hourly quota_data rollup. Rows are
 * stamped with the start of their hour, so with no end in the URL the range
 * ends at the next hour boundary: the same rows as "now + 1 hour", and the
 * same query key for the rest of the hour.
 */
export function spendBreakdownRange(
  searchParams: Record<string, unknown>,
  nowMs: number
): { start: number; end: number } {
  const params = buildApiParams({
    page: 1,
    pageSize: 1,
    searchParams,
    columnFilters: [],
    isAdmin: false,
  })
  const start = params.start_timestamp ?? 0
  if (searchParams.endTime) {
    return { start, end: params.end_timestamp ?? 0 }
  }
  const nowSeconds = Math.floor(nowMs / 1000)
  const end = Math.ceil(nowSeconds / HOUR_SECONDS) * HOUR_SECONDS
  return { start, end }
}
