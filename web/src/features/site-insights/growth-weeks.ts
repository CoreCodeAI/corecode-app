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
import type {
  GrowthInsights,
  GrowthTopupDay,
  RetentionSegment,
  RetentionWeek,
  SilentPayers,
} from './types'

const DAY = 86400

/** The sign-ups of one week, Monday to Sunday in the viewer's time zone. */
export type SignupWeek = {
  /** The Monday the week starts on, unix seconds. */
  start: number
  /** How many of its seven days the range holds. */
  days: number
  registered: number
  activated: number
  paid: number
  /** The range holds fewer than seven days of it. */
  partial: boolean
}

/**
 * The daily sign-ups grouped by week, oldest first. A day's start is the
 * viewer's midnight, so its weekday is read in the viewer's time zone too.
 */
export function signupWeeks(daily: GrowthInsights['daily']): SignupWeek[] {
  const weeks = new Map<number, SignupWeek>()
  for (const day of daily) {
    const weekday = (new Date(day.day * 1000).getDay() + 6) % 7
    const start = day.day - weekday * DAY
    const week = weeks.get(start) ?? {
      start,
      days: 0,
      registered: 0,
      activated: 0,
      paid: 0,
      partial: false,
    }
    week.days += 1
    week.registered += day.registered
    week.activated += day.activated
    week.paid += day.paid
    weeks.set(start, week)
  }
  return [...weeks.values()]
    .map((week) => ({ ...week, partial: week.days < 7 }))
    .sort((a, b) => a.start - b.start)
}

/** The smallest round step (1, 2, 2.5 or 5 × 10^n) at least value. */
function niceStep(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= value) ?? 10
  return step * magnitude
}

/** An axis from 0 to a round top, with `ticks` steps. */
export function niceScale(max: number, ticks = 4) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] }
  const step = niceStep(max / ticks)
  const top = Math.ceil(max / step) * step
  return {
    top,
    ticks: Array.from(
      { length: Math.round(top / step) + 1 },
      (_, index) => index * step
    ),
  }
}

/** One day of the sign-ups and top-up chart. */
export type SignupMoneyDay = {
  day: number
  registered: number
  money: number
  payers: number
}

/**
 * Each day's sign-ups with the money paid that day. A day the server sends no
 * top-up for reads zero money, so an older server still draws the bars.
 */
export function signupMoneyDays(
  daily: GrowthInsights['daily'],
  topups: GrowthTopupDay[] | null | undefined
): SignupMoneyDay[] {
  const money = new Map((topups ?? []).map((day) => [day.day, day]))
  return daily.map((day) => ({
    day: day.day,
    registered: day.registered,
    money: money.get(day.day)?.money ?? 0,
    payers: money.get(day.day)?.payers ?? 0,
  }))
}

/** Buckets of silent payers that count as lost: a month or more without a request, or never. */
export const LOST_BUCKETS: SilentPayers['buckets'][number]['name'][] = [
  'days_31_60',
  'over_60',
  'never',
]

/** How many paying accounts have been silent for a month or more. */
export function lostPayers(silent: SilentPayers | null | undefined) {
  return (silent?.buckets ?? [])
    .filter((bucket) => LOST_BUCKETS.includes(bucket.name))
    .reduce((sum, bucket) => sum + bucket.count, 0)
}

/** A cell of the weekly retention table: the share of a week's sign-ups active n weeks later. */
export type WeekCell = {
  rate: number
  count: number
  /** The week that cell reads is the current one, still in progress. */
  live: boolean
}

export type WeekRetentionRow = {
  week: number
  size: number
  partial: boolean
  cells: (WeekCell | null)[]
}

export type WeekSegmentKey = 'all' | 'activated' | 'paid'

/** The segment's size and counts of a week; undefined when the server sends none. */
function segmentOf(
  week: RetentionWeek,
  key: WeekSegmentKey
): { size: number; active: number[] | null } | undefined {
  if (key === 'all') return { size: week.size, active: week.active }
  const segment: RetentionSegment | undefined = week[key]
  return segment ? { size: segment.size, active: segment.active } : undefined
}

/** The weeks' rows for one segment, newest week first as the server sends them. */
export function weekRetentionRows(
  weeks: RetentionWeek[] | null | undefined,
  key: WeekSegmentKey
): WeekRetentionRow[] {
  return (weeks ?? []).flatMap((week) => {
    const part = segmentOf(week, key)
    if (!part) return []
    const last = (part.active?.length ?? 0) - 1
    const cells = (part.active ?? []).map((count, index) => ({
      rate: part.size > 0 ? count / part.size : 0,
      count,
      // The last reported week is the range's last, still filling.
      live: index === last,
    }))
    return [
      {
        week: week.week,
        size: part.size,
        partial: week.partial,
        cells: part.size > 0 ? cells : cells.map(() => null),
      },
    ]
  })
}

/** The best week-1 retention among weeks of at least `floor` sign-ups. */
export function bestWeekOne(rows: WeekRetentionRow[], floor: number) {
  let best: { row: WeekRetentionRow; rate: number } | undefined
  for (const row of rows) {
    const cell = row.cells[1]
    if (!cell || cell.live || row.size < floor) continue
    if (!best || cell.rate > best.rate) best = { row, rate: cell.rate }
  }
  return best
}
