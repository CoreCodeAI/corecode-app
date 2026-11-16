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
import { MIN_COHORT } from './lib'
import type { ActivityInsights } from './types'

/** Which sign-ups a retention row counts: every sign-up, the ones who made a request, or the ones who paid. */
export type RetentionSegmentKey = 'all' | 'activated' | 'paid'

/** A range longer than this shows its sign-up days grouped by week. */
const WEEKLY_SPAN = 14 * 86400
const WEEK = 7 * 86400

export type RetentionCohort = ActivityInsights['retention'][number]

/** One row of the table: a sign-up day, or the sign-up days of one week pooled. */
export type RetentionRow = {
  /** The first sign-up day of the row, unix seconds. */
  start: number
  /** The last sign-up day of the row. */
  last: number
  /** The sign-up days the row covers: one, or up to seven. */
  days: number
  /** A week of fewer than seven sign-up days, which the range cut short. */
  partial: boolean
  /** The sign-ups of the segment. */
  size: number
  /**
   * The share of the sign-ups active on each day N after sign-up, pooled over
   * the sign-up days that have reached day N. Null where none has.
   */
  rates: (number | null)[]
  /** The users active on each day, the numerators of rates; null when the server sends no counts. */
  counts: (number | null)[] | null
}

type Part = { size: number; active: number[] | null; days: number[] | null }

/** The segment's sign-ups and counts of a cohort, or undefined when the server does not send that segment. */
function partOf(
  cohort: RetentionCohort,
  key: RetentionSegmentKey
): Part | undefined {
  if (key === 'all') {
    return {
      size: cohort.size,
      active: cohort.active ?? null,
      days: cohort.days,
    }
  }
  const segment = cohort[key]
  if (!segment) return undefined
  return { size: segment.size, active: segment.active, days: null }
}

/** Whether the server sends the counts (and so the activated and paid parts) for every cohort. */
export function retentionHasSegments(cohorts: RetentionCohort[]): boolean {
  return cohorts.every((cohort) => cohort.activated && cohort.paid)
}

function rowOf(
  members: { cohort: RetentionCohort; part: Part }[],
  partial: boolean
): RetentionRow {
  const width = Math.max(
    0,
    ...members.map(({ part }) => part.active?.length ?? part.days?.length ?? 0)
  )
  const withCounts = members.every(({ part }) => part.active !== null)
  const rates: (number | null)[] = []
  const counts: (number | null)[] = []
  for (let day = 0; day < width; day++) {
    let hits = 0
    let base = 0
    for (const { part } of members) {
      if (part.active) {
        if (day < part.active.length) {
          hits += part.active[day]
          base += part.size
        }
      } else if (part.days && day < part.days.length) {
        hits += part.days[day] * part.size
        base += part.size
      }
    }
    rates.push(base > 0 ? hits / base : null)
    counts.push(withCounts && base > 0 ? hits : null)
  }
  const days = members.map(({ cohort }) => cohort.day)
  return {
    start: Math.min(...days),
    last: Math.max(...days),
    days: members.length,
    partial,
    size: members.reduce((sum, { part }) => sum + part.size, 0),
    rates,
    counts: withCounts ? counts : null,
  }
}

/**
 * The table's rows for one segment, newest first. A range longer than two
 * weeks groups the sign-up days by week, counting from the oldest sign-up
 * day; the week that holds fewer than seven days is partial.
 */
export function retentionRows(
  cohorts: RetentionCohort[],
  key: RetentionSegmentKey,
  weekly: boolean
): RetentionRow[] {
  const parts = cohorts.flatMap((cohort) => {
    const part = partOf(cohort, key)
    return part ? [{ cohort, part }] : []
  })
  if (!weekly) {
    return parts
      .map(({ cohort, part }) => rowOf([{ cohort, part }], false))
      .sort((a, b) => b.start - a.start)
  }
  if (parts.length === 0) return []
  const first = Math.min(...parts.map(({ cohort }) => cohort.day))
  const weeks = new Map<number, { cohort: RetentionCohort; part: Part }[]>()
  for (const member of parts) {
    const week = Math.floor((member.cohort.day - first) / WEEK)
    weeks.set(week, [...(weeks.get(week) ?? []), member])
  }
  return [...weeks.values()]
    .map((members) => rowOf(members, members.length < 7))
    .sort((a, b) => b.start - a.start)
}

/** Whether a row's sign-ups are too few to colour its rates. */
export function retentionFloorBelow(row: RetentionRow): boolean {
  return row.size < MIN_COHORT
}

/** The row with the highest D7 rate among rows above the floor, newest on a tie. */
export function bestRetentionD7(
  rows: RetentionRow[]
): { row: RetentionRow; rate: number } | undefined {
  let best: { row: RetentionRow; rate: number } | undefined
  for (const row of rows) {
    const rate = row.rates[7]
    if (rate == null || retentionFloorBelow(row)) continue
    if (!best || rate > best.rate) best = { row, rate }
  }
  return best
}

/** Whether the range is long enough to group its sign-up days by week. */
export function retentionIsWeekly(range?: { start: number; end: number }) {
  return !!range && range.end - range.start > WEEKLY_SPAN
}
