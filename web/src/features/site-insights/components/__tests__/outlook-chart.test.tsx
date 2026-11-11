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
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'

import { OutlookChart } from '../outlook-chart'
import { NOW } from './outlook-fixture'

function renderChart(overrides: Partial<ComponentProps<typeof OutlookChart>>) {
  render(
    <OutlookChart
      title='Next 5 hours'
      hours={[0, 1, 2, 3]}
      series='drawable'
      drawable={[400, 0, 0, 200]}
      weekLeft={[2000, 1700, 1700, 1500]}
      demand={[300, 310, 320, 330]}
      resets={[]}
      observedAt={NOW}
      {...overrides}
    />
  )
}

describe('the supply and demand curves', () => {
  it('names what it shows and marks the stretch with nothing to spend', () => {
    renderChart({})

    expect(
      screen.getByRole('img', {
        name: /^Next 5 hours: \$400 spendable now, least \$0 around/,
      })
    ).toBeInTheDocument()
    expect(screen.getByText('Nothing to spend')).toBeInTheDocument()
    expect(screen.queryByText('Usual range')).not.toBeInTheDocument()
  })

  it('reads out the moment under the pointer and steps with the arrow keys', async () => {
    const user = userEvent.setup()
    renderChart({})

    await user.click(screen.getByRole('img'))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Spendable at once$400')
    expect(status).toHaveTextContent('Weekly quota left$2,000')
    expect(status).toHaveTextContent('Demand$300/h')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Spendable at onceNothing'
    )
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Spendable at once$200'
    )
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Spendable at once$400'
    )

    await user.tab()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reads the forecast’s usual range at each moment', async () => {
    const user = userEvent.setup()
    renderChart({
      band: { upper: [400, 150, 100, 300], lower: [400, 0, 0, 50] },
    })

    expect(screen.getByText('Usual range')).toBeInTheDocument()
    await user.click(screen.getByRole('img'))
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    // The range is the drawn series', so it reads right under it.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Spendable at once$200Usual range$50 – $300Weekly quota left'
    )
  })

  it('draws the demand in its own panel, apart from the supply', async () => {
    const user = userEvent.setup()
    renderChart({
      demandBand: { upper: [360, 372, 384, 396], lower: [240, 248, 256, 264] },
    })

    // Each panel names its series: supply in dollars, demand in dollars an
    // hour, so neither is read on the other's scale.
    expect(screen.getByText('Supply')).toBeInTheDocument()
    expect(screen.getByText('Demand')).toBeInTheDocument()
    expect(screen.getByText('Dollars per hour')).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: /; demand \$300\/h now, peak \$330\/h$/,
      })
    ).toBeInTheDocument()
    expect(screen.getByText('Usual range')).toBeInTheDocument()

    await user.click(screen.getByRole('img'))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Demand$310/hUsual range$248/h – $372/h'
    )
  })

  it('names the tightest moment the projection found between its points', () => {
    renderChart({
      drawable: [400, 300, 250, 200],
      lowest: { usd: 180, hours: 2.5 },
    })
    expect(
      screen.getByRole('img', {
        name: /^Next 5 hours: \$400 spendable now, least \$180 around/,
      })
    ).toBeInTheDocument()
  })

  it('names the resets landing at the moment read out', async () => {
    const user = userEvent.setup()
    renderChart({
      resets: [
        {
          key: 'five_hour-11',
          hours: 2.9,
          window: 'five_hour',
          label: '5-hour reset · a***@x.io · +$400',
        },
      ],
    })

    expect(screen.getByText('5-hour reset')).toBeInTheDocument()
    await user.click(screen.getByRole('img'))
    expect(screen.getByRole('status')).not.toHaveTextContent('a***@x.io')
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent(
      '5-hour reset · a***@x.io · +$400'
    )
  })

  it('draws the weekly quota when the window is read by it', async () => {
    const user = userEvent.setup()
    renderChart({ series: 'weekLeft', title: 'Next 7 days' })

    // The caption names the series the line follows.
    expect(screen.getByText('Weekly quota left')).toBeInTheDocument()
    await user.click(screen.getByRole('img', { name: /^Next 7 days/ }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Weekly quota left$2,000'
    )
  })
})
