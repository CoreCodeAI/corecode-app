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
// Pure analysis for the risk tab: which shared address to review first,
// whether an hour's sign-ups surged, and which figures rest on enough data.

import { findSpikes, median } from '../analysis'
import {
  DEBT_ALERT_USD,
  MIN_COHORT,
  SIGNUP_SPIKE_FLOOR,
  SPIKE_FACTOR,
  type InsightsRangeInfo,
} from '../lib'
import type { BalanceUser, CountPoint, RiskInsights } from '../types'

/** Registrations this close together look scripted. */
export const BURST_SECONDS = 600

/** A balance at or under this, in US dollars, has nothing left to spend. */
export const EMPTY_BALANCE_USD = 0.01

/** Under this count in both periods, a count's change is not shown. */
export const MIN_SIGNAL_COUNT = 3

export type RiskCluster = RiskInsights['shared_ips'][number]

/** Why an address is worth a look, and how much. */
export type ClusterRisk = {
  /** Members created inside the range. */
  fresh: number
  /** The most members registered within BURST_SECONDS of each other. */
  burst: number
  /** Members who bought a plan. */
  buyers: number
  /** Members who never paid and have nothing left. */
  empty: number
  /** Every member paid: an office or a reseller more than a farm. */
  allPaid: boolean
  score: number
}

export type RankedCluster = RiskCluster & { risk: ClusterRisk }

/** The most times that fall within any window of the given length; 0 when empty. */
export function largestBurst(
  times: number[],
  window: number = BURST_SECONDS
): number {
  const sorted = [...times].sort((a, b) => a - b)
  let best = 0
  let first = 0
  sorted.forEach((time, index) => {
    while (time - sorted[first] > window) first += 1
    best = Math.max(best, index - first + 1)
  })
  return best
}

/**
 * What makes a cluster suspect. Fresh members and a registration burst weigh
 * 2 each, plan buyers past one 3 each, unpaid empty members 1 each; an
 * all-paying cluster keeps a quarter of that.
 */
export function clusterRisk(
  cluster: RiskCluster,
  start: number | undefined
): ClusterRisk {
  const created = cluster.users
    .map((user) => user.created_at)
    .filter((at) => at > 0)
  const fresh = start == null ? 0 : created.filter((at) => at >= start).length
  const burst = largestBurst(created)
  const buyers = cluster.subscription_buyers
  const empty = cluster.users.filter(
    (user) =>
      !user.paid && !user.subscription && user.balance_usd <= EMPTY_BALANCE_USD
  ).length
  const allPaid = cluster.users.every((user) => user.paid || user.subscription)
  let score = 2 * fresh + empty
  if (burst > 1) score += 2 * burst
  if (buyers > 1) score += 3 * buyers
  if (allPaid) score /= 4
  return { fresh, burst, buyers, empty, allPaid, score }
}

/** Clusters by risk, highest first; ties by size, then requests, then address. */
export function rankClusters(
  clusters: RiskCluster[],
  start: number | undefined
): RankedCluster[] {
  return clusters
    .map((cluster) => ({ ...cluster, risk: clusterRisk(cluster, start) }))
    .sort(
      (a, b) =>
        b.risk.score - a.risk.score ||
        b.users.length - a.users.length ||
        b.requests - a.requests ||
        a.ip.localeCompare(b.ip)
    )
}

/** Where the range begins: the range's own start, else the first bucket's. */
export function riskRangeStart(
  data: RiskInsights,
  range: InsightsRangeInfo | undefined
): number | undefined {
  return range?.start ?? data.signup_series?.[0]?.at
}

/**
 * What a surge is measured against: the same hour of the previous period,
 * the previous period's median bucket, or the median of the range's other
 * closed buckets.
 */
export type SurgeBasis = 'same-hour' | 'previous' | 'range'

export type SignupSurge = {
  /** The bucket's index in the series. */
  index: number
  at: number
  count: number
  /** 0 when the basis had no sign-ups at all. */
  baseline: number
  basis: SurgeBasis
}

/**
 * Buckets whose sign-ups reached SPIKE_FACTOR times their baseline and at
 * least SIGNUP_SPIKE_FLOOR. An hour is measured against the same hour of the
 * previous period (span seconds earlier), a day against the previous
 * period's median day; without either, against the range's median bucket.
 * The bucket still filling at end is left out.
 */
