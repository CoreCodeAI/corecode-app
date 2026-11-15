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
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TONES } from '../../lib'
import type {
  EnginePlanCount,
  EnginePlanUsage,
  FinanceInsights,
} from '../../types'
import { ClaudeEconomics } from '../claude-economics'

// Ten days of range, so each plan's cost is its month times 10 / 30.
const START = 1761408000
const END = START + 10 * 86400

const pool: EnginePlanCount[] = [
  {
    vendor: 'claude',
    plan: 'Max',
    tier: 'default_claude_max_5x',
    accounts: 2,
    eligible: 2,
  },
  {
    vendor: 'claude',
    plan: 'Pro',
    tier: 'default_claude_pro',
    accounts: 1,
    eligible: 1,
  },
  {
    vendor: 'claude',
    plan: 'Team',
    tier: 'team_standard',
    accounts: 1,
    eligible: 1,
  },
]

const usage: EnginePlanUsage = {
  plans: [
    {
      plan: 'Max',
      tier: 'default_claude_max_5x',
      accounts: 2,
      requests: 40,
      failures: 2,
      served_usd: 60,
      added_in_range: 1,
    },
    {
      plan: 'Pro',
      tier: 'default_claude_pro',
      accounts: 1,
      requests: 3,
      failures: 0,
      served_usd: 5,
      added_in_range: 0,
    },
    {
      plan: 'Team',
      tier: 'team_standard',
      accounts: 1,
      requests: 20,
      failures: 0,
      served_usd: 30,
      added_in_range: 0,
    },
  ],
  removed: { accounts: 1, requests: 2, failures: 0, served_usd: 10 },
  unattributed: { accounts: 0, requests: 1, failures: 0, served_usd: 5 },
}

function finance(extra: Partial<FinanceInsights>): FinanceInsights {
  return {
    revenue: 0,
    topup_revenue: 0,
    subscription_revenue: 0,
    orders: 0,
    paying_users: 0,
    methods: [],
    daily: [],
    consumption_usd: 0,
    claude_usd: 0,
    revenue_per_usd: 0,
    liability_usd: 0,
    liability_users: 0,
    debt_usd: 0,
    debtors: [],
    top_balances: [],
    adjustments: [],
    adjustment_net_usd: 0,
    commission_usd: 0,
    redemption_usd: 0,
    bonus_usd: 0,
    topup_credit_usd: 0,
    engine_cost: { configured: true, cost_usd: 0, requests: 0, daily: [] },
    matched_official_usd: 0,
    matched_claude_usd: 0,
    official_per_usd: 0,
    plans: [],
    plan_accounts: pool,
    start_time: START,
    end_time: END,
    matched_since: START,
    usd_exchange_rate: 1,
    ...extra,
  }
}

function rowOf(name: RegExp) {
  return screen.getByRole('row', { name })
}

describe('served value by plan in the account-cost table', () => {
  afterEach(() => cleanup())

  it('adds served, served ÷ cost and share to each plan', () => {
    render(<ClaudeEconomics data={finance({ plan_usage: usage })} />)
    expect(screen.getByText('Served ÷ cost')).toBeInTheDocument()

    const max = within(rowOf(/default_claude_max_5x/)).getAllByRole('cell')
    expect(max[6].textContent).toContain('$60.00')
    expect(max[6].textContent).toContain('40 requests')
    expect(max[7].textContent).toBe('0.90×')
    expect(max[8].textContent).toBeTruthy()

    const team = within(rowOf(/team_standard/)).getAllByRole('cell')
    expect(team[7].textContent).toBe('3.60×')
  })

  it('colors a ratio under 1× only for a plan with enough requests', () => {
    render(<ClaudeEconomics data={finance({ plan_usage: usage })} />)
    const maxRatio = within(rowOf(/default_claude_max_5x/)).getAllByRole(
      'cell'
    )[7]
    expect(maxRatio.querySelector('span')?.className).toContain(TONES.danger)

    // Three requests is under the floor, so its 0.75× is not colored.
    const proRatio = within(rowOf(/default_claude_pro/)).getAllByRole('cell')[7]
    expect(proRatio.textContent).toBe('0.75×')
    expect(proRatio.querySelector('span')?.className ?? '').not.toContain(
      TONES.danger
    )
  })

  it('names the plan that returns the most and the least per dollar', () => {
    render(<ClaudeEconomics data={finance({ plan_usage: usage })} />)
    expect(
      screen.getByText(
        'Most served per dollar: Team Standard at 3.60×; least: Max 5x at 0.90×.'
      )
    ).toBeInTheDocument()
  })

  it('lists removed accounts and unattributed use muted, after the plans', () => {
    render(<ClaudeEconomics data={finance({ plan_usage: usage })} />)
    const rows = screen.getAllByRole('row').slice(1)
    const names = rows.map((row) => row.textContent ?? '')
    const removedAt = names.findIndex((name) =>
      name.includes('Accounts removed')
    )
    const unattributedAt = names.findIndex((name) =>
      name.includes('Not attributed')
    )
    expect(removedAt).toBeGreaterThan(
      names.findIndex((name) => name.includes('team_standard'))
    )
    expect(unattributedAt).toBeGreaterThan(removedAt)
    const removed = within(rows[removedAt]).getAllByRole('cell')
    expect(removed[1].textContent).toBe('1')
    expect(removed[3].textContent).toBe('-')
    expect(removed[7].textContent).toBe('-')
  })

  it('names the accounts added inside the range', () => {
    render(<ClaudeEconomics data={finance({ plan_usage: usage })} />)
    expect(
      screen.getByText(
        '1 accounts that served were added inside this range; their cost counts the whole range, so their served ÷ cost reads low.'
      )
    ).toBeInTheDocument()
  })

  it('shows no served columns on a server or engine without plan_usage', () => {
    render(<ClaudeEconomics data={finance({})} />)
    expect(screen.queryByText('Served ÷ cost')).toBeNull()
    expect(screen.queryByText('Accounts removed')).toBeNull()
    expect(screen.getByText('Account cost')).toBeInTheDocument()
  })

  it('reports a failed usage read beside the table and no served columns', () => {
    render(
      <ClaudeEconomics
        data={finance({
          plan_usage_error: 'engine usage credentials: HTTP 503',
        })}
      />
    )
    expect(
      screen.getByText('engine usage credentials: HTTP 503')
    ).toBeInTheDocument()
    expect(screen.queryByText('Served ÷ cost')).toBeNull()
  })
})
