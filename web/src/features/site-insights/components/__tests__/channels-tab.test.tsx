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
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getInsights } from '../../api'
import type { ChannelInsights, ChannelRow } from '../../types'
import { ChannelsTab } from '../channels-tab'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  getInsights: vi.fn(),
}))

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderElement(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  )
}

const DAY = 86400
const END = 1_000 * DAY

function row(overrides: Partial<ChannelRow>): ChannelRow {
  return {
    segment: 'channel',
    channel: { user_id: 306, username: 'magpie' },
    tier: 'retail',
    accounts: 300,
    registered: 50,
    activated: 20,
    paid: 8,
    repeat: 3,
    revenue: 6000,
    payers: 40,
    new_payers: 10,
    consumption_usd: 3000,
    gift_consumption_usd: 200,
    granted_usd: 500,
    gift_outstanding_usd: 300,
    commission_usd: 100,
    fee_usd: 500,
    ...overrides,
  }
}

const organic = row({
  segment: 'organic',
  channel: { user_id: 0, username: '' },
  registered: 100,
  activated: 20,
  paid: 4,
  fee_usd: 0,
  commission_usd: 0,
})

function insights(channels: ChannelRow[]): ChannelInsights {
  return {
    channels,
    costs: [
      {
        user_id: 306,
        monthly_usd: 1000,
        start: END - 60 * DAY,
        end: 0,
        note: '',
      },
    ],
    usd_exchange_rate: 7,
  }
}

const range = (days: number) => ({
  start: END - days * DAY,
  end: END,
  days,
  hourly: days <= 3,
})

afterEach(() => vi.mocked(getInsights).mockReset())

describe('ChannelsTab', () => {
  it('does not judge a day: verdict, ROI and fee per new payer say why', async () => {
    vi.mocked(getInsights).mockResolvedValue(
      insights([row({ revenue: 20000 })])
    )
    render(<ChannelsTab data={insights([row({})])} range={range(1)} />)
    expect(
      screen.getByText(
        /A range under 7 days cannot judge a channel: read 30 days or the contract to date\./
      )
    ).toBeTruthy()
    expect(
      screen.getAllByText('Not judged over a range under 7 days')
    ).toHaveLength(2)
    expect(
      screen.getByText(/the monthly fee prorated over the range/)
    ).toBeTruthy()
    expect(screen.queryByText(/Projected month/)).toBeNull()
  })

  it('reads the contract to date once, from the earliest fee', async () => {
    vi.mocked(getInsights).mockResolvedValue(
      insights([row({ revenue: 20000, fee_usd: 2000 })])
    )
    render(<ChannelsTab data={insights([row({})])} range={range(30)} />)
    expect(screen.getByText('Contract to date')).toBeTruthy()
    // Revenue 20,000 less a ¥14,000 fee and ¥200 of gifts.
    expect(await screen.findByText('¥5,800')).toBeTruthy()
    expect(getInsights).toHaveBeenCalledTimes(1)
    expect(getInsights).toHaveBeenCalledWith('channels', {
      start_time: END - 60 * DAY,
      end_time: END,
    })
  })

  it('gives a date to break even at the current daily net', async () => {
    vi.mocked(getInsights).mockResolvedValue(
      insights([row({ revenue: 10000, fee_usd: 2000 })])
    )
    // Current 30 days net 6000 - 3500 - 200 = 2300, 76.67 a day; the
    // contract's -4200 is 55 days away.
    render(<ChannelsTab data={insights([row({})])} range={range(30)} />)
    expect(await screen.findByText('In 55 days')).toBeTruthy()
  })

  it('shows a failed contract read in its panel', async () => {
    vi.mocked(getInsights).mockRejectedValue(new Error('read failed'))
    render(<ChannelsTab data={insights([row({})])} range={range(30)} />)
    expect(await screen.findByText('read failed')).toBeTruthy()
  })

  it('lifts against organic, mutes small cohorts, and labels unspent as now', async () => {
    vi.mocked(getInsights).mockResolvedValue(insights([row({})]))
    const small = row({
      channel: { user_id: 9, username: 'tiny' },
      registered: 5,
      activated: 5,
      paid: 5,
      fee_usd: 0,
    })
    render(
      <ChannelsTab
        data={insights([row({ revenue_new_accounts: 1500 }), small, organic])}
        range={range(30)}
      />
    )
    // 20/50 and 8/50 against organic's 20/100 and 4/100.
    expect(screen.getByText('Active 2.00×, paid 4.00×')).toBeTruthy()
    expect(screen.getByText('Unspent now')).toBeTruthy()
    expect(screen.getByText('From new accounts')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText(/Projected month/)).toBeTruthy()
    await waitFor(() => expect(getInsights).toHaveBeenCalled())
  })
})
