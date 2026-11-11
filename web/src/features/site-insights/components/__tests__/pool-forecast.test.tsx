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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ForecastPanel } from '../pool-forecast'
import { outlook, outlookModel } from './outlook-fixture'

// A window's card: its name is also on the chart's switch and in the
// comparison table, and the panel around them is a card too.
function card(label: string) {
  const cards = screen
    .getAllByText(label)
    .map((node) => node.closest('dl > [data-slot=card]'))
    .filter(Boolean)
  expect(cards).toHaveLength(1)
  return within(cards[0] as HTMLElement)
}

describe('supply and demand', () => {
  it('opens on the smart forecast and says where the pool runs short', () => {
    render(<ForecastPanel outlook={outlook()} />)

    expect(screen.getByRole('button', { name: 'Smart' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.getByText(
        /^Not enough under this forecast: the pool first has nothing to spend around .*, and over the next 7 days \$19,600 of demand goes unserved across 2\.5 days\.$/
      )
    ).toBeInTheDocument()

    const five = card('Next 5 hours')
    expect(five.getByText('Enough')).toBeInTheDocument()
    expect(five.getByText('$1,200')).toBeInTheDocument()
    expect(five.getByText('$2,200')).toBeInTheDocument()
    expect(five.getByText(/Demand is 54\.5% of supply/)).toBeInTheDocument()
    expect(five.getByText(/Range \$960 – \$1,560/)).toBeInTheDocument()
    expect(five.getByText(/^Tightest \$300 at /)).toBeInTheDocument()

    // $6,000 of $7,200 is more than four fifths.
    expect(card('Next 24 hours').getByText('Tight')).toBeInTheDocument()

    const week = card('Next 7 days')
    expect(week.getByText('Short')).toBeInTheDocument()
    expect(week.getByText('$43,000')).toHaveClass('text-destructive')
    expect(
      week.getByText(
        /^Nothing to spend from .* · 2\.5 days in all · \$19,600 unserved$/
      )
    ).toBeInTheDocument()
  })

  it('reads out a window’s meter when pointed at', async () => {
    const user = userEvent.setup()
    render(<ForecastPanel outlook={outlook()} />)

    await user.hover(
      screen.getByRole('meter', { name: 'Next 24 hours: demand over supply' })
    )

    const tip = (await screen.findByText('Demand is 83.3% of supply')).closest(
      '[data-slot=tooltip-content]'
    )
    expect(tip).toHaveTextContent('Demand$6,000')
    expect(tip).toHaveTextContent('Supply$7,200')
  })

  it('sizes the accounts to add under the forecast shown', async () => {
    const user = userEvent.setup()
    render(<ForecastPanel outlook={outlook()} />)

    const add = card('Accounts to add')
    expect(add.getByText('18')).toBeInTheDocument()
    expect(add.getByText('× Team Tier 1')).toBeInTheDocument()
    expect(add.getByText('Keep up 18 · 7 days 17')).toBeInTheDocument()
    // No count of Team Standard left the week without a gap.
    expect(add.getByText('or over 30 × Team Standard')).toBeInTheDocument()
    expect(add.getByText(/\$258\/h of \$141\/h/)).toBeInTheDocument()
    expect(add.getByRole('meter', { name: 'Weekly load' })).toHaveAttribute(
      'aria-valuenow',
      '100'
    )

    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(card('Accounts to add').getByText('0')).not.toHaveClass(
      'text-destructive'
    )
  })

  it('draws the first window that runs short, then the one picked', async () => {
    const user = userEvent.setup()
    render(<ForecastPanel outlook={outlook()} />)

    // The smart forecast runs short over the 7 days, read by the weekly quota.
    expect(
      screen.getByRole('img', { name: /^Next 7 days: \$700 spendable now/ })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('img'))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Usual range$6,600 – $6,600'
    )

    await user.click(screen.getByRole('button', { name: 'Next 5 hours' }))
    expect(
      screen.getByRole('img', {
        name: /^Next 5 hours: \$700 spendable now, least \$300 around/,
      })
    ).toBeInTheDocument()
    // The weekly resets fall outside the 5 hours.
    expect(screen.getByText('5-hour reset')).toBeInTheDocument()
    expect(screen.queryByText('Weekly reset')).not.toBeInTheDocument()

    // The window picked stays through a change of forecast.
    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(
      screen.getByRole('img', { name: /^Next 5 hours/ })
    ).toBeInTheDocument()
  })

  it('opens a forecast that is served in full on the day', async () => {
    const user = userEvent.setup()
    render(<ForecastPanel outlook={outlook()} />)

    await user.click(screen.getByRole('button', { name: 'History' }))

    expect(
      screen.getByText(
        'Enough under this forecast: the next 7 days’ demand of $33,600 is served in full.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /^Next 24 hours/ })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /^Each hour of the day at its average over the last 7 days: \$130\/h on average\./
      )
    ).toBeInTheDocument()
  })

  it('reads the linear forecast from the window picked, when gpt-load has it', async () => {
    const user = userEvent.setup()
    render(<ForecastPanel outlook={outlook()} />)

    await user.click(screen.getByRole('button', { name: 'Linear' }))

    expect(
      screen.getByRole('button', { name: 'Last 24 hours' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Last 12 hours' })).toBeDisabled()
    expect(
      screen.getByText(
        /^The spend rate of the last 24 hours, \$200\/h, held flat\./
      )
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Last hour' }))

    expect(
      screen.getByText(
        /^The spend rate of the last hour, \$300\/h, held flat\./
      )
    ).toBeInTheDocument()
    // $7,200 of supply, yet $300 of the day's demand arrives before its quota.
    const day = card('Next 24 hours')
    expect(day.getByText('Short')).toBeInTheDocument()
    expect(day.getByText(/\$300 unserved$/)).toBeInTheDocument()
  })

  it('sets the forecasts side by side and shows the one picked there', async () => {
    const user = userEvent.setup()
    render(<ForecastPanel outlook={outlook()} />)

    const table = within(screen.getByRole('table'))
    // The 12-hour rate could not be read, so it has no row.
    expect(table.getAllByRole('row')).toHaveLength(5)
    expect(table.queryByText('Linear · last 12 hours')).not.toBeInTheDocument()
    const smart = table
      .getByRole('button', { name: 'Smart forecast' })
      .closest('tr') as HTMLElement
    expect(smart).toHaveTextContent('$217/h')
    expect(smart).toHaveTextContent('$43,000$19,600 unserved')
    expect(smart).toHaveTextContent(/18$/)

    await user.click(table.getByRole('button', { name: 'Linear · last hour' }))

    expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Last hour' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      table.getByRole('button', { name: 'Linear · last hour' })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('says why the short rates are missing', () => {
    render(
      <ForecastPanel outlook={outlook({ usage_error: 'gpt-load timed out' })} />
    )
    expect(
      screen.getByText(
        /1-hour and 12-hour rates are unavailable: gpt-load timed out/
      )
    ).toBeInTheDocument()
  })

  it('says so when no forecast could be built', () => {
    render(
      <ForecastPanel
        outlook={outlook({
          models: [outlookModel('smart', { available: false })],
        })}
      />
    )
    expect(
      screen.getByText('No forecast could be built from the pool’s readings.')
    ).toBeInTheDocument()
  })

  it('reads a pool nobody used', () => {
    render(
      <ForecastPanel
        outlook={outlook({
          models: [
            outlookModel('linear_24h', {
              rate_usd_per_hour: 0,
              average_usd_per_hour: 0,
              week_load: 0,
            }),
          ],
        })}
      />
    )
    expect(
      screen.getByText('No Claude spend logged in the last 24 hours.')
    ).toBeInTheDocument()
  })
})
