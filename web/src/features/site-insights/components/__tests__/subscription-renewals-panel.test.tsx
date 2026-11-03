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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { saveSubscriptionRenewal } from '../../api'
import type { EngineAccount } from '../../types'
import { SubscriptionRenewalsPanel } from '../subscription-renewals-panel'

vi.mock('../../api', () => ({ saveSubscriptionRenewal: vi.fn() }))

function withQuery(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

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
      withQuery(
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

  it('saves the date entered for an organization', async () => {
    const user = userEvent.setup()
    vi.mocked(saveSubscriptionRenewal).mockResolvedValue()
    render(
      withQuery(
        <SubscriptionRenewalsPanel
          now={NOW}
          accounts={[
            account({
              plan: 'Max',
              organization: 'Max seat',
              organization_uuid: '0f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
              subscription_status: 'past_due',
              subscription_state: 'estimated',
              subscription_period_end_ms: NOW + 26 * DAY,
            }),
            account({
              credential_id: 2,
              organization: 'Codex org',
              subscription_state: 'confirmed',
              subscription_period_end_ms: NOW + 10 * DAY,
            }),
          ]}
        />
      )
    )

    expect(screen.getByText('past_due')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Set renewal date' })
    expect(buttons).toHaveLength(1)
    await user.click(buttons[0])
    const input = screen.getByLabelText('Renewal date')
    await user.clear(input)
    await user.type(input, '2026-11-09')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(saveSubscriptionRenewal).toHaveBeenCalledWith({
      organizationUUID: '0f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
      renewsOn: '2026-11-09',
      organizationName: 'Max seat',
    })
  })

  it('shows nothing before the engine reports any date', () => {
    const { container } = render(
      withQuery(
        <SubscriptionRenewalsPanel now={NOW} accounts={[account({})]} />
      )
    )
    expect(container.innerHTML).toBe('')
  })
})
