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
import { describe, expect, it } from 'vitest'

import type { EngineAccount } from '../../types'
import { SubscriptionRenewalsPanel } from '../subscription-renewals-panel'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 3)

function account(overrides: Partial<EngineAccount>): EngineAccount {
  return {
    credential_id: 1,
    group_id: 1,
    group: 'group',
    email_mask: 'a***@example.com',
    plan: 'Pro',
    tier: 'default',
    status: 'available',
    five_hour: 0,
    seven_day: 0,
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
    five_hour_remaining_usd: null,
    seven_day_remaining_usd: null,
    burn_usd_per_hour: null,
    ...overrides,
  }
}

describe('SubscriptionRenewalsPanel', () => {
  it('lists one row per subscription, soonest first', () => {
    render(
      <SubscriptionRenewalsPanel
        now={NOW}
        accounts={[
          account({
            credential_id: 1,
            group: 'Team-A',
            email_mask: 'r***@a.com',
            plan: 'Team',
            organization: 'A Team',
            subscription_state: 'estimated',
            subscription_period_end_ms: NOW + 18 * DAY,
          }),
          account({
            credential_id: 2,
            group: 'Team-A',
            email_mask: 'h***@a.com',
            plan: 'Team',
            organization: 'A Team',
            subscription_state: 'estimated',
            subscription_period_end_ms: NOW + 18 * DAY,
          }),
          account({
            credential_id: 3,
            group: 'Solo',
            email_mask: 'b***@b.com',
            plan: 'Max',
            organization: 'B Studio',
            subscription_state: 'confirmed',
            subscription_period_end_ms: NOW + 3 * DAY,
          }),
          account({
            credential_id: 4,
            group: 'Solo',
            email_mask: 'n***@n.com',
          }),
        ]}
      />
    )

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('B Studio')).toBeTruthy()
    expect(within(rows[0]).getByText('3 days')).toBeTruthy()
    expect(within(rows[0]).queryByText('estimated')).toBeNull()
    expect(within(rows[1]).getByText('A Team')).toBeTruthy()
    expect(within(rows[1]).getByText(/2 seats/)).toBeTruthy()
    expect(within(rows[1]).getByText('estimated')).toBeTruthy()
    expect(within(rows[1]).getByText('18 days')).toBeTruthy()
    expect(screen.getByText('Renewing within 7 days: B Studio.')).toBeTruthy()
    expect(screen.queryByText('n***@n.com')).toBeNull()
  })

  it('shows nothing before the engine reports any date', () => {
    const { container } = render(
      <SubscriptionRenewalsPanel now={NOW} accounts={[account({})]} />
    )
    expect(container.innerHTML).toBe('')
  })
})
