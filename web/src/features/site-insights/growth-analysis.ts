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
import { MIN_COHORT } from './lib'
import type { ActivityInsights, FunnelRow, GrowthHour } from './types'

/** The share of a range's sign-ups in one hour that reads as a burst. */
export const BURST_SHARE = 0.25

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

/** The length of a range in whole hours, so its hour keys line up with the previous period's. */
export function hourSpan(range: { start: number; end: number }): number {
  return Math.round((range.end - range.start) / 3600) * 3600
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
