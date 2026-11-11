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

import { RemainingPanel } from '../pool-remaining'
import { outlook } from './outlook-fixture'

// The panel is a card too; a window's card is the one inside the list.
function card(label: string) {
  return screen.getByText(label).closest('dl > [data-slot=card]') as HTMLElement
}

describe('quota left', () => {
  it('counts the resets inside each window until the switch leaves them out', async () => {
    const user = userEvent.setup()
    render(<RemainingPanel outlook={outlook()} />)

    expect(card('Next 5 hours')).toHaveTextContent('≈ $2,200')
    expect(card('Next 24 hours')).toHaveTextContent('≈ $7,200')
    expect(card('Next 7 days')).toHaveTextContent('≈ $23,700')
    expect(
      screen.getByText(/counting the resets inside it/)
    ).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Count resets' }))

    expect(card('Next 5 hours')).toHaveTextContent('≈ $700')
    expect(card('Next 24 hours')).toHaveTextContent('≈ $5,800')
    expect(card('Next 7 days')).toHaveTextContent('≈ $6,600')
    expect(screen.getByText(/counting no reset/)).toBeInTheDocument()
  })

  it('lists what each figure is made of and strikes what the switch leaves out', async () => {
    const user = userEvent.setup()
    render(<RemainingPanel outlook={outlook()} />)

    const five = within(card('Next 5 hours'))
    expect(five.getByText('$700')).not.toHaveClass('line-through')
    expect(five.getByText('+$1,500')).not.toHaveClass('line-through')
    expect(
      five.getByRole('img', {
        name: 'Held now $700, 5-hour resets $1,500, Weekly resets $0',
      })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Count resets' }))

    expect(five.getByText('$700')).not.toHaveClass('line-through')
    expect(five.getByText('+$1,500')).toHaveClass('line-through')
  })

  it('reads out the bar’s parts and their shares when pointed at', async () => {
    const user = userEvent.setup()
    render(<RemainingPanel outlook={outlook()} />)

    await user.hover(
      within(card('Next 5 hours')).getByRole('img', { name: /^Held now/ })
    )

    const tip = (await screen.findByText('$1,500 · 68.2%')).closest(
      '[data-slot=tooltip-content]'
    )
    expect(tip).toHaveTextContent('Next 5 hours')
    expect(tip).toHaveTextContent('Held now$700 · 31.8%')
    expect(tip).toHaveTextContent('Weekly resets$0 · 0%')
  })

  it('unfolds the resets it counts, soonest first', async () => {
    const user = userEvent.setup()
    render(<RemainingPanel outlook={outlook()} />)

    expect(screen.queryByText('#11 a***@x.io')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Upcoming resets (3)' })
    )

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('in 2.0 h')
    expect(rows[0]).toHaveTextContent('5-hour')
    expect(rows[0]).toHaveTextContent('#11 a***@x.io')
    expect(rows[0]).toHaveTextContent('+$400')
    expect(rows[1]).toHaveTextContent('Weekly')
    expect(rows[2]).toHaveTextContent('in 4.0 d')
  })

  it('says how many accounts it could not count', () => {
    render(<RemainingPanel outlook={outlook({ unknown: 2 })} />)
    expect(
      screen.getByText('2 accounts without an estimate are not counted.')
    ).toBeInTheDocument()
  })

  it('has no reset list when nothing resets', () => {
    render(<RemainingPanel outlook={outlook({ resets: [] })} />)
    expect(
      screen.queryByRole('button', { name: /Upcoming resets/ })
    ).not.toBeInTheDocument()
  })
})
