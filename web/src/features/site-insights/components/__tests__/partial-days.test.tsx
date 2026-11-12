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
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import {
  dayShare,
  InsightsSpanContext,
  type PartialMark,
  usePartialDays,
} from '../../partial-days'
import { BarSeries, Sparkline } from '../shared'

// 2027-01-15 00:00 UTC, and a profile with every hour alike.
const DAY = 1_799_971_200
const FLAT = Array.from({ length: 24 }, () => 1 / 24)

describe('share of a typical day', () => {
  it('sums the hours in the window, part of an hour in proportion', () => {
    const hours = Array.from({ length: 24 }, (_, hour) =>
      hour === 2 ? 0.5 : 0.5 / 23
    )
    expect(dayShare(hours, DAY + 2 * 3600, DAY + 3 * 3600)).toBeCloseTo(0.5)
    expect(dayShare(hours, DAY + 2 * 3600 + 1800, DAY + 3 * 3600)).toBeCloseTo(
      0.25
    )
    expect(dayShare(FLAT, DAY, DAY + 86400)).toBeCloseTo(1)
    // A window over midnight reads the next day's hours by their UTC hour.
    expect(dayShare(FLAT, DAY - 3600, DAY + 3600)).toBeCloseTo(2 / 24)
  })
})

function Probe(props: {
  marks: (partial: ReturnType<typeof usePartialDays>) => unknown
}) {
  const partial = usePartialDays('finance')
  return <pre>{JSON.stringify(props.marks(partial))}</pre>
}

function withSpan(
  children: ReactNode,
  options: { now: number; days: number; hours?: number[] }
) {
  return (
    <InsightsSpanContext.Provider
      value={{
        now: options.now,
        days: () => options.days,
        hours: options.hours ?? FLAT,
      }}
    >
      {children}
    </InsightsSpanContext.Provider>
  )
}

function readMarks(
  options: { now: number; days: number; hours?: number[] },
  marks: (partial: ReturnType<typeof usePartialDays>) => unknown
) {
  render(withSpan(<Probe marks={marks} />, options))
  return JSON.parse(screen.getByText(/.+/).textContent ?? 'null') as (
    | PartialMark
    | null
    | undefined
  )[]
}

describe('partial days', () => {
  it('marks the first and last days and projects amounts to the whole day', () => {
    // Read at 18:00 UTC over two days: the first day from 18:00, the last
    // to 18:00, and a whole day between.
    const now = DAY + 2 * 86400 + 18 * 3600
    const [first, middle, last, rate] = readMarks({ now, days: 2 }, (mark) => [
      mark(DAY, [100]),
      mark(DAY + 86400, [100]) ?? null,
      mark(DAY + 2 * 86400, [300]),
      mark(DAY + 2 * 86400),
    ])
    expect(first?.note).toMatch(/^Partial, from /)
    expect(first?.projected?.[0]).toBeCloseTo(400)
    expect(middle).toBeNull()
    expect(last?.note).toMatch(/^In progress, through /)
    expect(last?.projected?.[0]).toBeCloseTo(400)
    // A rate is marked but not projected.
    expect(rate?.note).toMatch(/^In progress/)
    expect(rate?.projected).toBeUndefined()
  })

  it('does not project from too small a part of a typical day', () => {
    const now = DAY + 86400 + 2 * 3600
    const [last] = readMarks({ now, days: 1 }, (mark) => [
      mark(DAY + 86400, [10]),
    ])
    expect(last?.note).toMatch(/^In progress/)
    expect(last?.projected).toBeUndefined()
  })

  it('only marks the days while the profile is missing', () => {
    const now = DAY + 86400 + 18 * 3600
    const [last] = readMarks({ now, days: 1, hours: [] }, (mark) => [
      mark(DAY + 86400, [10]),
    ])
    expect(last?.note).toMatch(/^In progress/)
    expect(last?.projected).toBeUndefined()
  })

  it('marks nothing outside the dashboard', () => {
    render(<Probe marks={(mark) => [mark(DAY, [1]) ?? null]} />)
    expect(screen.getByText('[null]')).toBeInTheDocument()
  })
})

describe('partial days in the charts', () => {
  const points = [
    { title: '1/14', value: 300 },
    { title: '1/15', value: 280 },
    {
      title: '1/16',
      value: 90,
      partial: { note: 'In progress, through 08:00', projected: [310] },
    },
  ]

  it('dashes the line to a projection and reads both out', () => {
    render(
      <Sparkline points={points} format={(v) => `¥${v}`} label='Revenue' />
    )
    const line = screen.getByRole('img', { name: /^Revenue/ })
    expect(line.querySelector('path[data-partial]')).not.toBeNull()
    fireEvent.focus(line)
    expect(screen.getByRole('status')).toHaveTextContent(
      '1/16 ¥90In progress, through 08:00 · Expected for the whole day ¥310'
    )
  })

  it('outlines the rest of a projected bar and lists the projection', () => {
    render(
      <BarSeries
        ariaLabel='daily'
        series={[{ label: 'Top-ups' }, { label: 'Plans' }]}
        points={[
          { key: 1, title: '1/15', values: [200, 100] },
          {
            key: 2,
            title: '1/16',
            values: [60, 30],
            partial: { note: 'In progress', projected: [240, 120] },
          },
        ]}
      />
    )
    const bar = screen.getByRole('listitem', { name: /^1\/16/ })
    expect(bar.querySelector('[data-projected]')).not.toBeNull()
    expect(bar).toHaveAccessibleName(
      '1/16, In progress, Top-ups 60, Plans 30, Total 90, Expected for the whole day 360'
    )
    // The axis reaches the projection, not only what has come in.
    expect(screen.getAllByText('400').length).toBeGreaterThan(0)
  })
})
