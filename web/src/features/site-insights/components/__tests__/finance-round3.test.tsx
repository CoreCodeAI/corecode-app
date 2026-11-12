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
import {
  render as renderElement,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { FinanceInsights } from '../../types'
import { GroupConsumptionPanel } from '../finance-insights'
import { FinanceTab } from '../finance-tab'

// The user table at the bottom reads its own window; these tests are about
// the rest of the view, so its read never settles.
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  getUserSpend: () => new Promise(() => undefined),
}))

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderElement(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  )
}

const day = (offset: number) => 1761408000 + offset * 86400

function funds(overrides: Partial<FinanceInsights>): FinanceInsights {
  return {
    revenue: 14,
    topup_revenue: 0,
    subscription_revenue: 14,
    orders: 1,
    paying_users: 1,
    methods: [],
    daily: [
      {
        day: day(0),
        topup: 0,
        subscription: 14,
        consumption_usd: 16,
        recognized_revenue: 10.8,
        claude_usd: 0,
      },
      {
        day: day(1),
        topup: 0,
        subscription: 0,
        consumption_usd: 9,
        recognized_revenue: 6.8,
        claude_usd: 0,
      },
    ],
    consumption_usd: 25,
    root_consumption_usd: 30,
    gift_consumption_usd: 8,
    revenue_per_usd: 0.56,
    recognized_revenue: 17.6,
    liability_usd: 50,
    liability_paid_value: 40,
    liability_users: 1,
    debt_usd: -0.5,
    debtors: [],
    top_balances: [],
    adjustments: [],
    adjustment_net_usd: 0,
    commission_usd: 0,
    redemption_usd: 0,
    bonus_usd: 0,
    topup_credit_usd: 0,
    adjustment_logs_found: false,
    claude_usd: 0,
    engine_cost: { configured: false, cost_usd: 0, requests: 0, daily: [] },
    matched_official_usd: 0,
    matched_claude_usd: 0,
    official_per_usd: 0,
    plans: [],
    ...overrides,
  } as FinanceInsights
}

const adjustment = {
  created_at: day(0),
  operator: 'operator-a',
  target: { user_id: 7, username: 'user-a' },
  mode: 'add',
  request_usd: 30,
  before_usd: 0,
  after_usd: 30,
  delta_usd: 30,
  success: true,
  has_snapshot: true,
}

describe('manual adjustments on the funds view', () => {
  it('says how many adjustments the list shows of all in the range', () => {
    render(
      <FinanceTab
        data={funds({
          adjustments: [adjustment],
          adjustments_total: 1200,
          adjustments_truncated: true,
        })}
      />
    )
    expect(
      screen.getByText('Showing the newest 1 of 1,200.')
    ).toBeInTheDocument()
  })

  it('says nothing about a list that is not cut', () => {
    render(
      <FinanceTab
        data={funds({
          adjustments: [adjustment],
          adjustments_total: 1,
          adjustments_truncated: false,
        })}
      />
    )
    expect(screen.queryByText(/Showing the newest/)).toBeNull()
  })

  it('takes the net and the share from the server’s net over the whole range', () => {
    render(
      <FinanceTab
        data={funds({
          adjustments: [adjustment],
          adjustment_net_usd: 30,
          adjustments_total: 1,
        })}
      />
    )
    // The list holds one ¥30 row; the net the server sends covers the range.
    expect(
      screen.getByText('¥30 in all; manual adjustments are 100%.')
    ).toBeInTheDocument()
  })
})

describe('funds help that says what the code counts', () => {
  it('puts spending bonus credit in the gifted part and lowers the average price', async () => {
    const user = userEvent.setup()
    render(<FinanceTab data={funds({ bonus_usd: 5 })} />)
    await user.hover(screen.getByRole('button', { name: 'Top-up bonus' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'Credit added free on top of a top-up. Spending it counts in the gifted part of consumption, and it lowers the average price paid per quota dollar, so revenue earned stays right.'
        )
      ).toBeInTheDocument()
    )
  })

  it('calls revenue by price group a pro-rata estimate, not a margin', async () => {
    const user = userEvent.setup()
    const group = {
      group: 'default',
      requests: 1,
      users: 1,
      tokens: 1,
      consumption_usd: 10,
      share: 1,
      ratio: 1,
      list_usd: 10,
      revenue_estimate: 6,
    }
    render(<GroupConsumptionPanel data={funds({ groups: [group] })} />)
    await user.click(
      screen.getByRole('button', { name: 'How this is counted' })
    )
    expect(
      await screen.findByText(
        /Revenue \(est\.\) is consumption’s pro-rata share of the range’s revenue earned: an estimate, not a margin/
      )
    ).toBeInTheDocument()
  })
})

describe('the funds view before the logs begin', () => {
  it('leaves a day before the logs unmarked as zero: it has no bar', () => {
    render(<FinanceTab data={funds({ logs_since: day(1) })} />)
    const chart = screen.getByRole('list', { name: 'Daily revenue' })
    const bars = chart.querySelectorAll('[tabindex="0"]')
    expect(bars[0].getAttribute('aria-label')).toMatch(/No data/)
    expect(bars[1].getAttribute('aria-label')).not.toMatch(/No data/)
  })

  it('says the previous period has no data when it lies before the logs', () => {
    render(
      <FinanceTab
        data={funds({
          start_time: day(0),
          end_time: day(2),
          logs_since: day(0) + 3600,
        })}
        previous={funds({})}
      />
    )
    expect(screen.getAllByText('No data to compare').length).toBeGreaterThan(0)
  })

  it('keeps a previous period with logs in the comparison', () => {
    render(
      <FinanceTab
        data={funds({
          start_time: day(2),
          end_time: day(4),
          logs_since: day(0),
        })}
        previous={funds({})}
      />
    )
    expect(screen.queryByText('No data to compare')).toBeNull()
  })
})
