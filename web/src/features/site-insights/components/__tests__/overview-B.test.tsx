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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { spendConcentration } from '../../finance-analysis'
import type { UpstreamChannel, UpstreamInsights, UserSpend } from '../../types'
import { readBalance, upstreamSpendSeries } from '../../upstream'
import { CustomerConcentrationPanel, DetailsGroup } from '../finance-overview'
import { revealPanel } from '../sections'
import { UpstreamChannelCards, UpstreamSpendPanel } from '../upstream-overview'

const spend = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  getUserSpend: (hours: number) => spend.read(hours),
}))

function withClient(ui: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  )
}

function channel(overrides: Partial<UpstreamChannel>): UpstreamChannel {
  return {
    id: 1,
    name: 'relay',
    status: 1,
    priority: 0,
    host: '',
    requests: 100,
    errors: 5,
    failure_rate: 0.05,
    rescued: 0,
    revenue_usd: 0,
    cost_usd: 0,
    cost_source: 'upstream',
    monthly_fee_usd: 0,
    latest_cost_at: 0,
    latest_revenue_at: 0,
    upstream_group: '',
    upstream_group_ratio: 0,
    ttft_p50_ms: 0,
    ttft_p95_ms: 0,
    latency_p50_s: 0,
    prompt_tokens: 0,
    cache_read_tokens: 0,
    completion_tokens: 0,
    reasons: [],
    ...overrides,
  } as UpstreamChannel
}

function upstream(
  channels: UpstreamChannel[],
  daily: UpstreamInsights['daily'] = []
): UpstreamInsights {
  return {
    channels,
    models: [],
    daily,
    rescues: [],
    truncated: false,
  } as unknown as UpstreamInsights
}

describe('upstreamSpendSeries', () => {
  const rows = [
    { channel_id: 1, day: 1, cost_usd: 10 },
    { channel_id: 2, day: 1, cost_usd: 4 },
    { channel_id: 2, day: 2, cost_usd: 7 },
    { channel_id: 3, day: 2, cost_usd: 0 },
  ]
  it('names the channels that cost most and leaves out those that cost nothing', () => {
    const series = upstreamSpendSeries(rows, (row) => row.day, [1, 2])
    expect(series.named).toEqual([2, 1])
    expect(series.hasOther).toBe(false)
    expect(series.slots).toEqual([
      { slot: 1, costs: [4, 10], total: 14 },
      { slot: 2, costs: [7, 0], total: 7 },
    ])
  })

  it('folds the channels past the colors into one series', () => {
    const many = Array.from({ length: 6 }, (_, at) => ({
      channel_id: at + 1,
      day: 1,
      cost_usd: 10 - at,
    }))
    const series = upstreamSpendSeries(many, (row) => row.day, [1, 2])
    expect(series.named).toHaveLength(4)
    expect(series.hasOther).toBe(true)
    // Channels 5 and 6 cost 6 and 5.
    expect(series.slots[0].costs).toEqual([10, 9, 8, 7, 11])
    expect(series.slots[1].total).toBe(0)
  })
})

describe('readBalance', () => {
  it('is null until a balance has been read, whatever the amount', () => {
    expect(readBalance(channel({ balance: 9 }))).toBeNull()
    expect(
      readBalance(channel({ balance: 0, balance_updated_at: 100 }))
    ).toEqual({ amount: 0, at: 100 })
  })
})

describe('UpstreamChannelCards', () => {
  it('shows balance, cost and failure rate, dearest first', () => {
    render(
      <UpstreamChannelCards
        data={upstream([
          channel({ id: 1, name: 'cheap', cost_usd: 2 }),
          channel({
            id: 2,
            name: 'zhizhishu-sub',
            cost_usd: 40,
            balance: 12.5,
            balance_updated_at: 1759247000,
            failure_rate: 0.1,
          }),
          channel({ id: 3, name: 'idle', requests: 0, errors: 0 }),
        ])}
      />
    )
    const cards = screen.getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('zhizhishu-sub')
    expect(cards[0]).toHaveTextContent('$12.50')
    expect(cards[0]).toHaveTextContent('$40.00')
    expect(cards[0]).toHaveTextContent('10%')
    // No balance was read for the other.
    expect(cards[1]).toHaveTextContent('cheap')
    expect(cards[1]).not.toHaveTextContent('$12.50')
  })
})

