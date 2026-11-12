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
// The capacity tab's analysis: how close each hour came to the pool's slots,
// why the engine turned requests away, which hours failed far above their
// usual rate, and when the daily peak reaches the slots.

import {
  alignPrevious,
  isOpenHour,
  linearSlope,
  median,
  rateIsAbove,
} from './analysis'
import type { Tone } from './components/shared'
import {
  HEADROOM_SHARE,
  HOUR_SAMPLE,
  rangeSpan,
  SPIKE_FACTOR,
  SPIKE_FLOOR,
  type InsightsRangeInfo,
} from './lib'
import type { CapacityHour, EngineGroup, NamedCount } from './types'

/** The fewest whole days a daily peak trend is fitted over. */
export const MIN_TREND_DAYS = 5

// A day with this many hours is whole; a daylight-saving day has 23.
const WHOLE_DAY_HOURS = 23

/**
 * The range's end in unix seconds: the range's own, or now when a tab is
 * rendered without one.
 */
export function rangeEnd(range: InsightsRangeInfo | undefined): number {
  return range?.end ?? Math.floor(Date.now() / 1000)
}

/**
 * The seconds between an hour and the same point of the previous period:
 * the range's whole days, which the previous period is cut to, or, without
 * a range, the distance between the two series' first hours. Undefined when
 * neither is known.
 */
export function periodSpan(
  range: InsightsRangeInfo | undefined,
  current: { hour: number }[],
  previous: { hour: number }[] | null | undefined
): number | undefined {
  if (range) return rangeSpan(range)
  const first = current[0]
  const before = previous?.[0]
  if (!first || !before || first.hour <= before.hour) return undefined
  return first.hour - before.hour
}

/**
 * Pool-full rejections from this many up turn the verdict red; fewer are a
 * warning, a stray refusal that does not call for accounts.
 */
export const POOL_FULL_DANGER = SPIKE_FLOOR

/**
 * The peak to read against the pool's slots: the pool's own, or, from a
 * server before it, the site's on every channel.
 */
export function poolPeakOf(row: {
  peak_concurrency: number
  pool_peak?: number
}): number {
  return row.pool_peak ?? row.peak_concurrency
}

/** Whether a series carries the pool's own peak, which a server before it lacks. */
export function hasPoolPeak(hourly: CapacityHour[]): boolean {
  return hourly.some((row) => row.pool_peak != null)
}

/**
 * A peak against the slots. The pool's own peak (own) holds a slot per
 * request, so reaching the slots is full; the site's, with every channel,
 * is only flagged past them.
 */
export function peakTone(
  peak: number,
  slots: number,
  own: boolean
): Tone | undefined {
  if (slots <= 0) return undefined
  if (own ? peak >= slots : peak > slots) return 'danger'
  if (peak >= slots * HEADROOM_SHARE) return 'warning'
  return undefined
}

/** The engine's own refusals by cause, from a view's error categories. */
export type EngineRefusals = {
  /** Every account at its concurrency: the pool was full. */
  full: number
  /** A group, global or key concurrency cap, or the key's rate limit. */
  limit: number
  /** An account's request rate, quota budget or missing quota reading. */
  budget: number
}

export function engineRefusals(
  categories: NamedCount[] | null | undefined
): EngineRefusals {
  const count = (name: string): number =>
    categories?.find((item) => item.name === name)?.count ?? 0
  return {
    full: count('engine_concurrency'),
    limit: count('engine_limit'),
    budget: count('engine_budget'),
  }
}

/**
 * Requests in flight in the enabled groups, as the engine counts them, so
 * the figure covers the same groups as the slots it is read against.
 */
export function enabledInFlight(groups: EngineGroup[]): number {
  return groups.reduce((sum, row) => sum + (row.enabled ? row.in_flight : 0), 0)
}

/**
 * The per-account limits of the enabled groups, lowest first: each group's
 * own where the pool reports it, else the pool's default.
 */
