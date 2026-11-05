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
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { foldIntoWeek } from '../../lib'
import { FunnelChart, ModelMap, WeekHeatmap } from '../advanced-charts'

// Local time, so the weekday and hour hold in any time zone.
const at = (day: number, hour: number) =>
  new Date(2026, 10, day, hour).getTime() / 1000

describe('advanced charts', () => {
  it('folds hours into weekday and hour slots, keeping the highest', () => {
    // 2026-11-02 and 11-09 are Mondays.
    const cells = foldIntoWeek([
      { hour: at(2, 15), value: 4 },
      { hour: at(9, 15), value: 10 },
      { hour: at(3, 9), value: 2 },
    ])
    const monday = cells.find((cell) => cell.weekday === 0 && cell.hour === 15)
    expect(monday).toMatchObject({ max: 10, mean: 7, days: 2 })
    expect(cells.find((cell) => cell.weekday === 1)?.hour).toBe(9)
  })

  it('names the busiest slot and marks the slots limit', () => {
    render(
      <WeekHeatmap
        cells={foldIntoWeek([
          { hour: at(2, 15), value: 12 },
          { hour: at(3, 9), value: 2 },
        ])}
        format={String}
        limit={10}
        empty='none'
      />
    )
    expect(screen.getByText(/Busiest: .* 15:00, 12/)).toBeTruthy()
    expect(screen.getByText('Past 10')).toBeTruthy()
  })

  it('maps models by first token and failure rate, leaving out small ones', () => {
    render(
      <ModelMap
        models={[
          {
            model: 'claude-a',
            vendor: 'claude',
            requests: 500,
            error_rate: 0.001,
            ttft_p50_ms: 1500,
          },
          {
            model: 'gpt-b',
            vendor: 'codex',
            requests: 300,
            error_rate: 0.08,
            ttft_p50_ms: 6000,
          },
          {
            model: 'tiny',
            vendor: 'other',
            requests: 3,
            error_rate: 0.5,
            ttft_p50_ms: 900,
          },
        ]}
        vendorName={(vendor) => vendor.toUpperCase()}
        empty='none'
      />
    )
    expect(
      screen.getByRole('img', {
        name: 'Models by first token and failure rate',
      })
    ).toBeTruthy()
    expect(screen.getAllByText('gpt-b').length).toBeGreaterThan(0)
    expect(screen.queryByText('tiny')).toBeNull()
    expect(screen.getByText('1 models under 20 requests left out')).toBeTruthy()
  })

  it('shows each funnel step against the first and the step before', () => {
    render(
      <FunnelChart
        steps={[
          { label: 'Registered', value: 200 },
          { label: 'Activated', value: 100 },
          { label: 'Has paid', value: 20 },
        ]}
      />
    )
    expect(screen.getByText(/50% went on/)).toBeTruthy()
    expect(screen.getByText(/20% went on/)).toBeTruthy()
    expect(screen.getByText('10%')).toBeTruthy()
  })
})
