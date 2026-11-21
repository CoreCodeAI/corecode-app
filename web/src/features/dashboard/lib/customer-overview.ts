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
 * CoreCode fork: figures the customer overview derives from their own
 * request logs and hourly quota rows.
 */
import type { QuotaDataItem } from '@/features/dashboard/types'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import {
  getInputCacheTokens,
  isCostlyCacheMiss,
  isNonStreamCacheMiss,
} from '@/features/usage-logs/lib/cost-check'
import { parseLogOther } from '@/features/usage-logs/lib/format'

const LOG_TYPE_CONSUME = 2

export interface RecentUsageSummary {
  requests: number
  /** Cache reads over all input tokens, 0–1; null without any input. */
  cacheHitRate: number | null
  /** Mean time to first token in milliseconds; null when none recorded. */
  avgFirstTokenMs: number | null
  /** Long requests that missed the cache, and what they were charged. */
  costlyMisses: number
  costlyMissQuota: number
  /** Costly misses that did not stream; see isNonStreamCacheMiss. */
  nonStreamMisses: number
  /** Unix seconds of the oldest request counted; null without requests. */
  oldestAt: number | null
}

/** Cache hit rate and first-token time over a set of request logs. */
export function summarizeRecentLogs(logs: UsageLog[]): RecentUsageSummary {
  let requests = 0
  let cacheRead = 0
  let totalInput = 0
  let firstTokenTotal = 0
  let firstTokenCount = 0
  let costlyMisses = 0
  let costlyMissQuota = 0
  let nonStreamMisses = 0
  let oldestAt: number | null = null

  for (const log of logs) {
    if (log.type !== LOG_TYPE_CONSUME) continue
    requests++
    if (
      log.created_at > 0 &&
      (oldestAt === null || log.created_at < oldestAt)
    ) {
      oldestAt = log.created_at
    }
    const other = parseLogOther(log.other)
    const tokens = getInputCacheTokens(log, other)
    cacheRead += tokens.cacheRead
    totalInput += tokens.totalInput
    if (isCostlyCacheMiss(log, other)) {
      costlyMisses++
      costlyMissQuota += log.quota || 0
    }
    if (isNonStreamCacheMiss(log, other)) nonStreamMisses++

    if (other?.frt && other.frt > 0) {
      firstTokenTotal += other.frt
      firstTokenCount++
    }
  }

  return {
    requests,
    cacheHitRate: totalInput > 0 ? cacheRead / totalInput : null,
    avgFirstTokenMs:
      firstTokenCount > 0 ? firstTokenTotal / firstTokenCount : null,
    costlyMisses,
    costlyMissQuota,
    nonStreamMisses,
    oldestAt,
  }
}

export interface DailySpend {
  /** Unix seconds at the start of the local day. */
  day: number
  quota: number
  requests: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Cache reads over cache reads plus writes for one day. Claude Code sends
 * almost no uncached input, so this tracks the request-level hit rate. Null
 * when the day has no cache data, including days before quota_data recorded
 * it.
 */
export function getDailyCacheHitRate(day: DailySpend): number | null {
  const total = day.cacheReadTokens + day.cacheWriteTokens
  return total > 0 ? day.cacheReadTokens / total : null
}

function startOfLocalDay(unixSeconds: number): number {
  const date = new Date(unixSeconds * 1000)
  date.setHours(0, 0, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

/**
 * Buckets hourly quota rows into `days` local days ending today, oldest
 * first, with empty days kept so the chart keeps its time axis.
 */
export function bucketDailySpend(
  rows: QuotaDataItem[],
  days: number,
  nowSeconds: number
): DailySpend[] {
  const today = startOfLocalDay(nowSeconds)
  const buckets: DailySpend[] = []
  const index = new Map<number, DailySpend>()
  for (let offset = days - 1; offset >= 0; offset--) {
    // Step back by calendar day, not 86400 s, so DST changes stay aligned.
    const date = new Date(today * 1000)
    date.setDate(date.getDate() - offset)
    const day = Math.floor(date.getTime() / 1000)
    const bucket = {
      day,
      quota: 0,
      requests: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    buckets.push(bucket)
    index.set(day, bucket)
  }

  for (const row of rows) {
    const bucket = index.get(startOfLocalDay(Number(row.created_at) || 0))
    if (!bucket) continue
    bucket.quota += Number(row.quota) || 0
    bucket.requests += Number(row.count) || 0
    bucket.cacheReadTokens += Math.max(0, Number(row.cache_read_tokens) || 0)
    bucket.cacheWriteTokens += Math.max(
      0,
      Number(row.cache_creation_tokens) || 0
    )
  }
  return buckets
}

/**
 * Days the balance lasts at the average daily spend of the days that had
 * any spend. Null when there is nothing to project from.
 */
export function estimateRunwayDays(
  balance: number,
  daily: DailySpend[]
): number | null {
  const active = daily.filter((item) => item.quota > 0)
  if (balance <= 0 || active.length === 0) return null
  const average =
    active.reduce((sum, item) => sum + item.quota, 0) / active.length
  return average > 0 ? balance / average : null
}

const BANNER_DISMISS_MS = 24 * 60 * 60 * 1000

/** Whether a dismissal stamped at `dismissedAt` still hides its banner. */
export function isDismissedWithin(
  dismissedAt: number | null,
  now: number
): boolean {
  if (dismissedAt == null || !Number.isFinite(dismissedAt)) return false
  return now >= dismissedAt && now - dismissedAt < BANNER_DISMISS_MS
}
