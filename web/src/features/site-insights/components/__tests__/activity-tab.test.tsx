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

import type { ActivityInsights, EngineDailyCost } from '../../types'
import { ActivityTab } from '../growth-tab'

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
