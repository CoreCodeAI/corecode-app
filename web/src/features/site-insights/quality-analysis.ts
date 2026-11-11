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
// The quality tab's diagnosis: what drove the failure rate, which models fail
// beyond chance, which hours stood out, whose failures they are, and whether
// a move in first-token time is only a change of vendor mix.

import {
  alignPrevious,
  closedHours,
  dominant,
  isOpenHour,
  median,
  rateContributions,
  rateIsAbove,
  type Contribution,
} from './analysis'
import { HOUR_SAMPLE, SMALL_SAMPLE, SPIKE_FACTOR } from './lib'
import type { NamedCount, QualityHour, QualityInsights } from './types'

export type QualityModel = NonNullable<QualityInsights['models']>[number]

/**
 * The site's failure rate the models and vendors are read against: every
 * model's, since those rows ignore the filter; the headline's on an older
 * server.
 */
export function siteFailureRate(data: QualityInsights): number {
  return data.all_models?.error_rate ?? data.error_rate
}

/** The first-token p95 over every model in both periods, or null when they cannot be compared. */
export function siteTtftP95(
  data: QualityInsights,
  previous: QualityInsights | undefined,
  selected: string[]
): { now: number; before: number } | null {
  if (!previous) return null
  if (data.all_models && previous.all_models) {
    return {
      now: data.all_models.ttft_p95_ms,
      before: previous.all_models.ttft_p95_ms,
    }
  }
  if (selected.length > 0) return null
  return { now: data.ttft_p95_ms, before: previous.ttft_p95_ms }
}

/** A rate over requests, for a row that may predate its errors field. */
type RateRow = { requests: number; error_rate: number; errors?: number }

/** A row's failed requests; a row without the count derives it from its rate. */
export function errorsOf(row: RateRow): number {
  return row.errors ?? Math.round(row.error_rate * row.requests)
}

/** Failures beyond what the row's requests would have at the site's rate. */
export function excessFailures(row: RateRow, siteRate: number): number {
  return errorsOf(row) - row.requests * siteRate
}

/** The row's rate is above the site's beyond small-sample chance. */
export function failsAboveSite(row: RateRow, siteRate: number): boolean {
  return rateIsAbove(errorsOf(row), row.requests, siteRate)
}

/** Models by excess failures, most first; ties by requests. */
export function rankByExcess<T extends RateRow & { model: string }>(
  rows: T[] | null | undefined,
  siteRate: number
): T[] {
  return [...(rows ?? [])].sort(
    (a, b) =>
      excessFailures(b, siteRate) - excessFailures(a, siteRate) ||
      b.requests - a.requests ||
      a.model.localeCompare(b.model)
  )
}

// The normal quantile of a two-sided 95% test.
const Z95 = 1.959964

export type FailureShift =
  /** No previous period to compare with. */
  | { kind: 'none' }
  /** Either period had too few requests for a change to mean anything. */
  | { kind: 'small' }
  /** The change is within what chance alone gives at these sample sizes. */
  | { kind: 'flat'; points: number }
  | { kind: 'moved'; points: number }

/**
 * How the failure rate moved, in points, and whether the move is beyond
 * chance by a two-proportion test at 95%.
 */
export function failureShift(
  current: RateRow,
  previous: RateRow | undefined
): FailureShift {
  if (!previous || previous.requests <= 0) return { kind: 'none' }
  if (previous.requests < SMALL_SAMPLE || current.requests < SMALL_SAMPLE) {
    return { kind: 'small' }
  }
  const a = errorsOf(current)
  const b = errorsOf(previous)
  const points = (current.error_rate - previous.error_rate) * 100
  const pooled = (a + b) / (current.requests + previous.requests)
  const se = Math.sqrt(
    pooled * (1 - pooled) * (1 / current.requests + 1 / previous.requests)
  )
  const diff = a / current.requests - b / previous.requests
  if (se === 0 || Math.abs(diff) / se < Z95) return { kind: 'flat', points }
  return { kind: 'moved', points }
}

/**
 * Each model's contribution to the failure rate's change, in rate points,
 * and the one or two that drove it. With a filter only the selected models
 * count, as the headline does. Empty without both periods' models.
 */
export function failureDrivers(
  current: QualityModel[] | null | undefined,
  previous: QualityModel[] | null | undefined,
  selected: string[] = []
): { parts: Contribution[]; drivers: Contribution[] } {
  if (!current?.length || !previous?.length) return { parts: [], drivers: [] }
  const keep = (rows: QualityModel[]) =>
    selected.length > 0
      ? rows.filter((row) => selected.includes(row.model))
      : rows
  const parts = rateContributions(
    keep(current),
    keep(previous),
    (row) => row.model,
    errorsOf,
    (row) => row.requests
  )
  const total = parts.reduce((sum, part) => sum + part.change, 0)
  return { parts, drivers: dominant(parts, total) }
}