export function accountLimits(
  groups: (EngineGroup & { credential_limit?: number | null })[],
  fallback: number
): number[] {
  const limits = new Set<number>()
  for (const row of groups) {
    if (!row.enabled) continue
    limits.add(row.credential_limit ?? fallback)
  }
  if (limits.size === 0) limits.add(fallback)
  return [...limits].sort((a, b) => a - b)
}

/** How close the closed hours came to the pool's slots. */
export type Headroom = {
  /** Closed hours whose peak reached HEADROOM_SHARE of the slots. */
  near: number
  /** Closed hours whose peak went past the slots. */
  over: number
  /** The closed hour with the highest peak, and the slots left then (negative past them). */
  tightest?: { hour: number; peak: number; free: number }
}

/**
 * Headroom over the closed hours at the given slots. The open hour's peak
 * is still rising, so it is left out. Undefined without slots.
 */
export function headroom(
  hourly: CapacityHour[],
  slots: number,
  end: number
): Headroom | undefined {
  if (slots <= 0) return undefined
  const result: Headroom = { near: 0, over: 0 }
  for (const row of hourly) {
    if (isOpenHour(row.hour, end)) continue
    const peak = poolPeakOf(row)
    if (peak >= slots * HEADROOM_SHARE) result.near += 1
    if (peak > slots) result.over += 1
    if (peak > 0 && (!result.tightest || peak > result.tightest.peak)) {
      result.tightest = { hour: row.hour, peak, free: slots - peak }
    }
  }
  return result
}

/**
 * Why the engine turned requests away. At the slots, every account was
 * busy: the pool is too small. Well under them, accounts were missing from
 * scheduling at that time: cooldowns or spent quota.
 */
export type RejectionCause = 'saturation' | 'eligibility'

export type RejectionDiagnosis = {
  /** Engine rejections over the hourly series. */
  total: number
  /** Hours with at least one. */
  hours: number
  /** The hour with the most, first on a tie. */
  worst: { hour: number; count: number; peak: number }
  /** Rejections in hours whose peak reached HEADROOM_SHARE of the slots. */
  saturated: number
  /** Whichever explains at least half of them; undefined without slots or under POOL_FULL_DANGER rejections. */
  cause?: RejectionCause
}

/**
 * The cause of the engine's rejections, weighed by how many each hour had.
 * Every hour counts, the open one too: its rejections have happened.
 * Undefined when there were none.
 */
export function diagnoseRejections(
  hourly: CapacityHour[],
  slots: number
): RejectionDiagnosis | undefined {
  let total = 0
  let hours = 0
  let saturated = 0
  let worst: RejectionDiagnosis['worst'] | undefined
  for (const row of hourly) {
    const count = row.engine_rejections
    if (count <= 0) continue
    total += count
    hours += 1
    const peak = poolPeakOf(row)
    if (slots > 0 && peak >= slots * HEADROOM_SHARE) saturated += count
    if (!worst || count > worst.count) worst = { hour: row.hour, count, peak }
  }
  if (!worst) return undefined
  // A cause, and so a buy-or-fix verdict, needs POOL_FULL_DANGER rejections;
  // a handful is only a count.
  let cause: RejectionCause | undefined
  if (slots > 0 && total >= POOL_FULL_DANGER) {
    cause = saturated * 2 >= total ? 'saturation' : 'eligibility'
  }
  return { total, hours, worst, saturated, cause }
}

/** One hour's failure rate beside what is usual for it. */
export type FailureHour = {
  hour: number
  requests: number
  errors: number
  /** errors / requests; null under HOUR_SAMPLE requests. */
  rate: number | null
  /** The previous period's same hour; null under HOUR_SAMPLE requests or without one. */
  previousRate: number | null
  /** The previous period's same hour, or else the median rated closed hour. */
  baseline: number | null
  open: boolean
  /** At least SPIKE_FLOOR failures and SPIKE_FACTOR times the baseline, beyond chance. */
  spike: boolean
}