describe('UpstreamSpendPanel', () => {
  it('stacks each day’s cost by upstream', () => {
    render(
      <UpstreamSpendPanel
        hourly={false}
        data={upstream(
          [channel({ id: 1, name: 'a' }), channel({ id: 2, name: 'b' })],
          [
            { day: 1759190400, channel_id: 1, cost_usd: 3 },
            { day: 1759190400, channel_id: 2, cost_usd: 1 },
          ] as UpstreamInsights['daily']
        )}
      />
    )
    expect(
      screen.getByRole('heading', { name: /Upstream spend by channel/ })
    ).toBeInTheDocument()
    expect(screen.getAllByText('a').length).toBeGreaterThan(0)
  })

  it('says so when no cost is known', () => {
    render(<UpstreamSpendPanel hourly={false} data={upstream([channel({})])} />)
    expect(
      screen.getByText('No upstream cost is known for this range.')
    ).toBeInTheDocument()
  })
})

describe('spendConcentration', () => {
  it('reads the top five, ten and twenty against the whole', () => {
    const users = Array.from({ length: 30 }, (_, at) => ({
      quota_usd: 30 - at,
    }))
    const rows = spendConcentration(users, 465)
    expect(rows?.map((row) => row.top)).toEqual([5, 10, 20])
    // 30+29+28+27+26 = 140 of 465.
    expect(rows?.[0].amount).toBe(140)
    expect(rows?.[0].share).toBeCloseTo(140 / 465)
    expect(rows?.[2].amount).toBe(sumTop(users, 20))
  })

  it('has no shares without consumption, and never passes the whole', () => {
    expect(spendConcentration([], 0)).toBeNull()
    expect(spendConcentration([{ quota_usd: 9 }], 5)?.[0].share).toBe(1)
  })
})

function sumTop(users: { quota_usd: number }[], count: number) {
  return users.slice(0, count).reduce((sum, row) => sum + row.quota_usd, 0)
}

describe('CustomerConcentrationPanel', () => {
  it('draws one bar per head count with the share', async () => {
    spend.read.mockResolvedValue({
      hours: 24,
      usd_exchange_rate: 1,
      customers: 30,
      quota_usd: 100,
      users: [{ quota_usd: 50 }, { quota_usd: 30 }, { quota_usd: 10 }],
    } as unknown as UserSpend)
    render(withClient(<CustomerConcentrationPanel />))
    const list = await screen.findByRole('list', {
      name: 'Share of customer consumption',
    })
    await waitFor(() => expect(list.textContent).toContain('90%'))
    expect(list).toHaveTextContent('Top 5 customers')
    expect(list).toHaveTextContent('Top 20 customers')
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(spend.read).toHaveBeenCalledWith(168))
  })

  it('says so when nobody consumed', async () => {
    spend.read.mockResolvedValue({
      hours: 24,
      usd_exchange_rate: 1,
      customers: 0,
      quota_usd: 0,
      users: [],
    } as unknown as UserSpend)
    render(withClient(<CustomerConcentrationPanel />))
    expect(
      await screen.findByText('No customer consumed anything in this window')
    ).toBeInTheDocument()
  })
})

describe('DetailsGroup', () => {
  it('stays folded until opened, and revealPanel opens it', () => {
    render(
      <DetailsGroup title='Details' hint='Plans and orders'>
        <section id='inner'>
          <h3>Orders</h3>
        </section>
      </DetailsGroup>
    )
    const toggle = screen.getByRole('button', { name: /Details/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Orders').closest('[hidden]')).not.toBeNull()
    // The panel stays in the page, so the section menu still lists it.
    revealPanel(document.querySelector('#inner') as HTMLElement)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Orders').closest('[hidden]')).toBeNull()
  })

  it('opens and shuts from its bar', () => {
    render(
      <DetailsGroup title='Details' hint='x'>
        <p>inside</p>
      </DetailsGroup>
    )
    const toggle = screen.getByRole('button', { name: /Details/ })
    fireEvent.click(toggle)
    expect(screen.getByText('inside')).toBeVisible()
    fireEvent.click(toggle)
    expect(screen.getByText('inside').closest('[hidden]')).not.toBeNull()
  })
})
