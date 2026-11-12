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
// Pure analysis for the growth and activity tabs: which segment moved
// sign-ups, whether they came in one burst, which customers moved
// consumption, and engagement read from the last full day.

import { closedHours, contributions, type Contribution } from './analysis'
import {
  MIN_COHORT,
  rangeSpan,
  type InsightsRangeInfo,
  type SourceState,
} from './lib'
import type {
  ActivityInsights,
  FunnelRow,
  GrowthHour,
  GrowthInsights,
} from './types'

/** Whether a view's figures are here, still loading, or could not be read. */
export type ViewState = 'ready' | 'loading' | 'error'

/**
 * A view's state from its data and query. Without a query state (a caller
 * that passes none), missing data reads as loading.
 */
export function viewState(
  data: unknown,
  source: SourceState | undefined
): ViewState {
  if (data != null) return 'ready'
  return source?.status === 'error' ? 'error' : 'loading'
}

/** Claude's charge set against its official cost from corecode-engine. */
export type ClaudeCoverage = {
  /** Quota dollars, which customers pay ¥1 each for, so yuan. */
  charged: number
  /** US dollars at Anthropic's official prices. */
  official: number
  /** False on an older server, whose charge covers every model. */
  claudeOnly: boolean
}

/**
 * Claude's charge on the days the engine reported, against the engine's
 * official cost, or null without an engine cost. An older server sends no
 * Claude charge, and the whole range's charge for every model stands in.
 */
export function claudeCoverage(
  data: ActivityInsights | undefined
): ClaudeCoverage | null {
  const engine = data?.engine_cost
  if (!data || !engine?.configured || engine.error || engine.cost_usd <= 0) {
    return null
  }
  if (data.claude_quota_usd == null) {
    return {
      charged: data.quota_usd,
      official: engine.cost_usd,
      claudeOnly: false,
    }
  }
  const reported = new Set(engine.daily.map((day) => day.day))
  const charged = data.daily.reduce(
    (sum, day) =>
      reported.has(day.day) ? sum + (day.claude_quota_usd ?? 0) : sum,
    0
  )
  return { charged, official: engine.cost_usd, claudeOnly: true }
}

/** Whether the day from dayStart had not ended by the range's end. */
export function dayInProgress(dayStart: number, end: number): boolean {
  return dayStart + 86400 > end
}

/** The share of a range's sign-ups in one hour that reads as a burst. */
export const BURST_SHARE = 0.25

/** Hours a sign-up must be old before its activation and payment can show. */
export const MATURE_HOURS = 6

/** Sign-up counts for a cohort: the accounts, and how many of them activated or paid. */
export type Cohort = { registered: number; activated: number; paid: number }

/**
 * The sign-ups of the whole days that ended at least MATURE_HOURS before the
 * range's end, so that a day of sign-ups hours old does not read as a poor
 * activation. Null for an hourly range, which has no daily cohorts.
 */
export function matureCohort(
  daily: GrowthInsights['daily'] | null | undefined,
  range: InsightsRangeInfo | undefined
): Cohort | null {
  if (!range || range.hourly || !daily) return null
  const cutoff = range.end - MATURE_HOURS * 3600
  const cohort = { registered: 0, activated: 0, paid: 0 }
  for (const row of daily) {
    if (row.day + 86400 > cutoff) continue
    cohort.registered += row.registered
    cohort.activated += row.activated
    cohort.paid += row.paid
  }
  return cohort
}

/**
 * The cohort that activation and payment rates are judged on, and how many of
 * the range's sign-ups it leaves out as too young. The card and the verdict
 * both read this, so they show the same rate. An hourly range has no matured
 * days: it judges every sign-up, and its rates read as so far.
 */
export function judgedCohort(
  funnel: FunnelRow,
  daily: GrowthInsights['daily'] | null | undefined,
  range: InsightsRangeInfo | undefined
): { cohort: Cohort; young: number } {
  const cohort = matureCohort(daily, range) ?? funnel
  return {
    cohort,
    young: Math.max(funnel.registered - cohort.registered, 0),
  }
}

/** The previous period of a range, as the window its days are read from. */
export function previousWindow(range: InsightsRangeInfo): {
  start: number
  end: number
} {
  return { start: range.start - rangeSpan(range), end: range.start }
}

/** How many customers the server lists in top_users. */
export const TOP_USERS_LISTED = 20

