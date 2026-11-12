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
import type {
  BalanceUser,
  CountPoint,
  RiskInsights,
  UnpaidSpender,
} from '../types'

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
  /**
   * buyers counts only recent buyers of one-per-user plans, as the server
   * has since its release; before, it counted any plan ever bought.
   */
  limited: boolean
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
  const fresh =
    start == null
      ? (cluster.new_members ?? 0)
      : created.filter((at) => at >= start).length
  const burst = largestBurst(created)
  const buyers = cluster.subscription_buyers
  const limited = cluster.shared_exit != null
  const empty = cluster.users.filter(
    (user) =>
      !user.paid && !user.subscription && user.balance_usd <= EMPTY_BALANCE_USD
  ).length
  const allPaid = cluster.users.every((user) => user.paid || user.subscription)
  let score = 2 * fresh + empty
  if (burst > 1) score += 2 * burst
  if (buyers > 1) score += 3 * buyers
  if (allPaid) score /= 4
  return { fresh, burst, buyers, limited, empty, allPaid, score }
}

/**
 * The shared addresses split into those to review and the shared exits
 * (proxies, offices, campus networks), which the server marks and which
 * stay out of every count and the verdict.
 */
export function splitExits(clusters: RiskCluster[]): {
  review: RiskCluster[]
  exits: RiskCluster[]
} {
  return {
    review: clusters.filter((cluster) => !cluster.shared_exit),
    exits: clusters.filter((cluster) => !!cluster.shared_exit),
  }
}

/**
 * The clusters a response's shared_exit_top is shown through: the same
 * viewer and size rules as shared_ips (useSharedAddresses). Undefined before
 * the server sends the list.
 */
export function sharedExitSource(
  data: RiskInsights | undefined
): RiskInsights | undefined {
  if (data?.shared_exit_top == null) return undefined
  return { ...data, shared_ips: data.shared_exit_top }
}

/**
 * The shared exits to list, in the order the server ranks them. Once the
 * server sends shared_exit_top it is the list; an older server keeps exits
 * among shared_ips, so they are split out there.
 */
export function exitsOf(
  data: RiskInsights | undefined,
  clusters: RiskCluster[],
  topExits: RiskCluster[]
): RiskCluster[] {
  return data?.shared_exit_top != null ? topExits : splitExits(clusters).exits
}

/** How many shared addresses there are in all against how many are listed. */
export type SharedCounts = {
  /** Addresses to review in all, before the server's cut to 50. */
  total: number
  /** Of them, the ones in the response. */
  listed: number
  /** Shared exits in all, and how many are in the response. */
  exits: number
  exitsListed: number
}

/**
 * The shared-address counts of a response, its listed clusters already
 * filtered (useSharedAddresses), and its listed exits when the server sends
 * them apart. The server's total counts exits too, so the addresses to review
 * are the total less the exits. Before the server sends its totals the list
 * is all there is; a total never reads under what is listed.
 */
export function sharedCounts(
  data: Pick<RiskInsights, 'shared_ip_total' | 'shared_exits'> | undefined,
  clusters: RiskCluster[],
  exitList?: RiskCluster[]
): SharedCounts {
  const split = splitExits(clusters)
  const listed = split.review.length
  const exitsListed = exitList?.length ?? split.exits.length
  if (data?.shared_ip_total == null) {
    return { total: listed, listed, exits: exitsListed, exitsListed }
  }
  const exits = Math.max(data.shared_exits ?? 0, exitsListed)
  return {
    total: Math.max(data.shared_ip_total - exits, listed),
    listed,
    exits,
    exitsListed,
  }
}

/** Whether an address to review has several plan buyers: the danger signal. */
export function hasRepeatBuyers(clusters: RiskCluster[]): boolean {
  return splitExits(clusters).review.some(
    (cluster) => cluster.subscription_buyers > 1
  )
}

/** Clusters with their risk, in the order given. */
export function withRisk(
  clusters: RiskCluster[],
  start: number | undefined
): RankedCluster[] {
  return clusters.map((cluster) => ({
    ...cluster,
    risk: clusterRisk(cluster, start),
  }))
}

