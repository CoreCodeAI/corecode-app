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
  alignPrevious,
  closedHours,
  contributions,
  dominant,
  findSpikes,
  isOpenHour,
  linearSlope,
  median,
  rateContributions,
  rateIsAbove,
  runRate,
  wilsonLower,
} from '../analysis'

const H = 3600

describe('open hours', () => {
  it('counts an hour open while it ends after the range does', () => {
    expect(isOpenHour(10 * H, 11 * H)).toBe(false)
    expect(isOpenHour(10 * H, 11 * H - 1)).toBe(true)
    expect(isOpenHour(10 * H, 10 * H + 600)).toBe(true)
  })

  it('keeps only the closed rows', () => {
    const rows = [{ hour: 0 }, { hour: H }, { hour: 2 * H }]
    expect(closedHours(rows, 2 * H + 1200)).toEqual([{ hour: 0 }, { hour: H }])
    expect(closedHours(rows, 3 * H)).toEqual(rows)
  })
})

describe('alignPrevious', () => {
  it('finds the previous period’s row a span earlier, or nothing', () => {
    const span = 24 * H
    const current = [{ hour: span }, { hour: span + H }, { hour: span + 2 * H }]
    const previous = [
      { hour: 0, requests: 5 },
      { hour: 2 * H, requests: 7 },
    ]
    expect(alignPrevious(current, previous, span)).toEqual([
      { hour: 0, requests: 5 },
      undefined,
      { hour: 2 * H, requests: 7 },
    ])
    expect(alignPrevious(current, undefined, span)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe('median', () => {
  it('takes the middle, or the mean of the middle two', () => {
    expect(median([])).toBe(0)
    expect(median([7])).toBe(7)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 10])).toBe(3.5)
  })
})

describe('findSpikes', () => {
  const options = { factor: 3, floor: 20 }

  it('flags a value at the factor of its own baseline and past the floor', () => {
    expect(findSpikes([30, 29, 60], [10, 10, 30], options)).toEqual([0])
  })

  it('never flags under the floor, however large the multiple', () => {
    expect(findSpikes([19, 5], [1, 1], options)).toEqual([])
  })

  it('falls back to the median of the other values without a baseline', () => {
    // Index 3: the others' median is 10, and 40 is past 30.
    expect(
      findSpikes([10, 10, 10, 40], [undefined, 0, null, undefined], options)
    ).toEqual([3])
    // Index 3: the others' median is 20, and 40 is under 60.
    expect(findSpikes([20, 20, 20, 40], [], options)).toEqual([])
  })

  it('needs floor times factor when the fallback is zero too', () => {
    expect(findSpikes([0, 0, 59], [], options)).toEqual([])
    expect(findSpikes([0, 0, 60], [], options)).toEqual([2])
  })
})

describe('contributions', () => {
  it('lists each part’s move, one-sided keys included, largest first', () => {
    const current = [
      { model: 'a', usd: 100 },
      { model: 'b', usd: 20 },
      { model: 'b', usd: 5 },
      { model: 'c', usd: 40 },
    ]
    const previous = [
      { model: 'a', usd: 100 },
      { model: 'b', usd: 60 },
      { model: 'd', usd: 10 },
    ]
    expect(
      contributions(
        current,
        previous,
        (row) => row.model,
        (row) => row.usd
      )
    ).toEqual([
      { key: 'c', current: 40, previous: 0, change: 40 },
      { key: 'b', current: 25, previous: 60, change: -35 },
      { key: 'd', current: 0, previous: 10, change: -10 },
    ])
  })
})

describe('rateContributions', () => {
  it('splits a rate’s change by part, summing to the overall change', () => {
    const current = [
      { model: 'a', errors: 30, requests: 100 },
      { model: 'b', errors: 0, requests: 100 },
    ]
    const previous = [
      { model: 'a', errors: 2, requests: 100 },
      { model: 'b', errors: 8, requests: 100 },
    ]
    const parts = rateContributions(
      current,
      previous,
      (row) => row.model,
      (row) => row.errors,
      (row) => row.requests
    )
    expect(parts).toEqual([
      { key: 'a', current: 0.15, previous: 0.01, change: 0.15 - 0.01 },
      { key: 'b', current: 0, previous: 0.04, change: -0.04 },
    ])
    // 15% now against 5% before.
    const sum = parts.reduce((total, part) => total + part.change, 0)
    expect(sum).toBeCloseTo(0.1, 10)
  })

  it('reads an empty period as a zero rate', () => {
    expect(
      rateContributions(
        [{ key: 'a', e: 1, n: 4 }],
        [],
        (row) => row.key,
        (row) => row.e,
        (row) => row.n
      )
    ).toEqual([{ key: 'a', current: 0.25, previous: 0, change: 0.25 }])
  })
})

describe('rateIsAbove', () => {
  it('compares the Wilson lower bound with the baseline', () => {
    expect(wilsonLower(10, 100)).toBeCloseTo(0.055229, 5)
    expect(wilsonLower(0, 50)).toBe(0)
    expect(rateIsAbove(10, 100, 0.05)).toBe(true)
    expect(rateIsAbove(10, 100, 0.06)).toBe(false)
    // 1 in 10 is 10%, but could be 1.8%.
    expect(rateIsAbove(1, 10, 0.02)).toBe(false)
    expect(rateIsAbove(50, 1000, 0.038)).toBe(true)
    expect(rateIsAbove(0, 0, 0)).toBe(false)
  })
})

describe('linearSlope and runRate', () => {
  it('fits a least-squares slope per step', () => {
    expect(linearSlope([])).toBe(0)
    expect(linearSlope([5])).toBe(0)
    expect(linearSlope([1, 3, 5, 7])).toBe(2)
    expect(linearSlope([2, 2, 5])).toBe(1.5)
  })

  it('scales a figure to a month', () => {
    expect(runRate(70, 7)).toBe(300)
    expect(runRate(10, 1, 7)).toBe(70)
    expect(runRate(10, 0)).toBe(0)
  })
})

describe('dominant', () => {
  const part = (key: string, change: number) => ({
    key,
    current: 0,
    previous: 0,
    change,
  })

  it('names the one part that explains half the change', () => {
    expect(dominant([part('a', 60), part('b', 40)], 100)).toEqual([
      part('a', 60),
    ])
  })

  it('names two parts that only together explain it', () => {
    expect(
      dominant([part('a', 30), part('b', 25), part('c', 45)], 100)
    ).toEqual([part('c', 45), part('a', 30)])
  })

  it('ignores parts that moved against the total', () => {
    expect(dominant([part('a', -80), part('b', 30)], -50)).toEqual([
      part('a', -80),
    ])
    expect(dominant([part('a', 200), part('b', -150)], 50)).toEqual([
      part('a', 200),
    ])
  })

  it('names nothing when the change is spread thin or flat', () => {
    expect(
      dominant(
        [
          part('a', 20),
          part('b', 20),
          part('c', 20),
          part('d', 20),
          part('e', 20),
        ],
        100
      )
    ).toEqual([])
    expect(dominant([part('a', 10)], 0)).toEqual([])
  })
})
