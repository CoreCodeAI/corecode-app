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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { CapacityInsights, EngineGroup } from '../../types'
import { CapacityTab } from '../capacity-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

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

function insights(): CapacityInsights {
  return {
    requests: 10,
    errors: 0,
    peak_concurrency: 3,
    peak_at: 0,
    peak_rpm: 2,
    peak_rpm_at: 0,
    error_categories: [],
    hourly: [],
    user_peaks: [],
    truncated: false,
    in_flight: 7,
    in_flight_users: [],
    user_limits: [],
    limit_rejections: [],
    limit_rejection_total: 4,
    limit_rejected_users: [],
    concurrency_limits: null,
    concurrency_tiers: null,
    pool: {
      configured: true,
      observed_at_ms: 0,
      credential_concurrency: 5,
      five_hour_budget: 90,
      seven_day_budget: 95,
      eligible_accounts: 3,
      effective_slots: 30,
      in_flight: 0,
      groups: [
        group({
          id: 1,
          channel: 'claude',
          accounts: 4,
          slots: 20,
          in_flight: 5,
        }),
        group({
          id: 2,
          channel: 'codex',
          accounts: 1,
          slots: 10,
          in_flight: 2,
        }),
      ],
      accounts: [],
      five_hour_estimate: null,
      week_estimate: null,
      refills: [],
    },
  } as unknown as CapacityInsights
}

const client = new QueryClient()
const wrapper = (props: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
)

describe('capacity tab by provider', () => {
  it('offers every provider and reports which one was picked', async () => {
    const onVendor = vi.fn()
    render(<CapacityTab data={insights()} vendor='all' onVendor={onVendor} />, {
      wrapper,
    })
    expect(screen.getByText('All providers')).toBeTruthy()
    await userEvent.click(screen.getByText('Codex'))
    expect(onVendor).toHaveBeenCalledWith('codex')
  })

  it('shows per-user limits only across every provider', () => {
    const { rerender } = render(
      <CapacityTab data={insights()} vendor='all' />,
      { wrapper }
    )
    expect(screen.getByText('Per-user limit 429')).toBeTruthy()
    expect(screen.getByText('Peak concurrency by user')).toBeTruthy()
    expect(screen.getByText('30 pool slots')).toBeTruthy()

    rerender(<CapacityTab data={insights()} vendor='codex' />)
    expect(screen.queryByText('Per-user limit 429')).toBeNull()
    expect(screen.queryByText('Peak concurrency by user')).toBeNull()
    // Codex's own slots and in-flight count, from its engine groups.
    expect(screen.getByText('10 pool slots')).toBeTruthy()
    expect(screen.getAllByText('Upstream rate limit').length).toBeGreaterThan(0)
  })
})
