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
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ActivityInsights, EngineDailyCost } from '../../types'
import { ActivityTab } from '../growth-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

const day = (offset: number) => 1761408000 + offset * 86400

function activity(
  engine: EngineDailyCost,
  overrides: Partial<ActivityInsights> = {}
): ActivityInsights {
  return {
    active_users: 2,
    // new-api's charge is in yuan; at ¥8 a dollar, ¥30 is $3.75.
    quota_usd: 30,
    usd_exchange_rate: 8,
    requests: 9,
    engine_cost: engine,
    daily: [
      { day: day(0), dau: 1, wau: 1, requests: 4, quota_usd: 10 },
      { day: day(1), dau: 2, wau: 2, requests: 5, quota_usd: 20 },
    ],
    retention: [],
    top_users: [],
    top1_share: 0.5,
    top3_share: 1,
    top10_share: 1,
    ...overrides,
  }
}

describe('official-price cost from the engine', () => {
  it('reads out each day’s official cost beside what new-api charged', () => {
    render(
      <ActivityTab
        data={activity({
          configured: true,
          cost_usd: 12.5,
          requests: 3,
          // The engine leaves out a day with no Claude requests.
          daily: [{ day: day(1), cost_usd: 12.5, requests: 3 }],
        })}
      />
    )
    const chart = screen.getByRole('list', {
      name: 'Daily Claude cost at official prices',
    })
    const bars = chart.querySelectorAll('[tabindex="0"]')
    expect(bars).toHaveLength(2)
    expect(bars[0].getAttribute('aria-label')).toMatch(
      /Official cost \$0\.00.*Charged \$1\.25 \(¥10.*Claude requests 0/
    )
    expect(bars[1].getAttribute('aria-label')).toMatch(
      /Official cost \$12\.50.*Charged \$2\.50 \(¥20.*Claude requests 3/
    )
    expect(
      screen.getByText(
        /^Charged \$3\.75 \(¥30.*\) against \$12\.50 at official prices\.$/
      )
    ).toBeInTheDocument()
  })

  it('shows the engine’s error instead of an empty chart', () => {
    render(
      <ActivityTab
        data={activity({
          configured: true,
          error: 'engine /usage/daily returned HTTP 404',
          cost_usd: 0,
          requests: 0,
          daily: [],
        })}
      />
    )
    expect(
      screen.getByText('engine /usage/daily returned HTTP 404')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('list', {
        name: 'Daily Claude cost at official prices',
      })
    ).not.toBeInTheDocument()
  })
})

describe('daily consumption', () => {
  const total: EngineDailyCost = {
    configured: true,
    cost_usd: 40,
    requests: 9,
    unpriced_requests: 2,
    daily: [
      { day: day(0), cost_usd: 15, requests: 4 },
      { day: day(1), cost_usd: 25, requests: 5 },
    ],
  }
  const claude: EngineDailyCost = {
    configured: true,
    cost_usd: 0,
    requests: 0,
    daily: [],
  }

  it('reads each day in new-api dollars, yuan and gpt-load value', async () => {
    const user = userEvent.setup()
    render(<ActivityTab data={activity(claude, { engine_total: total })} />)

    expect(
      screen.getByText(
        /new-api charged \$3\.75 \(¥30.*\), and gpt-load’s requests were worth \$40\.00 at official prices\. Busiest day .*: \$2\.50\./
      )
    ).toBeInTheDocument()
    const bars = () =>
      screen
        .getByRole('list', { name: 'Daily consumption' })
        .querySelectorAll('[tabindex="0"]')
    expect(bars()[1].getAttribute('aria-label')).toMatch(
      /new-api, US\$ \$2\.50.*new-api, ¥ ¥20.*gpt-load value \$25\.00.*Requests 5/
    )

    await user.click(screen.getByRole('button', { name: 'new-api, ¥' }))
    expect(bars()[1].getAttribute('aria-label')).toMatch(/^.*new-api, ¥ ¥20/)

    await user.click(screen.getByRole('button', { name: 'gpt-load value' }))
    expect(bars()[1].getAttribute('aria-label')).toMatch(
      /gpt-load value \$25\.00.*new-api, US\$ \$2\.50/
    )
    expect(
      screen.getByText(
        '2 requests had no gpt-load price and are not in its value.'
      )
    ).toBeInTheDocument()
    // The card above reads the same three.
    expect(screen.getByText('$3.75')).toBeInTheDocument()
    expect(screen.getByText(/^¥30.* · gpt-load \$40\.00$/)).toBeInTheDocument()
  })

  it('offers gpt-load only once the server sends it', () => {
    render(<ActivityTab data={activity(claude)} />)
    expect(
      screen.getByRole('button', { name: 'gpt-load value' })
    ).toBeDisabled()
    expect(
      screen.getByText(/^In the range, new-api charged \$3\.75 \(¥30/)
    ).toBeInTheDocument()
  })
})

describe('a short range', () => {
  const H = 3600
  const T0 = day(0)
  const range = { start: T0, end: T0 + 3 * H - 600, days: 1, hourly: true }
  const claude: EngineDailyCost = {
    configured: true,
    cost_usd: 0,
    requests: 0,
    daily: [],
  }
  const data = activity(claude, {
    hourly: [
      { hour: T0, active_users: 2, requests: 10, quota_usd: 8 },
      { hour: T0 + H, active_users: 5, requests: 20, quota_usd: 40 },
      // Still filling: drawn, but not the busiest hour.
      { hour: T0 + 2 * H, active_users: 9, requests: 30, quota_usd: 80 },
    ],
    top_users: [
      { user_id: 1, username: 'alice', quota_usd: 20, requests: 6, share: 0.6 },
      { user_id: 2, username: 'bob', quota_usd: 10, requests: 3, share: 0.3 },
    ],
  })
  const previous = activity(claude, {
    hourly: [{ hour: T0 - 3 * H, active_users: 1, requests: 2, quota_usd: 4 }],
    top_users: [
      { user_id: 1, username: 'alice', quota_usd: 4, requests: 1, share: 0.4 },
      { user_id: 3, username: 'carol', quota_usd: 6, requests: 2, share: 0.6 },
    ],
  })

  it('draws hours against the previous period and names the busiest closed hour', () => {
    render(<ActivityTab data={data} previous={previous} range={range} />)
    const bars = screen
      .getByRole('list', { name: 'Active users by hour' })
      .querySelectorAll('[tabindex="0"]')
    expect(bars).toHaveLength(3)
    expect(bars[0].getAttribute('aria-label')).toMatch(
      /Same hour, previous period 1/
    )
    expect(
      screen.getByText(/^Busiest hour .*: 5 active users\.$/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Busiest hour .*: \$5\.00\.$/)).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Daily consumption' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('No full day in this range')).toBeInTheDocument()
  })

  it('says retention needs a longer range instead of a near-empty grid', () => {
    render(<ActivityTab data={data} range={range} />)
    expect(
      screen.getByText(
        'A short range holds only a sign-up day or two, too few to read retention.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'See the last 30 days' })
    ).toBeInTheDocument()
  })

  it('shows each top customer’s change and marks new and departed ones', () => {
    render(<ActivityTab data={data} previous={previous} range={range} />)
    expect(screen.getByText('+$2.00')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Left the list')).toBeInTheDocument()
    expect(screen.getByText('was $0.75')).toBeInTheDocument()
    expect(
      screen.getByText(
        '1 new to the list and 1 that left it or halved, against the previous period.'
      )
    ).toBeInTheDocument()
  })
})