function rateOf(
  row: { requests: number; errors: number } | undefined
): number | null {
  if (!row || row.requests < HOUR_SAMPLE) return null
  return row.errors / row.requests
}

/**
 * Each hour's failure rate against the previous period's same hour, or,
 * where that has too few requests, the median of the range's rated closed
 * hours. The open hour is drawn but never flagged or used as a baseline.
 */
export function failureHours(
  hourly: CapacityHour[],
  previous: CapacityHour[] | null | undefined,
  span: number | undefined,
  end: number
): FailureHour[] {
  const before = span === undefined ? [] : alignPrevious(hourly, previous, span)
  const closedRates = hourly
    .filter((row) => !isOpenHour(row.hour, end))
    .map(rateOf)
    .filter((rate): rate is number => rate !== null)
  const usual = closedRates.length ? median(closedRates) : null
  return hourly.map((row, index) => {
    const open = isOpenHour(row.hour, end)
    const rate = rateOf(row)
    const previousRate = rateOf(before[index])
    const baseline = previousRate ?? usual
    const spike =
      !open &&
      rate !== null &&
      baseline !== null &&
      row.errors >= SPIKE_FLOOR &&
      rate >= SPIKE_FACTOR * baseline &&
      rateIsAbove(row.errors, row.requests, baseline)
    return {
      hour: row.hour,
      requests: row.requests,
      errors: row.errors,
      rate,
      previousRate,
      baseline,
      open,
      spike,
    }
  })
}

/** The start of the viewer's day containing an hour, in unix seconds. */
export function localDay(hour: number): number {
  const date = new Date(hour * 1000)
  return (
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() /
    1000
  )
}

/** One whole day's highest hourly peak, the pool's where the server sends it. */
export type DayPeak = { day: number; peak: number }

/**
 * Each whole day's highest peak over its closed hours, oldest first. A day
 * the range cuts, such as its first and today, is left out.
 */
export function dailyPeaks(
  hourly: CapacityHour[],
  end: number,
  dayOf: (hour: number) => number = localDay,
  own = true
): DayPeak[] {
  const days = new Map<number, { peak: number; hours: number }>()
  for (const row of hourly) {
    if (isOpenHour(row.hour, end)) continue
    const day = dayOf(row.hour)
    const entry = days.get(day) ?? { peak: 0, hours: 0 }
    entry.peak = Math.max(
      entry.peak,
      own ? poolPeakOf(row) : row.peak_concurrency
    )
    entry.hours += 1
    days.set(day, entry)
  }
  return [...days.entries()]
    .filter(([, entry]) => entry.hours >= WHOLE_DAY_HOURS)
    .sort(([a], [b]) => a - b)
    .map(([day, entry]) => ({ day, peak: entry.peak }))
}

/** Where the daily peak is heading. */
export type PeakTrend = {
  /** Change per day of the fitted line. */
  slope: number
  /** The fitted line's value on the last day. */
  fitted: number
  /** Days until the fitted line reaches the slots, 0 when it has; only while rising, with slots. */
  daysToFull?: number
}

/**
 * A straight line through the daily peaks and, while it rises, the days
 * until it meets the slots. Undefined under MIN_TREND_DAYS days.
 */
export function peakTrend(
  peaks: number[],
  slots: number
): PeakTrend | undefined {
  if (peaks.length < MIN_TREND_DAYS) return undefined
  const slope = linearSlope(peaks)
  const mean = peaks.reduce((sum, value) => sum + value, 0) / peaks.length
  const fitted = mean + (slope * (peaks.length - 1)) / 2
  const trend: PeakTrend = { slope, fitted }
  if (slots > 0 && slope > 0) {
    trend.daysToFull = Math.max(0, Math.ceil((slots - fitted) / slope))
  }
  return trend
}
