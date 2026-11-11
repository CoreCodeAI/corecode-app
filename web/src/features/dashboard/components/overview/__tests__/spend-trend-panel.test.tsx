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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { UptimeSparkline } from '@/features/pricing/components/model-details-uptime-sparkline'

import { SpendTrendPanel } from '../spend-trend-panel'

// The panel's "details" link needs a router; the bars do not.
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: React.ReactNode }) => <a>{props.children}</a>,
}))

function openTooltip() {
  // Base UI waits 600ms by default; the charts' providers open at once.
  return waitFor(
    () => {
      const popup = document.querySelector('[data-slot="tooltip-content"]')
      expect(popup).not.toBeNull()
      return popup as HTMLElement
    },
    { timeout: 200 }
  )
}

describe('daily bar hover areas', () => {
  it('opens a day of the spend trend at once, with no dead gap between bars', async () => {
    render(
      <SpendTrendPanel
        loading={false}
        daily={[
          {
            day: 1759248000,
            quota: 500000,
            requests: 12,
            cacheReadTokens: 900,
            cacheWriteTokens: 100,
          },
          {
            day: 1759334400,
            quota: 0,
            requests: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        ]}
      />
    )
    const chart = screen.getByRole('list', { name: 'Daily spend' })
    expect(chart.className).not.toMatch(/\bgap-/)
    const bar = within(chart).getByLabelText(/12 requests$/)

    await userEvent.hover(bar)
    expect(await openTooltip()).toHaveTextContent('12 requests')
  })
})

const TWO_DAYS = [
  {
    day: 1759248000,
    quota: 500000,
    requests: 12,
    cacheReadTokens: 900,
    cacheWriteTokens: 100,
  },
  {
    day: 1759334400,
    quota: 250000,
    requests: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
]

describe('spend trend on a touch screen', () => {
  it('makes each day a list item that is its own trigger, so no edge is dead', () => {
    render(<SpendTrendPanel loading={false} daily={TWO_DAYS} />)
    const chart = screen.getByRole('list', { name: 'Daily spend' })

    for (const item of within(chart).getAllByRole('listitem')) {
      expect(item).toHaveAttribute('data-slot', 'tooltip-trigger')
      expect(item).toHaveAttribute('tabindex', '0')
    }
  })

  it('reads out a day on a tap and puts it away on a second tap', async () => {
    render(<SpendTrendPanel loading={false} daily={TWO_DAYS} />)
    const bar = screen.getByLabelText(/12 requests$/)

    fireEvent.pointerDown(bar, { pointerType: 'touch' })
    fireEvent.click(bar)
    expect(await openTooltip()).toHaveTextContent('12 requests')

    fireEvent.pointerDown(bar, { pointerType: 'touch' })
    fireEvent.click(bar)
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="tooltip-content"][data-open]')
      ).toBeNull()
    )
  })

  it('reads out a day when the keyboard focuses it', async () => {
    const user = userEvent.setup()
    render(<SpendTrendPanel loading={false} daily={TWO_DAYS} />)
    const bar = screen.getByLabelText(/12 requests$/)

    for (let step = 0; step < 10 && document.activeElement !== bar; step++) {
      await user.tab()
    }
    expect(bar).toHaveFocus()

    expect(await openTooltip()).toHaveTextContent('12 requests')
  })

  it('shows every other date at phone width, counting back from today, and lets it spill past its column', () => {
    const days = Array.from({ length: 4 }, (_, index) => ({
      ...TWO_DAYS[0],
      day: TWO_DAYS[0].day + index * 86400,
    }))
    render(<SpendTrendPanel loading={false} daily={days} />)
    const labels = within(screen.getByRole('list', { name: 'Daily spend' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('[aria-hidden]') as HTMLElement)

    expect(
      labels.map((label) => label.classList.contains('invisible'))
    ).toEqual([true, false, true, false])
    expect(labels[3]).toHaveTextContent('Today')
    for (const label of labels) {
      expect(label).toHaveClass('truncate', 'max-sm:overflow-visible')
    }
  })
})

describe('uptime strip hover areas', () => {
  it('opens a day of the uptime strip at once, with no dead gap between days', async () => {
    render(
      <UptimeSparkline
        series={[
          {
            date: '2026-09-14',
            uptime_pct: 100,
            incidents: 0,
            outage_minutes: 0,
          },
          {
            date: '2026-09-15',
            uptime_pct: 97,
            incidents: 1,
            outage_minutes: 42,
          },
        ]}
      />
    )
    const strip = screen.getByRole('img')
    expect(strip.className).not.toMatch(/\bgap-/)
    const days = strip.querySelectorAll('[data-slot="tooltip-trigger"]')
    expect(days[1]).toHaveClass('px-px')

    await userEvent.hover(days[1] as HTMLElement)
    expect(await openTooltip()).toHaveTextContent('42 min outage')
  })
})
