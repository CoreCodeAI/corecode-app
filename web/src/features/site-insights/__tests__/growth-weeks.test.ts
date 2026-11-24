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

import {
  bestWeekOne,
  lostPayers,
  niceScale,
  signupMoneyDays,
  signupWeeks,
  weekRetentionRows,
} from '../growth-weeks'
import type { RetentionWeek } from '../types'

// Local midnights, so the weekday reads the same in any time zone. 2026-01-05 is a Monday.
const midnight = (offset: number) =>
  Math.floor(new Date(2026, 0, 5 + offset).getTime() / 1000)

const day = (offset: number, registered: number, paid = 0, activated = 0) => ({
  day: midnight(offset),
  registered,
  activated,
  paid,
})

describe('signup weeks', () => {
  it('groups days Monday to Sunday and marks a week the range holds in part', () => {
    const daily = [
      // Saturday and Sunday of the week before.
      day(-2, 1),
      day(-1, 2),
      // A whole week.
      ...Array.from({ length: 7 }, (_, index) => day(index, 3, 1, 2)),
      // One day of the next.
      day(7, 5),
    ]
    const weeks = signupWeeks(daily)
    expect(
      weeks.map((week) => [week.days, week.registered, week.partial])
    ).toEqual([
      [2, 3, true],
      [7, 21, false],
      [1, 5, true],
    ])
    expect(weeks[1]).toMatchObject({ activated: 14, paid: 7 })
    expect(weeks[1].start).toBe(midnight(0))
  })

  it('reads nothing from no days', () => {
    expect(signupWeeks([])).toEqual([])
  })
})

describe('niceScale', () => {
  it('rounds the top up to a round step and lists the ticks', () => {
    expect(niceScale(37)).toEqual({ top: 40, ticks: [0, 10, 20, 30, 40] })
    expect(niceScale(100)).toEqual({ top: 100, ticks: [0, 25, 50, 75, 100] })
  })

  it('keeps a usable axis for an empty series', () => {
    expect(niceScale(0)).toEqual({ top: 1, ticks: [0, 1] })
    expect(niceScale(Number.NaN)).toEqual({ top: 1, ticks: [0, 1] })
  })
})

describe('signupMoneyDays', () => {
  it('joins the money to its day and reads zero where the server sent none', () => {
    const daily = [day(0, 4), day(1, 2)]
    expect(
      signupMoneyDays(daily, [
        { day: midnight(1), money: 90, plan_money: 10, payers: 3 },
      ])
    ).toEqual([
      { day: midnight(0), registered: 4, money: 0, payers: 0 },
      { day: midnight(1), registered: 2, money: 90, payers: 3 },
    ])
  })

  it('draws the bars from a server that sends no top-ups', () => {
    expect(signupMoneyDays([day(0, 4)], undefined)[0]).toMatchObject({
      registered: 4,
      money: 0,
    })
  })
})

describe('lostPayers', () => {
  it('counts the accounts silent for a month or more, or never used', () => {
    expect(
      lostPayers({
        payers: 12,
        buckets: [
          { name: 'within_1d', count: 5 },
          { name: 'days_15_30', count: 2 },
          { name: 'days_31_60', count: 2 },
          { name: 'over_60', count: 1 },
          { name: 'never', count: 2 },
        ],
      })
    ).toBe(5)
    expect(lostPayers(undefined)).toBe(0)
  })
})

function week(
  start: number,
  size: number,
  active: number[],
  extra: Partial<RetentionWeek> = {}
): RetentionWeek {
  return {
    week: midnight(start),
    size,
    partial: false,
    active,
    activated: { size, active },
    paid: { size: 0, active: [] },
    ...extra,
  }
}

describe('weekly retention rows', () => {
  it('turns the counts into rates and marks the last reported week as live', () => {
    const [row] = weekRetentionRows([week(0, 40, [40, 20, 10])], 'all')
    expect(row.cells.map((cell) => cell?.rate)).toEqual([1, 0.5, 0.25])
    expect(row.cells.map((cell) => cell?.live)).toEqual([false, false, true])
  })

  it('reads the segment the reader picks', () => {
    const weeks = [week(0, 40, [40, 20], { paid: { size: 4, active: [4, 1] } })]
    const [row] = weekRetentionRows(weeks, 'paid')
    expect(row.size).toBe(4)
    expect(row.cells[1]?.rate).toBe(0.25)
  })

  it('leaves a segment with no sign-ups without cells to colour', () => {
    const [row] = weekRetentionRows([week(0, 40, [40, 20])], 'paid')
    expect(row.size).toBe(0)
    expect(row.cells).toEqual([])
  })

  it('skips a week whose segment the server does not send', () => {
    const old = {
      week: midnight(0),
      size: 4,
      partial: false,
      active: [4],
    } as RetentionWeek
    expect(weekRetentionRows([old], 'activated')).toEqual([])
    expect(weekRetentionRows(null, 'all')).toEqual([])
  })

  it('picks the best week one among weeks big enough and past their live week', () => {
    const rows = weekRetentionRows(
      [
        // Too small to judge.
        week(-14, 10, [10, 10, 10]),
        // Week one is still in progress.
        week(-7, 40, [40, 40]),
        week(-21, 40, [40, 10, 5]),
        week(-28, 40, [40, 20, 5]),
      ],
      'all'
    )
    const best = bestWeekOne(rows, 30)
    expect(best?.rate).toBe(0.5)
    expect(best?.row.week).toBe(midnight(-28))
    expect(bestWeekOne([], 30)).toBeUndefined()
  })
})
