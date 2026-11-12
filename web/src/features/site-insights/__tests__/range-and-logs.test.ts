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

import { beforeLogs, hourBars } from '../analysis'
import {
  hourStart,
  loggedDays,
  previousBeforeLogs,
  previousRange,
  rangeHours,
  rangeReachesBeforeLogs,
  rangeSpan,
  rangeStart,
  type InsightsRangeInfo,
} from '../lib'

const HOUR = 3600
const DAY = 86400
// 2027-01-15 00:00 UTC, then 18:20:34 that day, the time a page is read.
const MIDNIGHT = 1_799_971_200
const NOW = MIDNIGHT + 18 * HOUR + 1234

function range(start: number, end: number, days: number): InsightsRangeInfo {
  return { start, end, days, hourly: days <= 3 }
}

describe('whole-hour ranges', () => {
  it('floors the top of a range to the hour it starts in', () => {
    // One day back from 18:20:34 is 18:20:34 the day before; its hour is 18:00.
    expect(rangeStart(NOW, 1)).toBe(MIDNIGHT - DAY + 18 * HOUR)
    expect(hourStart(NOW)).toBe(MIDNIGHT + 18 * HOUR)
    // A range that starts exactly on the hour is unchanged.
    expect(rangeStart(MIDNIGHT + 18 * HOUR, 1)).toBe(MIDNIGHT - DAY + 18 * HOUR)
  })

  it('counts a range in whole days and its hours, the first one included', () => {
    const current = range(rangeStart(NOW, 1), NOW, 1)
    expect(rangeSpan(current)).toBe(DAY)
    // The first hour, 23 closed hours and the hour still filling.
    expect(rangeHours(current)).toBe(25)
  })

  it('ends the previous period where the range starts, with the same span', () => {
    const current = range(rangeStart(NOW, 2), NOW, 2)
    const previous = previousRange(current)
    expect(previous.end_time).toBe(current.start)
    expect(current.start - previous.start_time).toBe(2 * DAY)
    // The two periods share no hour.
    expect(previous.end_time).toBeLessThanOrEqual(current.start)
  })
})

describe('logs that begin partway through the range', () => {
  const start = MIDNIGHT - DAY
  const end = MIDNIGHT + 18 * HOUR

  it('says a range reaches before the logs only when it starts before them', () => {
    expect(rangeReachesBeforeLogs({ start }, start + HOUR)).toBe(true)
    expect(rangeReachesBeforeLogs({ start }, start)).toBe(false)
    expect(rangeReachesBeforeLogs({ start }, null)).toBe(false)
    // Zero means the log table is empty, so nothing is before the logs.
    expect(rangeReachesBeforeLogs({ start }, 0)).toBe(false)
  })

  it('says the previous period is wholly before the logs when it ends by them', () => {
    expect(previousBeforeLogs({ start }, start)).toBe(true)
    expect(previousBeforeLogs({ start }, start - 1)).toBe(false)
    expect(previousBeforeLogs({ start }, undefined)).toBe(false)
  })

  it('counts the days that have logs, a day the logs begin in included', () => {
    const current = range(start, end, 1)
    expect(loggedDays(current, null)).toBe(1)
    // Logs begin at 05:00 of the second day, so that day and the last have logs.
    expect(loggedDays(range(0, 3 * DAY, 3), DAY + 5 * HOUR)).toBe(2)
    expect(loggedDays(range(0, 3 * DAY, 3), 2 * DAY + 1)).toBe(1)
    expect(loggedDays(range(0, 3 * DAY, 3), 3 * DAY)).toBe(0)
    expect(loggedDays(range(0, 3 * DAY, 3), 0)).toBe(3)
  })

  it('marks a bucket missing only when it ends by the logs', () => {
    expect(beforeLogs(0, HOUR, HOUR)).toBe(true)
    expect(beforeLogs(0, HOUR, HOUR - 1)).toBe(false)
    expect(beforeLogs(0, HOUR, 0)).toBe(false)
    expect(beforeLogs(0, HOUR, undefined)).toBe(false)
  })
})

describe('hour bars before the logs', () => {
  const axis = { title: () => 'hour', axis: () => undefined }
  const rows = [{ hour: 0 }, { hour: HOUR }, { hour: 2 * HOUR }]

  it('draws an hour before the logs as missing, and the open hour as faded', () => {
    const bars = hourBars(
      rows,
      2 * HOUR + 1800,
      () => ({ values: [1] }),
      axis,
      HOUR + 1
    )
    expect(bars.map((bar) => bar.missing)).toEqual([true, false, false])
    expect(bars.map((bar) => bar.faded)).toEqual([false, false, true])
  })

  it('marks nothing without logs_since', () => {
    const bars = hourBars(rows, 3 * HOUR, () => ({ values: [1] }), axis)
    expect(bars.map((bar) => bar.missing)).toEqual([false, false, false])
  })
})
