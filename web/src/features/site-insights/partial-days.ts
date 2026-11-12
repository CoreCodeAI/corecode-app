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
import { createContext, useContext } from 'react'
import { useTranslation } from 'react-i18next'

import type { InsightsView } from './api'
import { rangeStart, useInsightsFormat } from './lib'

/**
 * A range runs from a moment N days before its end to the moment it was
 * read, so its first and last days are only partly inside it, and both read
 * low beside the whole days between them.
 */
export type PartialMark = {
  /** Which part of the day the point covers, for its readout. */
  note: string
  /**
   * Per series, what the whole day is expected to come to. Absent for a
   * rate or a level, and when too little of a typical day is covered to
   * project from.
   */
  projected?: number[]
}

/**
 * The end of the ranges on the page, how many days each view reads, and the
 * day profile's share of requests in each UTC hour (empty until it loads, or
 * when the server has none).
 */
export const InsightsSpanContext = createContext<{
  now: number
  days: (view: InsightsView) => number
  hours: number[]
} | null>(null)

/**
 * Below this share of a typical day's requests, a part of a day says too
 * little about the whole to project it: at 01:00 a single order would
 * project to dozens.
 */
export const MIN_PROJECTED_SHARE = 0.15

/**
 * The share of a typical day's requests that falls in [from, to), unix
 * seconds, by the profile's share for each UTC hour; part of an hour counts
 * in proportion.
 */
export function dayShare(hours: number[], from: number, to: number) {
  let share = 0
  let at = from
  while (at < to) {
    const hourStart = at - (((at % 3600) + 3600) % 3600)
    const next = Math.min(hourStart + 3600, to)
    const hour = Math.floor((((hourStart % 86400) + 86400) % 86400) / 3600)
    share += ((hours[hour] ?? 0) * (next - at)) / 3600
    at = next
  }
  return share
}

/**
 * Marks the days a view's range covers only in part. The returned function
 * takes a day's start and, for amounts the day adds up, its values; it
 * returns undefined for a whole day. Amounts are projected to the whole day
 * by the share of a typical day's requests the covered part holds; rates,
 * levels and counts of distinct users are only marked.
 */
export function usePartialDays(view: InsightsView) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const span = useContext(InsightsSpanContext)
  return (day: number, values?: number[]): PartialMark | undefined => {
    if (!span) return undefined
    // The range starts on the hour, as the server floors it, so its first
    // day is partly inside it by the hours that count.
    const start = rangeStart(span.now, span.days(view))
    const end = day + 86400
    const from = Math.max(day, start)
    const to = Math.min(end, span.now)
    if (from === day && to === end) return undefined
    const note =
      to < end
        ? t('In progress, through {{time}}', { time: fmt.clock(to) })
        : t('Partial, from {{time}}', { time: fmt.clock(from) })
    if (!values || span.hours.length === 0) return { note }
    const share = dayShare(span.hours, from, to)
    if (share < MIN_PROJECTED_SHARE || share >= 1) return { note }
    return { note, projected: values.map((value) => value / share) }
  }
}
