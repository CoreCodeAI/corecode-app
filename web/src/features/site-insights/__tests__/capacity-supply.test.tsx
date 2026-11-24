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

import { dailyRequests } from '../capacity-analysis'
import { weekSupply } from '../capacity-supply'
import {
  outlook,
  outlookModel,
  outlookWindow,
} from '../components/__tests__/outlook-fixture'
import {
  DailyRequestsPanel,
  SupplyDemandPanel,
} from '../components/capacity-supply'
import type { CapacityHour } from '../types'

describe('week supply', () => {
  it('divides the week’s forecast demand by what the pool can spend, and says what to add', () => {
    const supply = weekSupply(outlook())
    // The fixture's smart forecast asks 43,000 of 23,700 and runs short.
    expect(supply?.demand).toBe(43000)
    expect(supply?.supply).toBe(23700)
    expect(supply?.ratio).toBeCloseTo(43000 / 23700, 5)
    expect(supply?.coverage).toBe('short')
    expect(supply?.firstShortHours).toBe(42.8)
    // The fewest accounts of a plan that cover the week: tier 1's 18, not the 88 of a plan that cannot.
    expect(supply?.add).toEqual({
      count: 18,
      plan: 'Team',
      tier: 'team_tier_1',
    })
  })

  it('has nothing without an outlook, with an error, or with no supply to divide by', () => {
    expect(weekSupply(undefined)).toBeUndefined()
    expect(weekSupply(outlook({ error: 'down' }))).toBeUndefined()
    expect(
      weekSupply(
        outlook({
          remaining: [
            {
              hours: 168,
              on_hand_usd: 0,
              five_hour_refill_usd: 0,
              week_refill_usd: 0,
              with_resets_usd: 0,
            },
          ],
        })
      )
    ).toBeUndefined()
  })

  it('reads enough when demand stays under four fifths of supply', () => {
    const calm = outlook({
      models: [
        outlookModel('smart', {
          windows: [
            outlookWindow(168, { demand_usd: 10000, served_usd: 10000 }),
          ],
        }),
      ],
    })
    const supply = weekSupply(calm)
    expect(supply?.coverage).toBe('enough')
    expect(supply?.firstShortHours).toBeNull()
  })
})

describe('supply panel', () => {
  it('shows the ratio as a gauge with the verdict and the accounts to add', () => {
    render(<SupplyDemandPanel outlook={outlook()} />)
    expect(screen.getByTestId('supply-ratio')).toHaveTextContent('181')
    expect(screen.getByRole('meter')).toBeInTheDocument()
    expect(
      screen.getByText('The pool cannot serve all of the week’s demand.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Add 18 Team team_tier_1 accounts to leave no gap.')
    ).toBeInTheDocument()
  })

  it('draws nothing without an outlook', () => {
    const { container } = render(<SupplyDemandPanel outlook={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not suggest accounts while the week is covered', () => {
    render(
      <SupplyDemandPanel
        outlook={outlook({
          models: [
            outlookModel('smart', {
              windows: [
                outlookWindow(168, { demand_usd: 5000, served_usd: 5000 }),
              ],
            }),
          ],
        })}
      />
    )
    expect(screen.getByText('The pool covers the week.')).toBeInTheDocument()
    expect(
      screen.queryByText(/accounts to leave no gap/)
    ).not.toBeInTheDocument()
  })
})

describe('daily requests', () => {
  const HOUR = 3600
  const DAY = 86400
  // The viewer's days are local; build whole local days from midnight.
  const midnight = new Date(2026, 10, 10).getTime() / 1000
  function hours(
    from: number,
    count: number,
    requests: number,
    errors: number
  ) {
    return Array.from({ length: count }, (_, index) => ({
      hour: from + index * HOUR,
      requests,
      errors,
    })) as CapacityHour[]
  }

  it('sums whole days of closed hours and leaves out the day the range cuts', () => {
    const rows = [
      ...hours(midnight + 20 * HOUR, 4, 10, 1), // a cut first day: 4 hours only
      ...hours(midnight + DAY, 24, 10, 1),
      ...hours(midnight + 2 * DAY, 24, 5, 0),
    ]
    const days = dailyRequests(rows, midnight + 3 * DAY)
    expect(days).toEqual([
      { day: midnight + DAY, requests: 240, errors: 24 },
      { day: midnight + 2 * DAY, requests: 120, errors: 0 },
    ])
  })

  it('draws a stacked bar per whole day', () => {
    const rows = hours(midnight + DAY, 24, 10, 1)
    render(<DailyRequestsPanel hourly={rows} end={midnight + 2 * DAY} />)
    expect(screen.getByText('Daily requests')).toBeInTheDocument()
  })
})