/** Clusters by risk, highest first; ties by size, then requests, then address. */
export function rankClusters(
  clusters: RiskCluster[],
  start: number | undefined
): RankedCluster[] {
  return withRisk(clusters, start).sort(
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
  /** Of zero, those whose every request failed; absent before the server's release. */
  failed?: number
}

/** The never-used cohort: sign-ups old enough to have tried, when the server sends them. */
export function neverUsed(data: RiskInsights): NeverUsed {
  if (data.signups_mature != null && data.zero_use_mature != null) {
    const cohort: NeverUsed = {
      zero: data.zero_use_mature,
      signups: data.signups_mature,
      mature: true,
    }
    if (data.zero_use_failed_mature != null) {
      cohort.failed = data.zero_use_failed_mature
    }
    return cohort
  }
  const cohort: NeverUsed = {
    zero: data.zero_use_accounts,
    signups: data.signups,
    mature: false,
  }
  if (data.zero_use_failed != null) cohort.failed = data.zero_use_failed
  return cohort
}

/** Unpaid consumption by source, in quota dollars; they sum to the spend. */
export type UnpaidSplit = {
  granted: number
  redeemed: number
  gift: number
  signupGift: number
}

/** Sign-ups that consumed in the range and never paid, in quota dollars. */
export type UnpaidSpend = {
  spenders: number
  unpaid: number
  spend: number
  /** unpaid over spenders; 0 without spenders. */
  share: number
  /** Absent before the server splits the spend by source. */
  split?: UnpaidSplit
}

/** The unpaid spenders of a response; undefined before the server's release. */
export function unpaidSpend(
  data: RiskInsights | undefined
): UnpaidSpend | undefined {
  if (data?.signup_spenders == null || data.unpaid_spenders == null) {
    return undefined
  }
  const spenders = data.signup_spenders
  const unpaid = data.unpaid_spenders
  const spend: UnpaidSpend = {
    spenders,
    unpaid,
    spend: data.unpaid_spend_usd ?? 0,
    share: spenders > 0 ? unpaid / spenders : 0,
  }
  if (
    data.unpaid_granted_usd != null &&
    data.unpaid_redeemed_usd != null &&
    data.unpaid_gift_plan_usd != null &&
    data.unpaid_signup_gift_usd != null
  ) {
    spend.split = {
      granted: data.unpaid_granted_usd,
      redeemed: data.unpaid_redeemed_usd,
      gift: data.unpaid_gift_plan_usd,
      signupGift: data.unpaid_signup_gift_usd,
    }
  }
  return spend
}

/** The share of unpaid spend that an administrator granted by hand; 0 without a split. */
export function grantedShare(spend: UnpaidSpend | undefined): number {
  if (!spend?.split || spend.spend <= 0) return 0
  return spend.split.granted / spend.spend
}

/**
 * Whether an account's hand grant covers more than half its consumption: it
 * was funded by an administrator, so it does not read as farming. Absent
 * before the server sends the split.
 */
export function isHandFunded(row: UnpaidSpender): boolean {
  return (
    row.granted_usd != null &&
    row.consumption_usd > 0 &&
    row.granted_usd * 2 > row.consumption_usd
  )
}

/** Invite gift statuses the guard refused; email_signup is policy, not a block. */
export const GIFT_BLOCKS: readonly string[] = [
  'ip_used',
  'cap_reached',
  'email_blocked',
]

/** Invite gift claims in the range and how many were blocked; undefined before the server's release. */
export function giftOutcomes(
  data: RiskInsights | undefined
): { total: number; blocked: number; gifted: number } | undefined {
  if (data?.signup_gifts == null) return undefined
  let total = 0
  let blocked = 0
  let gifted = 0
  for (const item of data.signup_gifts) {
    total += item.count
    if (GIFT_BLOCKS.includes(item.name)) blocked += item.count
    if (item.name === 'gifted') gifted += item.count
  }
  return { total, blocked, gifted }
}

/** One inviter of unpaid spenders, as the risk view sends it. */
export type UnpaidInviter = NonNullable<RiskInsights['unpaid_inviters']>[number]

/**
 * Whether an inviter's unpaid spenders got any gift credit. Credit an
 * administrator granted by hand is not farming, so an inviter whose gift part
 * is 0 is not judged; before the server sends gift_usd every inviter is.
 */
export function hasGiftPart(row: UnpaidInviter): boolean {
  return row.gift_usd == null || row.gift_usd > 0
}

/** Whether the unpaid spend is split by source, so farming is judged on gifts. */
export function usesGiftPart(data: RiskInsights | undefined): boolean {
  return data?.unpaid_signup_gift_usd != null
}

/**
 * Inviters worth a look: MIN_SIGNAL_COUNT or more unpaid spenders on gift
 * credit, or as many gifts blocked, in the range.
 */
export function suspectInviters(data: RiskInsights | undefined): {
  unpaid: number
  blocked: number
} {
  return {
    unpaid: (data?.unpaid_inviters ?? []).filter(
      (row) =>
        row.user_id > 0 && row.accounts >= MIN_SIGNAL_COUNT && hasGiftPart(row)
    ).length,
    blocked: (data?.gift_block_inviters ?? []).filter(
      (row) => row.user_id > 0 && row.blocked >= MIN_SIGNAL_COUNT
    ).length,
  }
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
