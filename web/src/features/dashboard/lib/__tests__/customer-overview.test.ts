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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { QuotaDataItem } from '@/features/dashboard/types'
import type { UsageLog } from '@/features/usage-logs/data/schema'

import {
  bucketDailySpend,
  estimateRunwayDays,
  getDailyCacheHitRate,
  isDismissedWithin,
  summarizeRecentLogs,
} from '../customer-overview'

function log(
  fields: Omit<Partial<UsageLog>, 'other'> & { other?: object }
): UsageLog {
  return {
    id: 1,
    user_id: 1,
    created_at: 0,
    type: 2,
    content: '',
    username: '',
    token_name: '',
    model_name: 'claude-opus-5-5',
    quota: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    use_time: 0,
    is_stream: true,
    channel: 0,
    channel_name: '',
    token_id: 0,
    group: '',
    ip: '',
    request_id: '',
    upstream_request_id: '',
    ...fields,
    other: fields.other ? JSON.stringify(fields.other) : '',
  }
}

describe('summarizeRecentLogs', () => {
  test('counts cache reads against uncached input plus cache for Anthropic usage', () => {
    const summary = summarizeRecentLogs([
      log({
        prompt_tokens: 100,
        other: { claude: true, cache_tokens: 800, cache_creation_tokens: 100 },
      }),
    ])
    expect(summary.cacheHitRate).toBeCloseTo(0.8)
  })

  test('treats OpenAI-shaped prompt tokens as already including the cache', () => {
    const summary = summarizeRecentLogs([
      log({ prompt_tokens: 1000, other: { cache_tokens: 600 } }),
    ])
    expect(summary.cacheHitRate).toBeCloseTo(0.6)
  })

  test('prefers the split 5m and 1h cache writes when present', () => {
    const summary = summarizeRecentLogs([
      log({
        prompt_tokens: 0,
        other: {
          usage_semantic: 'anthropic',
          cache_tokens: 50,
          cache_creation_tokens: 999,
          cache_creation_tokens_5m: 30,
          cache_creation_tokens_1h: 20,
        },
      }),
    ])
    expect(summary.cacheHitRate).toBeCloseTo(0.5)
  })

  test('counts the costly misses that did not stream', () => {
    const miss = { claude: true, cache_creation_tokens: 65_000 }
    const summary = summarizeRecentLogs([
      log({ is_stream: false, quota: 30, other: miss }),
      log({ is_stream: false, quota: 20, other: miss }),
      log({ is_stream: true, quota: 10, other: miss }),
      log({ is_stream: false, other: { claude: true, cache_tokens: 65_000 } }),
    ])
    expect(summary.costlyMisses).toBe(3)
    expect(summary.costlyMissQuota).toBe(60)
    expect(summary.nonStreamMisses).toBe(2)
  })

  test('ignores non-consume rows and averages first-token time over rows that record it', () => {
    const summary = summarizeRecentLogs([
      log({ other: { frt: 1000 } }),
      log({ other: { frt: 3000 } }),
      log({ other: {} }),
      log({ type: 1, other: { frt: 99999 } }),
    ])
    expect(summary.requests).toBe(3)
    expect(summary.avgFirstTokenMs).toBe(2000)
  })

  test('returns nulls when there is nothing to measure', () => {
    expect(summarizeRecentLogs([])).toEqual({
      requests: 0,
      cacheHitRate: null,
      avgFirstTokenMs: null,
      costlyMisses: 0,
      costlyMissQuota: 0,
      nonStreamMisses: 0,
      oldestAt: null,
    })
  })

  test('reports when the oldest counted request was made', () => {
    const summary = summarizeRecentLogs([
      { ...log({ prompt_tokens: 10 }), created_at: 300 },
      { ...log({ prompt_tokens: 10 }), created_at: 100 },
      { ...log({ prompt_tokens: 10 }), created_at: 200 },
      // Not a consume log: it does not move the start of the range.
      { ...log({ prompt_tokens: 10 }), created_at: 50, type: 5 },
    ])
    expect(summary.oldestAt).toBe(100)
  })

  test('survives a malformed other field', () => {
    const summary = summarizeRecentLogs([
      { ...log({ prompt_tokens: 10 }), other: '{not json' },
    ])
    expect(summary.requests).toBe(1)
    expect(summary.cacheHitRate).toBe(0)
  })
})