/** A model's move from the previous period, when both rest on enough requests. */
export function modelChange(
  row: QualityModel,
  previous: QualityModel[] | null | undefined
): { points: number; ttftP95: number | null } | null {
  const before = previous?.find((item) => item.model === row.model)
  if (!before) return null
  if (row.requests < SMALL_SAMPLE || before.requests < SMALL_SAMPLE) {
    return null
  }
  const measured = row.ttft_p95_ms > 0 && before.ttft_p95_ms > 0
  return {
    points: (row.error_rate - before.error_rate) * 100,
    ttftP95: measured ? row.ttft_p95_ms - before.ttft_p95_ms : null,
  }
}

type VendorRow = {
  vendor: string
  requests: number
  ttft_p95_ms: number
}

/** A first-token p95 move that the vendor mix explains. */
export type MixShift = {
  vendor: string
  /** The vendor's share of measured requests before and now. */
  before: number
  now: number
  /** The site's p95 before and now, in milliseconds. */
  p95Before: number
  p95Now: number
}

// A p95 move under both of these is not worth explaining.
const MIX_MIN_MOVE_MS = 1000
const MIX_MIN_MOVE_SHARE = 0.2
// A vendor's own p95 within this share of before held.
const MIX_HELD_SHARE = 0.15
// A share move under this is not a change of mix.
const MIX_MIN_SHARE_POINTS = 0.05

/**
 * Explains a move in the site's first-token p95 by a change of vendor mix:
 * the p95 moved, one vendor's share of requests grew while its own latency
 * sits on the side the site moved to, and every vendor with enough requests in both
 * periods kept its own p95. Null when the mix does not explain the move.
 */
export function mixShift(
  p95Now: number,
  p95Before: number,
  vendors: VendorRow[] | null | undefined,
  previousVendors: VendorRow[] | null | undefined
): MixShift | null {
  if (p95Now <= 0 || p95Before <= 0) return null
  const move = p95Now - p95Before
  if (
    Math.abs(move) < MIX_MIN_MOVE_MS ||
    Math.abs(move) < MIX_MIN_MOVE_SHARE * p95Before
  ) {
    return null
  }
  const now = (vendors ?? []).filter((row) => row.ttft_p95_ms > 0)
  const before = (previousVendors ?? []).filter((row) => row.ttft_p95_ms > 0)
  const totalNow = now.reduce((sum, row) => sum + row.requests, 0)
  const totalBefore = before.reduce((sum, row) => sum + row.requests, 0)
  if (totalNow <= 0 || totalBefore <= 0) return null
  let compared = 0
  for (const row of now) {
    const old = before.find((item) => item.vendor === row.vendor)
    if (!old) continue
    if (row.requests < SMALL_SAMPLE || old.requests < SMALL_SAMPLE) continue
    compared += 1
    const drift = Math.abs(row.ttft_p95_ms - old.ttft_p95_ms)
    if (drift > MIX_HELD_SHARE * old.ttft_p95_ms) return null
  }
  if (compared === 0) return null
  let best: MixShift | null = null
  for (const row of now) {
    const old = before.find((item) => item.vendor === row.vendor)
    const shareNow = row.requests / totalNow
    const shareBefore = old ? old.requests / totalBefore : 0
    const shift = shareNow - shareBefore
    // The mix is named by the vendor that grew: more of one slower than the
    // site was pulls p95 up, more of one faster pulls it down.
    if (shift < MIX_MIN_SHARE_POINTS) continue
    if (Math.sign(row.ttft_p95_ms - p95Before) !== Math.sign(move)) continue
    if (!best || shift > best.now - best.before) {
      best = {
        vendor: row.vendor,
        before: shareBefore,
        now: shareNow,
        p95Before,
        p95Now,
      }
    }
  }
  return best
}

/** One closed hour that stood out. */
export type HourFlag = {
  hour: number
  index: number
  requests: number
  errors: number
  error_rate: number
  ttft_p95_ms: number
  /** Failure rate beyond chance above its baseline. */
  failing: boolean
  /** First-token p95 at twice its baseline or more, and past 10 seconds. */
  slow: boolean
}

const SLOW_TTFT_MS = 10000
const SLOW_FACTOR = 2
// Below this rate an hour's failures are not flagged, whatever its baseline.
const HOUR_RATE_FLOOR = 0.02

/**
 * The closed hours whose failure rate or first-token p95 stood out against
 * the same hour of the previous period, or the range's median closed hour
 * where that hour had too few requests. An hour needs HOUR_SAMPLE requests.
 * A failing hour's rate is beyond chance above SPIKE_FACTOR times its
 * baseline and above 2%.
 */
