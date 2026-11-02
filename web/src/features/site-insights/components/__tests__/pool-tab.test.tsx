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

import type {
  EngineAccount,
  EngineGroup,
  EnginePool,
  EngineRunway,
} from '../../types'
import { PoolTab } from '../pool-tab'
import { Breakdown } from '../shared'

function group(overrides: Partial<EngineGroup>): EngineGroup {
  return {
    id: 1,
    name: 'group',
    channel: 'claude',
    enabled: true,
    in_flight: 0,
    effective_limit: 10,
    override_limit: null,
    accounts: 1,
    eligible: 1,
    slots: 5,
    counts: null,
    quota_budget: true,
    five_hour_budget: 90,
    seven_day_budget: 95,
    ...overrides,
  }
}

function account(overrides: Partial<EngineAccount>): EngineAccount {
  return {
    credential_id: 1,
    group_id: 1,
    group: 'group',
    email_mask: 'a***@example.com',
    plan: 'Pro',
    tier: 'default',
    status: 'available',
    five_hour: 42,
    seven_day: 10,
    five_hour_reset_ms: 0,
    seven_day_reset_ms: 0,
    cooldown_until_ms: 0,
    eligible: true,
    active: 0,
    sessions: 0,
    observed_at_ms: 0,
    observation: '',
    successes: 0,
    failures: 0,
    last_used_at_ms: 0,
    last_failure: '',
    last_failure_at_ms: 0,
    five_hour_remaining_usd: 15,
    seven_day_remaining_usd: 150,
    burn_usd_per_hour: null,
    ...overrides,
  }
}

function pool(groups: EngineGroup[], accounts: EngineAccount[]): EnginePool {
  return {
    configured: true,
    observed_at_ms: 0,
    credential_concurrency: 5,
    five_hour_budget: 90,
    seven_day_budget: 95,
    eligible_accounts: accounts.length,
    effective_slots: 5,
    in_flight: 0,
    groups,
    accounts,
    five_hour_estimate: null,
    week_estimate: null,
    refills: [],
  }
}

function budgetLine(meter: HTMLElement) {
  return meter.querySelector<HTMLElement>('span')?.style.left ?? null
}

describe('pool account quota meters', () => {
  it('draws each account against its own group budget', () => {
    render(
      <PoolTab
        data={pool(
          [
            group({ id: 1, name: 'strict', five_hour_budget: 70 }),
            group({ id: 2, name: 'open', quota_budget: false }),
          ],
          [
            account({ credential_id: 1, group_id: 1, five_hour: 42 }),
            account({ credential_id: 2, group_id: 2, five_hour: 130 }),
          ]
        )}
      />
    )

    const [strict, open] = screen.getAllByRole('meter', {
      name: /^5-hour window/,
    })
    expect(strict).toHaveAttribute('aria-valuenow', '42')
    expect(budgetLine(strict)).toBe('70%')
    // No budget means no line, and a reading past 100% stays inside the bar.
    expect(open).toHaveAttribute('aria-valuenow', '100')
    expect(budgetLine(open)).toBeNull()
  })

  it('explains the window when its cell is hovered', async () => {
    const user = userEvent.setup()
    render(<PoolTab data={pool([group({})], [account({ five_hour: 42 })])} />)

    await user.hover(screen.getByRole('meter', { name: /^5-hour window/ }))

    const tooltip = await screen.findByText('Left before the line')
    expect(tooltip.closest('[data-slot=tooltip-content]')).toHaveTextContent(
      /Budget line\s*90%/
    )
  })
})

function runway(overrides: Partial<EngineRunway>): EngineRunway {
  return {
    channel: 'claude',
    burn_usd_per_hour: 40,
    week_to_date_usd_per_hour: 44,
    sustainable_usd_per_hour: 32,
    peak_usd_per_hour: 120,
    week_remaining_usd: 2000,
    week_capacity_usd: 5376,
    week_load: 1.25,
    short_hours: 0,
    served_share: 1,
    horizon_hours: 168,
    lowest_usd: 50,
    lowest_hours: 100,
    week_hours: null,
    first_short_hours: null,
    counted: 8,
    unknown: 0,
    ...overrides,
  }
}

