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
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getApiKeys } from '@/features/keys/api'
import { perfMetricsSummaryQueryOptions } from '@/features/performance-metrics/api'
import { getUserLogs } from '@/features/usage-logs/api'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import { requireServerSuccess } from '@/lib/server-error-message'
import { getEndOfDay, getStartOfDay } from '@/lib/time'

import { getUserQuotaDates } from '../api'
import { bucketDailySpend, summarizeRecentLogs } from '../lib/customer-overview'

export const OVERVIEW_TREND_DAYS = 14
/** Requests the cache hit rate and first-token latency are averaged over. */
export const OVERVIEW_RECENT_LOGS = 100

const LOG_TYPE_CONSUME = 2

/**
 * The daily-spend window: OVERVIEW_TREND_DAYS local days, ending with today.
 * Ending it at the end of the day rather than now returns the same rows (none
 * is dated after now) and keeps the URL the same all day, so index.html can
 * fetch it before the bundle has loaded (lib/boot-requests.ts).
 */
function dailySpendRange() {
  const end = Math.floor(getEndOfDay().getTime() / 1000)
  const start = getStartOfDay()
  start.setDate(start.getDate() - (OVERVIEW_TREND_DAYS - 1))
  return { start: Math.floor(start.getTime() / 1000), end }
}

// The key holds only the window's start, so a read later the same day reuses
// a response fetched a moment earlier, such as the route loader's.
function dailySpendQueryOptions(range: { start: number; end: number }) {
  return queryOptions({
    queryKey: ['dashboard', 'overview', 'daily-spend', range.start],
    queryFn: async () =>
      requireServerSuccess(
        await getUserQuotaDates({
          start_timestamp: range.start,
          end_timestamp: range.end,
          default_time: 'hour',
        })
      ).data ?? [],
    staleTime: 60 * 1000,
  })
}

const recentLogsQueryOptions = queryOptions({
  queryKey: ['dashboard', 'overview', 'recent-logs'],
  queryFn: async () => {
    const result = requireServerSuccess(
      await getUserLogs({
        p: 1,
        page_size: OVERVIEW_RECENT_LOGS,
        type: LOG_TYPE_CONSUME,
      })
    )
    return (result.data?.items ?? []) as UsageLog[]
  },
  staleTime: 30 * 1000,
})

const overviewKeysQueryOptions = queryOptions({
  queryKey: ['dashboard', 'overview', 'api-keys'],
  queryFn: async () =>
    requireServerSuccess(await getApiKeys({ p: 1, size: 50 })).data?.items ??
    [],
  staleTime: 60 * 1000,
})

/** The overview's performance panel reads the last day's metrics. */
export const OVERVIEW_PERFORMANCE_HOURS = 24

/**
 * Start every request the overview's panels wait on. The dashboard route's
 * loader calls this, so the requests go out while the page renders instead of
 * once each panel has mounted; the panels' queries pick up the same requests.
 */
export function prefetchCustomerOverview(queryClient: QueryClient): void {
  void queryClient.prefetchQuery(dailySpendQueryOptions(dailySpendRange()))
  void queryClient.prefetchQuery(recentLogsQueryOptions)
  void queryClient.prefetchQuery(overviewKeysQueryOptions)
  void queryClient.prefetchQuery(
    perfMetricsSummaryQueryOptions(OVERVIEW_PERFORMANCE_HOURS)
  )
}

/**
 * The signed-in user's spend per local day over the last
 * OVERVIEW_TREND_DAYS days, oldest first. The overview and the wallet share
 * this query.
 */
export function useDailySpend() {
  // Fixed at mount so the query key stays stable across renders.
  const range = useMemo(dailySpendRange, [])
  const query = useQuery(dailySpendQueryOptions(range))

  const daily = useMemo(
    () => bucketDailySpend(query.data ?? [], OVERVIEW_TREND_DAYS, range.end),
    [range.end, query.data]
  )

  return { daily, loading: query.isLoading }
}

/**
 * Everything the customer overview reads, fetched once and shared by its
 * panels. Each query is scoped to the signed-in user's own data.
 */
export function useCustomerOverview() {
  const spend = useDailySpend()

  const logsQuery = useQuery(recentLogsQueryOptions)
  const keysQuery = useQuery(overviewKeysQueryOptions)

  const recent = useMemo(
    () => summarizeRecentLogs(logsQuery.data ?? []),
    [logsQuery.data]
  )

  return {
    daily: spend.daily,
    trendLoading: spend.loading,
    recent,
    recentLogs: logsQuery.data ?? [],
    logsLoading: logsQuery.isLoading,
    keys: keysQuery.data ?? [],
    keysLoading: keysQuery.isLoading,
  }
}
