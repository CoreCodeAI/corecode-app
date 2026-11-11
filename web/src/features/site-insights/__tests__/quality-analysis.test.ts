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
  abnormalStreams,
  attemptsOf,
  excessFailures,
  failingTaskModels,
  failingWindow,
  failsAboveSite,
  failuresListed,
  failureDrivers,
  failureOwners,
  failureShift,
  hourFlags,
  mixShift,
  modelChange,
  rankByExcess,
  serviceFailureRate,
  unplacedModels,
  withRemainder,
  worstHour,
  type QualityModel,
} from '../quality-analysis'
import type { QualityHour, TaskOutcome, TaskOutcomes } from '../types'

function model(name: string, requests: number, errors: number): QualityModel {
  return {
    model: name,
    vendor: 'claude',
    requests,
    errors,
    error_rate: requests ? errors / requests : 0,
    ttft_p50_ms: 1000,
    ttft_p95_ms: 5000,
    latency_p50_s: 1,
    latency_p95_s: 2,
    cache_share: 0,
  }
}

function hour(
  at: number,
  requests: number,
  errors: number,
  p95 = 4000
): QualityHour {
  return {
    hour: at,
    requests,
    errors,
    error_rate: requests ? errors / requests : 0,
    ttft_p50_ms: 1000,
    ttft_p95_ms: p95,
  }
}