export function signupSurges(
  series: CountPoint[] | null | undefined,
  previous: CountPoint[] | null | undefined,
  options: { unit: number; end: number; span?: number }
): SignupSurge[] {
  const closed = (series ?? []).filter(
    (point) => point.at + options.unit <= options.end
  )
  const values = closed.map((point) => point.count)
  const before = previous ?? []
  let baselines: (number | undefined)[] = closed.map(() => undefined)
  let basis: SurgeBasis = 'range'
  if (before.length > 0 && options.unit === 3600 && options.span != null) {
    const span = options.span
    const byAt = new Map(before.map((point) => [point.at, point.count]))
    baselines = closed.map((point) => byAt.get(point.at - span))
    basis = 'same-hour'
  } else if (before.length > 0) {
    const typical = median(before.map((point) => point.count))
    baselines = closed.map(() => typical)
    basis = 'previous'
  }
  return findSpikes(values, baselines, {
    factor: SPIKE_FACTOR,
    floor: SIGNUP_SPIKE_FLOOR,
  }).map((index) => {
    const own = baselines[index] ?? 0
    const fallback = median(values.filter((_, other) => other !== index))
    return {
      index,
      at: closed[index].at,
      count: values[index],
      baseline: own > 0 ? own : fallback,
      basis: own > 0 ? basis : 'range',
    }
  })
}

/** The bucket length of the risk view's sign-up series, in seconds. */
export function signupUnit(data: Pick<RiskInsights, 'series_unit'>): number {
  return data.series_unit === 'day' ? 86400 : 3600
}

/** signupSurges for a risk response against its previous period. */
export function riskSurges(
  data: RiskInsights,
  previous: RiskInsights | undefined,
  range: InsightsRangeInfo | undefined
): SignupSurge[] {
  return signupSurges(data.signup_series, previous?.signup_series, {
    unit: signupUnit(data),
    end: range?.end ?? Number.POSITIVE_INFINITY,
    span: range ? range.end - range.start : undefined,
  })
}

/** The cohort the never-used share is read over. */
export type NeverUsed = {
  zero: number
  signups: number
  /** Only sign-ups at least 6 hours old. */
  mature: boolean
}

/** The never-used cohort: sign-ups old enough to have tried, when the server sends them. */
export function neverUsed(data: RiskInsights): NeverUsed {
  if (data.signups_mature != null && data.zero_use_mature != null) {
    return {
      zero: data.zero_use_mature,
      signups: data.signups_mature,
      mature: true,
    }
  }
  return { zero: data.zero_use_accounts, signups: data.signups, mature: false }
}

/**
 * Whether two never-used shares compare fairly: both cohorts hold at least
 * MIN_COHORT sign-ups, and either both leave out the youngest accounts or
 * the range is long enough that those do not dominate.
 */
export function neverUsedComparable(
  current: NeverUsed,
  previous: NeverUsed | undefined,
  hourly: boolean
): boolean {
  if (!previous) return false
  if (current.signups < MIN_COHORT || previous.signups < MIN_COHORT) {
    return false
  }
  if (current.mature && previous.mature) return true
  return !hourly
}

/** A count's change, or undefined when both periods are under MIN_SIGNAL_COUNT. */
export function signalDelta(
  current: number,
  previous: number | undefined
):
  | { current: number; previous: number | undefined; better: 'down' }
  | undefined {
  if (previous == null) return undefined
  if (current < MIN_SIGNAL_COUNT && previous < MIN_SIGNAL_COUNT) {
    return undefined
  }
  return { current, previous, better: 'down' }
}

/** Debtors past DEBT_ALERT_USD, deepest first. */
export function materialDebtors(
  debtors: BalanceUser[] | null | undefined
): BalanceUser[] {
  return (debtors ?? [])
    .filter((user) => user.balance_usd < DEBT_ALERT_USD)
    .sort((a, b) => a.balance_usd - b.balance_usd)
}

/** The ids of every account in a cluster. */
export function clusteredUserIds(clusters: RiskCluster[]): Set<number> {
  return new Set(
    clusters.flatMap((cluster) => cluster.users.map((user) => user.user_id))
  )
}
