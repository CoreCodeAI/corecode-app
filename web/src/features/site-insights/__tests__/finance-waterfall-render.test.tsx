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
import { describe, expect, it } from 'vitest'

import { OrdersPanel } from '../components/finance-insights'
import { ProfitWaterfallPanel } from '../components/profit-waterfall'
import type { FinanceInsights } from '../types'

// The 2026-11-15 range in yuan at a rate of 7: see profit-waterfall.test.ts.
const finance = {
  start_time: 0,
  end_time: 7 * 86400,
  usd_exchange_rate: 7,
  vendor_revenue: [
    {
      vendor: 'claude',
      customer_usd: 0,
      share: 0.6,
      recognized_revenue: 23193,
    },
    { vendor: 'codex', customer_usd: 0, share: 0.4, recognized_revenue: 15462 },
  ],
  plan_accounts: [],
  vendor_upstream: [
    {
      vendor: 'codex',
      bill_usd: 3813,
      fee_usd: 0,
      costed_revenue_usd: 0,
      uncosted_revenue_usd: 0,
      oldest_bill_at: 0,
      channels: [],
    },
  ],
  upstream_unattributed_bill_usd: 0,
  upstream_unattributed_fee_usd: 0,
  channel_fee_usd: 368.14,
  commission_usd: 3082,
  order_methods: [
    {
      payment_method: 'stripe_card',
      created: 56,
      paid: 6,
      failed: 50,
      expired: 0,
      pending: 0,
      pending_stale: 0,
      plan_orders: 0,
      paid_money: 600,
      completion_rate: 6 / 56,
    },
  ],
} as unknown as FinanceInsights

describe('ProfitWaterfallPanel', () => {
  it('draws each step with the gross margin in its place and the remainder last', () => {
    render(<ProfitWaterfallPanel data={finance} />)
    expect(screen.getByText('Profit waterfall')).toBeInTheDocument()
    const rows = screen
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(rows).toHaveLength(8)
    expect(rows[0]).toContain('Recognized revenue')
    expect(rows[4]).toContain('Gross margin')
    expect(rows[4]).toContain('90.1%')
    expect(rows[7]).toContain('Left after these costs')
    expect(rows[7]).toContain('75.5%')
    expect(screen.getByText(/not net profit/)).toBeInTheDocument()
  })

  it('is hidden on a server that does not send channel_fee_usd', () => {
    const older = { ...finance, channel_fee_usd: undefined } as FinanceInsights
    const { container } = render(<ProfitWaterfallPanel data={older} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows its skeleton while the funds view loads', () => {
    render(<ProfitWaterfallPanel data={undefined} />)
    expect(screen.getByText('Profit waterfall')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })
})

describe('OrdersPanel', () => {
  it('adds the unpaid estimate column and names a method that mostly fails', () => {
    render(<OrdersPanel data={finance} />)
    expect(screen.getByText('Unpaid, up to')).toBeInTheDocument()
    expect(screen.getByText(/of settled checkouts/)).toBeInTheDocument()
    expect(screen.getByText(/upper estimate/)).toBeInTheDocument()
  })
})
