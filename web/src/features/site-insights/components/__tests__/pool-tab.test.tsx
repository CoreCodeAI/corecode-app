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
    burn_usd_per_hour: 10,
    week_remaining_usd: 300,
    week_capacity_usd: 2000,
    week_load: 0.84,
    week_hours: 30,
    horizon_hours: 336,
    five_hour_remaining_usd: 25,
    five_hour_hours: 2.5,
    counted: 4,
    unknown: 1,
    ...overrides,
  }
}

describe('pool runway', () => {
  it('reads out when the weekly quota runs dry and the load behind it', () => {
    render(
      <PoolTab
        data={{ ...pool([group({})], [account({})]), runway: runway({}) }}
      />
    )

    expect(screen.getByText('≈ 30.0 hours')).toBeInTheDocument()
    expect(screen.getByText('≈ 2.5 hours')).toBeInTheDocument()
    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Weekly load' })).toHaveAttribute(
      'aria-valuenow',
      '84'
    )
    expect(
      screen.getByText('4 accounts counted, 1 without an estimate')
    ).toBeInTheDocument()
  })

  it('says the pool keeps up when it lasts past the horizon', () => {
    render(
      <PoolTab
        data={{
          ...pool([group({})], [account({})]),
          runway: runway({ week_hours: null, week_load: 0.4 }),
        }}
      />
    )

    expect(screen.getByText('> 14.0 days')).toBeInTheDocument()
    expect(
      screen.getByText(
        /weekly resets keep up with demand for at least 14.0 days/
      )
    ).toBeInTheDocument()
  })

  it('stays hidden before the server sends it', () => {
    render(<PoolTab data={pool([group({})], [account({})])} />)
    expect(screen.queryByText('Claude pool runway')).toBeNull()
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