describe('quality analysis', () => {
  it('ranks models by failures beyond the site rate and colours only real outliers', () => {
    const rows = [model('a', 1000, 30), model('b', 50, 5), model('c', 2000, 20)]
    expect(excessFailures(rows[0], 0.01)).toBe(20)
    expect(rankByExcess(rows, 0.01).map((row) => row.model)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(failsAboveSite(rows[0], 0.01)).toBe(true)
    // 10% of 50 requests is not beyond chance above 5%.
    expect(failsAboveSite(rows[1], 0.05)).toBe(false)
  })

  it('tests the failure-rate change before calling it a move', () => {
    expect(failureShift(model('x', 1000, 30), undefined)).toEqual({
      kind: 'none',
    })
    expect(failureShift(model('x', 1000, 30), model('x', 40, 0))).toEqual({
      kind: 'small',
    })
    const flat = failureShift(model('x', 200, 3), model('x', 200, 2))
    expect(flat.kind).toBe('flat')
    const moved = failureShift(model('x', 1000, 50), model('x', 1000, 10))
    expect(moved.kind).toBe('moved')
    expect(moved.kind === 'moved' && moved.points).toBeCloseTo(4)
  })

  it('names the model that drove the failure rate', () => {
    const now = [model('a', 500, 25), model('b', 500, 5)]
    const before = [model('a', 500, 5), model('b', 500, 5)]
    const { parts, drivers } = failureDrivers(now, before)
    expect(parts).toEqual([
      { key: 'a', current: 0.025, previous: 0.005, change: 0.02 },
    ])
    expect(drivers.map((part) => part.key)).toEqual(['a'])
    expect(failureDrivers(now, before, ['b']).parts).toEqual([])
  })

  it('compares a model with itself only when both periods have enough requests', () => {
    const now = { ...model('a', 200, 10), ttft_p95_ms: 7000 }
    const change = modelChange(now, [model('a', 200, 4)])
    expect(change?.points).toBeCloseTo(3)
    expect(change?.ttftP95).toBe(2000)
    expect(modelChange(now, [model('a', 50, 4)])).toBeNull()
    expect(modelChange(now, [])).toBeNull()
  })

  it('explains a p95 move by vendor mix only when each vendor held', () => {
    const before = [
      { vendor: 'claude', requests: 800, ttft_p95_ms: 6000 },
      { vendor: 'codex', requests: 200, ttft_p95_ms: 18000 },
    ]
    const now = [
      { vendor: 'claude', requests: 500, ttft_p95_ms: 6200 },
      { vendor: 'codex', requests: 500, ttft_p95_ms: 18500 },
    ]
    expect(mixShift(15000, 9000, now, before)).toEqual({
      vendor: 'codex',
      before: 0.2,
      now: 0.5,
      p95Before: 9000,
      p95Now: 15000,
    })
    const slower = [now[0], { ...now[1], ttft_p95_ms: 30000 }]
    expect(mixShift(15000, 9000, slower, before)).toBeNull()
    expect(mixShift(9300, 9000, now, before)).toBeNull()
  })

  it('flags closed hours against the same hour before, leaving the open hour out', () => {
    const h = 3600
    const rows = [
      hour(10 * h, 100, 1),
      hour(11 * h, 100, 20),
      hour(12 * h, 100, 18, 30000),
      hour(13 * h, 100, 40),
    ]
    const previous = [
      hour(10 * h - 4 * h, 100, 1),
      hour(11 * h - 4 * h, 100, 1),
      hour(12 * h - 4 * h, 100, 1, 5000),
      hour(13 * h - 4 * h, 100, 1),
    ]
    const end = 13 * h + 600
    const flags = hourFlags(rows, previous, end)
    expect(
      flags.map((flag) => [flag.hour / h, flag.failing, flag.slow])
    ).toEqual([
      [11, true, false],
      [12, true, true],
    ])
    expect(worstHour(rows, end)?.hour).toBe(11 * h)
    const window = failingWindow(flags)
    expect([window?.from.hour, window?.to.hour, window?.worst.hour]).toEqual([
      11 * h,
      12 * h,
      11 * h,
    ])
    expect(hourFlags([hour(0, 10, 9)], [], 7200)).toEqual([])
  })

  it('splits customers’ failures by owner and leaves client errors out of the service rate', () => {
    const categories = [
      { name: 'upstream_rate_limit', count: 6 },
      { name: 'client_error', count: 10 },
      { name: 'engine_concurrency', count: 3 },
      { name: 'upstream_error', count: 2 },
    ]
    expect(failureOwners(categories)).toEqual([
      { owner: 'client', count: 10 },
      { owner: 'upstream', count: 8 },
      { owner: 'ours', count: 3 },
    ])
    expect(
      serviceFailureRate({
        requests: 1010,
        errors: 30,
        error_categories: categories,
      })
    ).toBe(0.02)
    expect(serviceFailureRate({ requests: 10, errors: 1 })).toBeNull()
  })

  it('counts streams that did not end normally', () => {
    expect(
      abnormalStreams([
        { name: 'eof', count: 80 },
        { name: 'done', count: 10 },
        { name: 'timeout', count: 6 },
        { name: 'client_gone', count: 4 },
      ])
    ).toEqual({ share: 0.06, count: 6, clientGone: 4, total: 100 })
    expect(abnormalStreams([])).toBeNull()
  })

  it('files engine limits as ours, refused keys as the upstream’s and no channel as routing', () => {
    const categories = [
      { name: 'engine_limit', count: 4 },
      { name: 'engine_budget', count: 2 },
      { name: 'upstream_auth', count: 5 },
      { name: 'no_channel', count: 3 },
      { name: 'client_error', count: 1 },
    ]
    expect(failureOwners(categories)).toEqual([
      { owner: 'ours', count: 6 },
      { owner: 'upstream', count: 5 },
      { owner: 'routing', count: 3 },
      { owner: 'client', count: 1 },
    ])
    // Only the client error leaves the service rate: (15 - 1) / (701 - 1).
    expect(
      serviceFailureRate({
        requests: 701,
        errors: 15,
        error_categories: categories,
      })
    ).toBe(0.02)
  })

  it('adds what a cut list leaves out as one row', () => {
    const items = [
      { name: 'a', count: 300 },
      { name: 'b', count: 300 },
    ]
    expect(withRemainder(items, 1000, 'Other')).toEqual({
      items: [...items, { name: 'Other', count: 400 }],
      left: 400,
    })
    expect(withRemainder(items, 600, 'Other')).toEqual({ items, left: 0 })
    expect(withRemainder(items, null, 'Other')).toEqual({ items, left: 0 })
    expect(
      failuresListed({
        status_codes: [
          { name: '503', count: 700 },
          { name: '429', count: 300 },
        ],
      })
    ).toBe(1000)
    expect(failuresListed({ status_codes: [] })).toBeNull()
  })

  it('lists the models the map cannot place, busiest first', () => {
    const rows = [
      model('streamed', 500, 5),
      { ...model('all-failed', 300, 300), ttft_p50_ms: 0 },
      { ...model('tiny', 5, 5), ttft_p50_ms: 0 },
      { ...model('video', 900, 0), ttft_p50_ms: 0 },
    ]
    expect(unplacedModels(rows, 20).map((row) => row.model)).toEqual([
      'video',
      'all-failed',
    ])
  })

  it('judges task models only on enough finished tasks', () => {
    const task = (
      name: string,
      succeeded: number,
      failed: number,
      running = 0
    ): TaskOutcome => ({
      model: name,
      submitted: succeeded + failed + running,
      succeeded,
      failed,
      timed_out: 0,
      running,
      stalled: 0,
      failure_rate: failed / Math.max(1, succeeded + failed),
      finish_p50_s: 60,
      finish_p95_s: 120,
      reasons: null,
    })
    const tasks: TaskOutcomes = {
      total: task('', 0, 0),
      models: [
        task('seedance', 70, 30),
        task('wan', 80, 5),
        task('few', 5, 5, 100),
        task('clean', 100, 1),
      ],
      channels: null,
      truncated: false,
    }
    expect(failingTaskModels(tasks).map((row) => row.model)).toEqual([
      'seedance',
      'wan',
    ])
    expect(failingTaskModels(undefined)).toEqual([])
  })

  it('reads attempts only when the server sends them', () => {
    const base = {
      requests: 100,
      errors: 1,
    } as unknown as Parameters<typeof attemptsOf>[0]
    expect(attemptsOf(base)).toBeNull()
    expect(attemptsOf({ ...base, attempts: 120, attempt_errors: 21 })).toEqual({
      attempts: 120,
      failed: 21,
      rate: 0.175,
    })
  })
})
