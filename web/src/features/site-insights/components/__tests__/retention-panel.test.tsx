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
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { RetentionCohort } from '../../retention-cohorts'
import { RetentionPanel } from '../retention-panel'

const DAY = 86400
const day = (offset: number) => 1761408000 + offset * DAY

function cohort(
  offset: number,
  size: number,
  active: number[],
  paid?: { size: number; active: number[] }
): RetentionCohort {
  return {
    day: day(offset),
    size,
    days: active.map((count) => count / size),
    active,
    activated: { size, active },
    paid: paid ?? { size: 0, active: [] },
  }
}

describe('retention by sign-up day', () => {
  it('reads a cohort’s rate for the sign-ups the reader picks, not the whole cohort', async () => {
    const user = userEvent.setup()
    render(
      <RetentionPanel
        cohorts={[cohort(0, 40, [20], { size: 4, active: [1] })]}
        state='ready'
        range={{ start: day(0), end: day(2), days: 2, hourly: false }}
        end={day(2)}
      />
    )
    expect(screen.getByRole('table')).toHaveTextContent('50')
    await user.click(screen.getByRole('button', { name: 'Paid sign-ups' }))
    expect(screen.getByRole('table')).toHaveTextContent('25')
    expect(screen.getByRole('table')).not.toHaveTextContent('50')
  })

  it('draws a cohort under the floor muted, with no colour behind its rate', () => {
    render(
      <RetentionPanel
        cohorts={[cohort(0, 10, [5])]}
        state='ready'
        range={{ start: day(0), end: day(2), days: 2, hourly: false }}
        end={day(2)}
      />
    )
    const rate = screen.getByText('50')
    expect(rate).toHaveClass('text-muted-foreground')
    expect(rate.getAttribute('style') ?? '').not.toContain('color-mix')
  })

  it('offers no choice of sign-ups on a server that does not send the segments', () => {
    render(
      <RetentionPanel
        cohorts={[{ day: day(0), size: 40, days: [0.5] }]}
        state='ready'
        range={{ start: day(0), end: day(2), days: 2, hourly: false }}
        end={day(2)}
      />
    )
    expect(screen.queryByRole('button', { name: 'Paid sign-ups' })).toBeNull()
    expect(screen.getByRole('table')).toHaveTextContent('50')
  })

  it('groups the sign-up days by week past two weeks and marks the last week partial', () => {
    render(
      <RetentionPanel
        cohorts={Array.from({ length: 10 }, (_, offset) =>
          cohort(offset, 30, [3])
        )}
        state='ready'
        range={{ start: day(0), end: day(20), days: 20, hourly: false }}
        end={day(20)}
      />
    )
    expect(screen.getByText(/partial week/)).toBeInTheDocument()
  })
})
