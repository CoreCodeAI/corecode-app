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

import { render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useInsightsDefinitions } from '../../lib'
import { LogsNote } from '../insight-kit'
import { BarSeries, DeltaBadge, Sparkline } from '../shared'

const DAY = 86400
const LOGS = 1_799_971_200

describe('a previous period with no data', () => {
  it('reads as no data to compare, not as new, when it lies before the logs', () => {
    render(
      <DeltaBadge
        delta={{ current: 40, previous: 0, better: 'up', missing: true }}
      />
    )
    expect(screen.getByText('No data to compare')).toBeInTheDocument()
    expect(screen.queryByText('New this period')).not.toBeInTheDocument()
  })

  it('still reads a zero previous period as new when it has data', () => {
    render(<DeltaBadge delta={{ current: 40, previous: 0, better: 'up' }} />)
    expect(screen.getByText('New this period')).toBeInTheDocument()
  })
})

describe('a bar before the logs', () => {
  it('draws no bar for a missing hour and reads it as no data', () => {
    const { container } = render(
      <BarSeries
        ariaLabel='Requests by hour'
        series={[{ label: 'Requests' }]}
        points={[
          { key: 1, title: 'Hour one', values: [5] },
          { key: 2, title: 'Hour two', values: [9], missing: true },
        ]}
      />
    )
    expect(screen.getByLabelText('Hour one, Requests 5')).toBeTruthy()
    const bars = container.querySelectorAll('ol > li')
    expect(bars).toHaveLength(2)
    expect(bars[0].querySelectorAll('span[style*="height"]').length).toBe(1)
    // A missing hour's value is ignored: nothing is drawn for it.
    expect(bars[1].querySelectorAll('span[style*="height"]').length).toBe(0)
    expect(bars[1].getAttribute('aria-label')).toBe('Hour two, No data')
  })
})

describe('a trend before the logs', () => {
  it('breaks the line across a missing point', () => {
    const { container } = render(
      <Sparkline
        label='Requests'
        format={(value) => String(value)}
        points={[
          { title: 'Day 1', value: 10 },
          { title: 'Day 2', value: 0, missing: true },
          { title: 'Day 3', value: 20 },
        ]}
      />
    )
    // Only the area under the two whole days remains; no stroke runs across the gap.
    expect(container.querySelector('path[fill="none"]')).toBeNull()
    expect(container.querySelector('path')).not.toBeNull()
  })

  it('reads a missing latest point as no data', () => {
    render(
      <Sparkline
        label='Requests'
        format={(value) => String(value)}
        points={[
          { title: 'Day 1', value: 10 },
          { title: 'Day 2', value: 0, missing: true },
        ]}
      />
    )
    expect(
      screen.getByRole('img', {
        name: 'Requests from Day 1 to Day 2, latest No data',
      })
    ).toBeInTheDocument()
  })
})

describe('the logs note', () => {
  it('says where the logs begin when the range starts before them', () => {
    render(<LogsNote start={LOGS - DAY} logsSince={LOGS} />)
    expect(screen.getByText(/^Logs start /)).toBeInTheDocument()
    expect(
      screen.getByText(/earlier hours have no data\.$/)
    ).toBeInTheDocument()
  })

  it('says nothing when the range starts after the logs or they are unknown', () => {
    const { container } = render(<LogsNote start={LOGS + 1} logsSince={LOGS} />)
    expect(container).toBeEmptyDOMElement()
    const unknown = render(
      <LogsNote start={LOGS - DAY} logsSince={undefined} />
    )
    expect(unknown.container).toBeEmptyDOMElement()
  })
})

describe('staff in the shared definitions', () => {
  it('says the customers and everyone figures leave root and staff out or in', () => {
    const { result } = renderHook(() => useInsightsDefinitions())
    expect(result.current.customers).toBe(
      "Customers are every account but root and staff, so the operator's tests are left out."
    )
    expect(result.current.everyone).toBe('Everyone includes root and staff.')
  })
})