describe('bucketDailySpend', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'UTC')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const now = Date.UTC(2026, 9, 21, 15, 0, 0) / 1000
  const day = (offset: number, hour = 10) =>
    Date.UTC(2026, 9, 21 - offset, hour) / 1000
  const row = (created_at: number, quota: number, count: number) =>
    ({ created_at, quota, count, model_name: 'm' }) as QuotaDataItem

  test('keeps empty days so the axis always spans the window, oldest first', () => {
    const daily = bucketDailySpend([], 3, now)
    expect(daily.map((item) => item.quota)).toEqual([0, 0, 0])
    expect(daily[2].day).toBeGreaterThan(daily[0].day)
  })

  test('sums hourly rows into their day and drops rows outside the window', () => {
    const daily = bucketDailySpend(
      [
        row(day(0, 1), 10, 1),
        row(day(0, 14), 5, 2),
        row(day(2), 7, 3),
        row(day(9), 1000, 1000),
      ],
      3,
      now
    )
    expect(daily.map((item) => [item.quota, item.requests])).toEqual([
      [7, 3],
      [0, 0],
      [15, 3],
    ])
  })
})

describe('estimateRunwayDays', () => {
  const days = (...quotas: number[]) =>
    quotas.map((quota, index) => ({
      day: index,
      quota,
      requests: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }))

  test('divides the balance by the average of days that had spend', () => {
    expect(estimateRunwayDays(100, days(0, 10, 30, 0))).toBe(5)
  })

  test('has no estimate without spend or without balance', () => {
    expect(estimateRunwayDays(100, days(0, 0))).toBeNull()
    expect(estimateRunwayDays(0, days(10))).toBeNull()
  })
})

describe('cache figures', () => {
  test('counts long requests that missed the cache and what they cost', () => {
    const summary = summarizeRecentLogs([
      log({
        quota: 500,
        prompt_tokens: 5,
        other: { claude: true, cache_creation_tokens: 286_000 },
      }),
      log({
        quota: 20,
        prompt_tokens: 5,
        other: {
          claude: true,
          cache_tokens: 90_000,
          cache_creation_tokens: 1_000,
        },
      }),
    ])
    expect(summary.costlyMisses).toBe(1)
    expect(summary.costlyMissQuota).toBe(500)
  })

  test('daily hit rate is null on a day without cache data', () => {
    const day = {
      day: 0,
      quota: 10,
      requests: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    expect(getDailyCacheHitRate(day)).toBeNull()
    expect(
      getDailyCacheHitRate({
        ...day,
        cacheReadTokens: 900,
        cacheWriteTokens: 100,
      })
    ).toBeCloseTo(0.9)
  })

  test('buckets cache reads and writes by day', () => {
    const now = Date.UTC(2026, 9, 21, 15) / 1000
    const daily = bucketDailySpend(
      [
        {
          created_at: now - 3600,
          quota: 1,
          count: 1,
          cache_read_tokens: 800,
          cache_creation_tokens: 200,
        } as QuotaDataItem,
      ],
      1,
      now
    )
    expect(daily[0]).toMatchObject({
      cacheReadTokens: 800,
      cacheWriteTokens: 200,
    })
  })
})

describe('isDismissedWithin', () => {
  const hour = 60 * 60 * 1000

  test('hides for 24 hours after the stamp, then shows again', () => {
    expect(isDismissedWithin(1_000_000, 1_000_000 + 23 * hour)).toBe(true)
    expect(isDismissedWithin(1_000_000, 1_000_000 + 24 * hour)).toBe(false)
  })

  test('ignores a missing, invalid or future stamp', () => {
    expect(isDismissedWithin(null, 5)).toBe(false)
    expect(isDismissedWithin(Number.NaN, 5)).toBe(false)
    expect(isDismissedWithin(10, 5)).toBe(false)
  })
})