export function hourFlags(
  hourly: QualityHour[] | null | undefined,
  previousHourly: QualityHour[] | null | undefined,
  end: number
): HourFlag[] {
  const rows = hourly ?? []
  if (rows.length === 0) return []
  const closed = closedHours(rows, end).filter(
    (row) => row.requests >= HOUR_SAMPLE
  )
  const medianRate = median(closed.map((row) => row.error_rate))
  const medianP95 = median(
    closed.filter((row) => row.ttft_p95_ms > 0).map((row) => row.ttft_p95_ms)
  )
  const previous = previousHourly ?? []
  const span = previous.length > 0 ? rows[0].hour - previous[0].hour : 0
  const aligned =
    span > 0 ? alignPrevious(rows, previous, span) : rows.map(() => undefined)
  const flags: HourFlag[] = []
  rows.forEach((row, index) => {
    if (isOpenHour(row.hour, end) || row.requests < HOUR_SAMPLE) return
    const before = aligned[index]
    const sampled = !!before && before.requests >= HOUR_SAMPLE
    const rateBase = sampled ? before.error_rate : medianRate
    const p95Base =
      sampled && before.ttft_p95_ms > 0 ? before.ttft_p95_ms : medianP95
    const failing = rateIsAbove(
      row.errors,
      row.requests,
      Math.max(SPIKE_FACTOR * rateBase, HOUR_RATE_FLOOR)
    )
    const slow =
      row.ttft_p95_ms > SLOW_TTFT_MS &&
      p95Base > 0 &&
      row.ttft_p95_ms >= SLOW_FACTOR * p95Base
    if (failing || slow) {
      flags.push({
        hour: row.hour,
        index,
        requests: row.requests,
        errors: row.errors,
        error_rate: row.error_rate,
        ttft_p95_ms: row.ttft_p95_ms,
        failing,
        slow,
      })
    }
  })
  return flags
}

/**
 * The closed hour with the highest failure rate among those with enough
 * requests to have one; undefined when none has.
 */
export function worstHour(
  hourly: QualityHour[] | null | undefined,
  end: number
): QualityHour | undefined {
  return closedHours(hourly ?? [], end)
    .filter((row) => row.requests >= HOUR_SAMPLE)
    .reduce<QualityHour | undefined>(
      (top, row) => (!top || row.error_rate > top.error_rate ? row : top),
      undefined
    )
}

/**
 * The run of consecutive failing hours around the worst one; undefined
 * without a failing hour.
 */
export function failingWindow(
  flags: HourFlag[]
): { from: HourFlag; to: HourFlag; worst: HourFlag } | undefined {
  const failing = flags.filter((flag) => flag.failing)
  if (failing.length === 0) return undefined
  const worst = failing.reduce((top, flag) =>
    flag.error_rate > top.error_rate ? flag : top
  )
  const at = new Map(failing.map((flag) => [flag.index, flag]))
  let from = worst
  let to = worst
  while (at.has(from.index - 1)) from = at.get(from.index - 1) as HourFlag
  while (at.has(to.index + 1)) to = at.get(to.index + 1) as HourFlag
  return { from, to, worst }
}

/** Whose failure a category is, and so where it is acted on. */
export type FailureOwner = 'ours' | 'upstream' | 'client' | 'other'

const CATEGORY_OWNERS: Record<string, FailureOwner> = {
  engine_concurrency: 'ours',
  upstream_rate_limit: 'upstream',
  upstream_overloaded: 'upstream',
  upstream_error: 'upstream',
  client_error: 'client',
}

export function categoryOwner(name: string): FailureOwner {
  return CATEGORY_OWNERS[name] ?? 'other'
}

/** Customers' failures by whose they are, largest first; owners with none left out. */
export function failureOwners(
  categories: NamedCount[] | null | undefined
): { owner: FailureOwner; count: number }[] {
  const counts = new Map<FailureOwner, number>()
  for (const item of categories ?? []) {
    const owner = categoryOwner(item.name)
    counts.set(owner, (counts.get(owner) ?? 0) + item.count)
  }
  return [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
}

/**
 * The failure rate with customers' client errors (4xx) left out of both the
 * failures and the requests: what the service itself failed. Null without
 * categories.
 */
export function serviceFailureRate(
  data: Pick<QualityInsights, 'requests' | 'errors' | 'error_categories'>
): number | null {
  const categories = data.error_categories
  if (!categories) return null
  const client = categories
    .filter((item) => categoryOwner(item.name) === 'client')
    .reduce((sum, item) => sum + item.count, 0)
  const requests = data.requests - client
  if (requests <= 0) return null
  return Math.max(0, data.errors - client) / requests
}

// Stream ends that finished as the protocol expects.
const NORMAL_ENDS = new Set(['eof', 'done', 'handler_stop'])
// Stream ends where the client went away; not the service's doing.
const CLIENT_ENDS = new Set(['client_gone', 'ping_fail'])

/**
 * The share of streams that did not end normally, and how many of those the
 * client ended by leaving. Null without streams.
 */
export function abnormalStreams(
  ends: NamedCount[] | null | undefined
): { share: number; count: number; clientGone: number; total: number } | null {
  const items = ends ?? []
  const total = items.reduce((sum, item) => sum + item.count, 0)
  if (total <= 0) return null
  const abnormal = items.filter((item) => !NORMAL_ENDS.has(item.name))
  const count = abnormal.reduce((sum, item) => sum + item.count, 0)
  const clientGone = abnormal
    .filter((item) => CLIENT_ENDS.has(item.name))
    .reduce((sum, item) => sum + item.count, 0)
  return { share: count / total, count, clientGone, total }
}
