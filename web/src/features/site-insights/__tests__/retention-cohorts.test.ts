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
  bestRetentionD7,
  retentionFloorBelow,
  retentionHasSegments,
  retentionIsWeekly,
  retentionRows,
  type RetentionCohort,
} from '../retention-cohorts'

const DAY = 86400
const day = (offset: number) => 1761408000 + offset * DAY

/** A cohort of `size` sign-ups whose active counts are given per day after sign-up. */
function cohort(
  offset: number,
  size: number,
  active: number[],
  activated: { size: number; active: number[] },
  paid: { size: number; active: number[] }
): RetentionCohort {
  return {
    day: day(offset),
    size,
    days: active.map((count) => count / size),
    active,
    activated,
    paid,
  }
}

describe('retention rows', () => {
  it('reads each segment’s rates from its own counts, so the paid part is not the whole cohort', () => {
    const cohorts = [
      cohort(
        0,
        40,
        [20, 10],
        { size: 10, active: [8, 2] },
        { size: 4, active: [1, 0] }
      ),
    ]
    expect(retentionRows(cohorts, 'all', false)[0].rates).toEqual([0.5, 0.25])
    expect(retentionRows(cohorts, 'activated', false)[0].rates).toEqual([
      0.8, 0.2,
    ])
    expect(retentionRows(cohorts, 'paid', false)[0].rates).toEqual([0.25, 0])
    expect(retentionRows(cohorts, 'paid', false)[0].counts).toEqual([1, 0])
  })

  it('mutes a row whose sign-ups are under the cohort floor', () => {
    const small = cohort(
      0,
      19,
      [5],
      { size: 2, active: [1] },
      { size: 0, active: [] }
    )
    const large = cohort(
      1,
      20,
      [5],
      { size: 2, active: [1] },
      { size: 0, active: [] }
    )
    expect(
      retentionRows([small], 'all', false).map(retentionFloorBelow)
    ).toEqual([true])
    expect(
      retentionRows([large], 'all', false).map(retentionFloorBelow)
    ).toEqual([false])
  })

  it('pools the sign-up days of a week by counts and marks a last week of fewer than seven days partial', () => {
    const cohorts = Array.from({ length: 16 }, (_, offset) =>
      cohort(
        offset,
        10,
        [offset < 7 ? 5 : 0],
        { size: 0, active: [] },
        { size: 0, active: [] }
      )
    )
    const rows = retentionRows(cohorts, 'all', true)
    expect(rows.map((row) => row.days)).toEqual([2, 7, 7])
    expect(rows.map((row) => row.partial)).toEqual([true, false, false])
    expect(rows[2].size).toBe(70)
    expect(rows[2].rates[0]).toBe(0.5)
  })

  it('leaves a sign-up day out of a D7 pool until it has reached D7', () => {
    const reached = cohort(
      0,
      10,
      [1, 1, 1, 1, 1, 1, 1, 10],
      { size: 0, active: [] },
      { size: 0, active: [] }
    )
    const young = cohort(
      1,
      10,
      [0, 0, 0],
      { size: 0, active: [] },
      { size: 0, active: [] }
    )
    const [row] = retentionRows([reached, young], 'all', true)
    expect(row.rates[7]).toBe(1)
    expect(row.rates[2]).toBe(0.05)
  })

  it('picks the best D7 among rows above the floor, and none when no row reaches D7', () => {
    const best = cohort(
      0,
      50,
      [0, 0, 0, 0, 0, 0, 0, 40],
      { size: 0, active: [] },
      { size: 0, active: [] }
    )
    const bigger = cohort(
      1,
      10,
      [0, 0, 0, 0, 0, 0, 0, 10],
      { size: 0, active: [] },
      { size: 0, active: [] }
    )
    const rows = retentionRows([best, bigger], 'all', false)
    expect(bestRetentionD7(rows)?.rate).toBe(0.8)
    expect(
      bestRetentionD7(retentionRows([bigger], 'all', false))
    ).toBeUndefined()
  })

  it('reports whether the server sends the segments, and weekly grouping past two weeks only', () => {
    const plain = [{ day: day(0), size: 1, days: [1] }] as RetentionCohort[]
    expect(retentionHasSegments(plain)).toBe(false)
    expect(
      retentionHasSegments([
        cohort(0, 1, [1], { size: 1, active: [1] }, { size: 0, active: [] }),
      ])
    ).toBe(true)
    expect(retentionIsWeekly({ start: day(0), end: day(14) })).toBe(false)
    expect(retentionIsWeekly({ start: day(0), end: day(15) })).toBe(true)
  })
})