function renderRunway(overrides: Partial<EngineRunway>) {
  render(
    <PoolTab
      data={{
        ...pool([group({})], [account({})]),
        runway: runway(overrides),
      }}
    />
  )
}

describe('pool supply', () => {
  it('sets demand against what the resets bring back', () => {
    renderRunway({})

    expect(screen.getByText('125%')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Weekly load' })).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
    // $8/h short for a week.
    expect(
      screen.getByText(/about \$1,344 more weekly capacity/)
    ).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
    expect(screen.getByText('$120/h')).toBeInTheDocument()
    expect(screen.getByText('3.00× the demand')).toBeInTheDocument()
  })

  it('reads a near miss as the tightest point, not as running out', () => {
    renderRunway({})

    expect(screen.getByText('$50')).toBeInTheDocument()
    expect(screen.getByText(/· 1.3 hours of demand$/)).toBeInTheDocument()
    expect(
      screen.getByText(/tightest around .* with \$50 left/)
    ).toBeInTheDocument()
  })

  it('reports a gap with its start, length and total', () => {
    renderRunway({
      week_hours: 30,
      first_short_hours: 0.25,
      short_hours: 20,
      served_share: 0.88,
      lowest_usd: 0,
      lowest_hours: 30,
    })

    expect(screen.getByText('≈ 20.0 hours')).toBeInTheDocument()
    expect(screen.getByText(/· 88% of demand served$/)).toBeInTheDocument()
    expect(
      screen.getByText(
        /first runs out around .* for 15 minutes; 20.0 hours without quota in all/
      )
    ).toBeInTheDocument()
  })

  it('reads one gap once', () => {
    renderRunway({
      week_hours: 30,
      first_short_hours: 6,
      short_hours: 6,
      served_share: 0.96,
      lowest_usd: 0,
      lowest_hours: 30,
    })

    expect(
      screen.getByText(/the quota runs out around .* for 6.0 hours\.$/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/without quota in all/)).toBeNull()
  })

  it('draws the quota left hour by hour and reads out each hour', async () => {
    const user = userEvent.setup()
    renderRunway({ curve: [400, 0, 0, 200, 100] })

    const chart = screen.getByRole('img', {
      name: /\$400 now, least \$0 around/,
    })
    expect(screen.getByText('No quota left')).toBeInTheDocument()

    await user.click(chart)
    expect(screen.getByRole('status')).toHaveTextContent('$400')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent('No quota left')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent('$200')
  })

  it('leaves the curve out for a server that sends none', () => {
    renderRunway({})
    expect(screen.queryByRole('img', { name: /quota left over/ })).toBeNull()
  })

  it('stays hidden for a server that sends the first runway', () => {
    const first = { ...runway({}) } as Partial<EngineRunway>
    delete first.sustainable_usd_per_hour
    render(
      <PoolTab
        data={{
          ...pool([group({})], [account({})]),
          runway: first as EngineRunway,
        }}
      />
    )
    expect(screen.queryByText('Claude pool supply')).toBeNull()
  })
})

describe('breakdown rows', () => {
  it('shows the full name, count and share on hover', async () => {
    const user = userEvent.setup()
    const name = 'a failure reason long enough that the row truncates it'
    render(
      <Breakdown
        items={[
          { name, count: 3 },
          { name: 'other', count: 1 },
        ]}
        empty='none'
      />
    )

    await user.hover(screen.getByRole('generic', { name: new RegExp(name) }))

    const tooltip = await screen.findByText('3 of 4 · 75%')
    expect(tooltip.closest('[data-slot=tooltip-content]')).toHaveTextContent(
      name
    )
  })
})