/** Each segment's change in sign-ups against the previous period, largest first. */
export function segmentChanges(
  current: FunnelRow[] | null | undefined,
  previous: FunnelRow[] | null | undefined
): Contribution[] {
  return contributions(
    current,
    previous,
    (row) => row.segment,
    (row) => row.registered
  )
}

/**
 * The hour that holds at least BURST_SHARE of at least MIN_COHORT sign-ups,
 * or null. The open hour counts: its sign-ups have happened.
 */
export function signupBurst(
  rows: GrowthHour[] | null | undefined
): { hour: number; registered: number; share: number } | null {
  const list = rows ?? []
  const total = list.reduce((sum, row) => sum + row.registered, 0)
  if (total < MIN_COHORT) return null
  let peak: GrowthHour | undefined
  for (const row of list) {
    if (!peak || row.registered > peak.registered) peak = row
  }
  if (!peak || peak.registered / total < BURST_SHARE) return null
  return {
    hour: peak.hour,
    registered: peak.registered,
    share: peak.registered / total,
  }
}

/** The closed hour with the largest value above 0, or undefined. */
export function busiestHour<T extends { hour: number }>(
  rows: T[] | null | undefined,
  end: number,
  value: (row: T) => number
): T | undefined {
  let top: T | undefined
  for (const row of closedHours(rows ?? [], end)) {
    if (value(row) > 0 && (!top || value(row) > value(top))) top = row
  }
  return top
}

type TopUser = ActivityInsights['top_users'][number]

/** One customer's consumption in both periods, in yuan. */
export type CustomerMove = Contribution & {
  user_id: number
  username: string
  /** Not in the previous period's list. */
  entered: boolean
  /** In the previous period's list, not in this one's. */
  left: boolean
}

/**
 * Each listed customer's change in consumption, largest first. A customer
 * missing from a full list consumed at most that list's smallest figure and
 * counts as that, so its change is the least it can be; missing from a list
 * shorter than the server's limit, it consumed nothing.
 */
export function customerMoves(
  current: TopUser[] | null | undefined,
  previous: TopUser[] | null | undefined
): CustomerMove[] {
  const now = current ?? []
  const before = previous ?? []
  const floor = (rows: TopUser[]) =>
    rows.length >= TOP_USERS_LISTED
      ? Math.min(...rows.map((row) => row.quota_usd))
      : 0
  const nowFloor = floor(now)
  const beforeFloor = floor(before)
  const nowById = new Map(now.map((row) => [row.user_id, row]))
  const beforeById = new Map(before.map((row) => [row.user_id, row]))
  const ids = [...new Set([...nowById.keys(), ...beforeById.keys()])]
  return ids
    .map((id) => {
      const a = nowById.get(id)
      const b = beforeById.get(id)
      const currentValue = a ? a.quota_usd : nowFloor
      const previousValue = b ? b.quota_usd : beforeFloor
      return {
        key: String(id),
        user_id: id,
        username: a?.username || b?.username || '',
        current: currentValue,
        previous: previousValue,
        change: currentValue - previousValue,
        entered: !b,
        left: !a,
      }
    })
    .sort(
      (x, y) => Math.abs(y.change) - Math.abs(x.change) || x.user_id - y.user_id
    )
}

type ActivityDay = ActivityInsights['daily'][number]

/**
 * The last calendar day wholly inside the range, or undefined when none is.
 * Without a range, the last day listed.
 */
export function lastFullDay(
  daily: ActivityDay[] | null | undefined,
  range?: { start: number; end: number }
): ActivityDay | undefined {
  const days = daily ?? []
  if (!range) return days.at(-1)
  // A calendar day lasts 23 to 25 hours; the next day's start ends it.
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index]
    const next = days[index + 1]?.day ?? day.day + 86400
    if (day.day >= range.start && next <= range.end) return day
  }
  return undefined
}

/** DAU over WAU, or null without weekly users. */
export function stickiness(dau: number, wau: number): number | null {
  if (wau <= 0) return null
  return dau / wau
}

/** Consumption per active user, in yuan, or undefined without active users. */
export function perActiveUser(
  data: Pick<ActivityInsights, 'quota_usd' | 'active_users'> | undefined
): number | undefined {
  if (!data || data.active_users <= 0) return undefined
  return data.quota_usd / data.active_users
}
