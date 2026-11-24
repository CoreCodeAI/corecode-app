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
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type {
  ChannelInsights,
  ChannelRow,
  CustomerInsights,
  RetentionWeek,
  SpendTierGroup,
} from '../../types'
import { ChannelBarsPanel, ChannelDailyPanel } from '../channels-signups'
import {
  RankBars,
  SignupMoneyChart,
  SilentPayersPanel,
  StackedFunnel,
  WeeklySignupsPanel,
} from '../growth-charts'
import {
  ChurnWatchPanel,
  CustomersPanel,
  SpendTiersPanel,
} from '../growth-customers'
import { WeeklyRetentionPanel } from '../retention-weeks'

const midnight = (offset: number) =>
  Math.floor(new Date(2026, 0, 5 + offset).getTime() / 1000)

describe('weekly sign-ups', () => {
  it('leaves the panel out when the range holds a single week', () => {
    const daily = Array.from({ length: 5 }, (_, index) => ({
      day: midnight(index),
      registered: 2,
      activated: 1,
      paid: 0,
    }))
    const { container } = render(<WeeklySignupsPanel daily={daily} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the best full week past the first', () => {
    const daily = Array.from({ length: 14 }, (_, index) => ({
      day: midnight(index),
      registered: index < 7 ? 1 : 4,
      activated: 1,
      paid: 0,
    }))
    render(<WeeklySignupsPanel daily={daily} />)
    expect(screen.getByText('Sign-ups by week')).toBeInTheDocument()
    expect(
      screen.getByText(/Best full week: .*, 28 sign-ups\./)
    ).toBeInTheDocument()
  })
})

describe('sign-ups and money chart', () => {
  it('reads both figures of a day when it is focused', async () => {
    const user = userEvent.setup()
    render(
      <SignupMoneyChart
        ariaLabel='Sign-ups and money paid by day'
        days={[
          { day: midnight(0), registered: 3, money: 0, payers: 0 },
          { day: midnight(1), registered: 7, money: 250, payers: 2 },
        ]}
      />
    )
    const chart = screen.getByRole('img', {
      name: 'Sign-ups and money paid by day',
    })
    expect(chart).toBeInTheDocument()
    await user.click(
      screen.getByLabelText(/7 sign-ups · .*250.* paid by 2 accounts/)
    )
    expect(screen.getByTestId('signup-money-readout')).toHaveTextContent(
      /7 sign-ups · .*250.* paid by 2 accounts/
    )
  })
})

describe('stacked funnel', () => {
  const label = (segment: string) => `Via ${segment}`

  it('draws a bar per segment, the largest first, with the paid share beside it', () => {
    render(
      <StackedFunnel
        label={label}
        empty='Nothing'
        rows={[
          {
            segment: 'github',
            registered: 10,
            activated: 6,
            paid: 2,
            repeat: 1,
          },
          {
            segment: 'email',
            registered: 50,
            activated: 20,
            paid: 10,
            repeat: 4,
          },
          { segment: 'none', registered: 0, activated: 0, paid: 0, repeat: 0 },
        ]}
      />
    )
    const bars = screen.getAllByRole('img')
    expect(bars).toHaveLength(2)
    expect(bars[0]).toHaveAccessibleName(
      'Via email: 50 sign-ups, 40% activated, 20% paid'
    )
    expect(screen.getAllByText('paid 20%')).toHaveLength(2)
    expect(screen.queryByText('Via none')).toBeNull()
  })

  it('says so when there is nothing to draw, and shows a placeholder while loading', () => {
    const { rerender, container } = render(
      <StackedFunnel label={label} empty='Nothing' rows={[]} />
    )
    expect(screen.getByText('Nothing')).toBeInTheDocument()
    rerender(
      <StackedFunnel label={label} empty='Nothing' rows={null} loading />
    )
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })
})

describe('silent paying accounts', () => {
  it('states how many have gone for a month or more', () => {
    render(
      <SilentPayersPanel
        silent={{
          payers: 10,
          buckets: [
            { name: 'within_1d', count: 6 },
            { name: 'days_31_60', count: 2 },
            { name: 'never', count: 2 },
          ],
        }}
      />
    )
    expect(
      screen.getByText(/4 of 10 paying accounts \(40%\) have been silent/)
    ).toBeInTheDocument()
  })

  it('stays out of the way before the server sends the figure', () => {
    const { container } = render(<SilentPayersPanel silent={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says no data for a site without paying accounts', () => {
    render(<SilentPayersPanel silent={{ payers: 0, buckets: [] }} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })
})

describe('rank bars', () => {
  it('orders by value, drops zero and keeps eight', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      key: `k${index}`,
      label: `item ${index}`,
      value: index,
    }))
    render(<RankBars items={items} format={(n) => `#${n}`} empty='none' />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(8)
    expect(rows[0]).toHaveTextContent('item 9')
    expect(screen.queryByText('item 0')).toBeNull()
  })
})

const tiers = (users: number[], spend: number[]): SpendTierGroup['tiers'] => [
  { tier: 'whale', floor_usd: 500, users: users[0], quota_usd: spend[0] },
  { tier: 'large', floor_usd: 100, users: users[1], quota_usd: spend[1] },
  { tier: 'mid', floor_usd: 10, users: users[2], quota_usd: spend[2] },
  { tier: 'tail', floor_usd: 0, users: users[3], quota_usd: spend[3] },
]

describe('customer tiers by spend', () => {
  const groups: SpendTierGroup[] = [
    { vendor: 'all', tiers: tiers([1, 2, 5, 20], [900, 400, 150, 60]) },
    { vendor: 'claude', tiers: tiers([0, 1, 3, 10], [0, 150, 90, 30]) },
    { vendor: 'gpt', tiers: tiers([0, 0, 0, 0], [0, 0, 0, 0]) },
    { vendor: 'other', tiers: tiers([0, 0, 0, 0], [0, 0, 0, 0]) },
  ]

  it('reads the whale share of the customers and of the spend', () => {
    render(<SpendTiersPanel groups={groups} />)
    expect(screen.getByText('Customer tiers by spend')).toBeInTheDocument()
    expect(
      screen.getByText(
        /^1 whales \(3\.?\d*% of customers\) brought 59\.?\d*% of the spend\.$/
      )
    ).toBeInTheDocument()
  })

  it('counts only the picked vendor after the switch', async () => {
    const user = userEvent.setup()
    render(<SpendTiersPanel groups={groups} />)
    await user.click(screen.getByRole('button', { name: 'Claude' }))
    // No whale among Claude's customers.
    expect(
      screen.getByText(
        /^0 whales \(0% of customers\) brought 0% of the spend\.$/
      )
    ).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('Long tail')).toBeInTheDocument()
  })

  it('stays out of the way before the server sends the tiers', () => {
    const { container } = render(<SpendTiersPanel groups={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})

const customers: CustomerInsights = {
  customers_spending: 3,
  total_usd: 1000,
  top5_share: 1,
  top10_share: 1,
  top20_share: 1,
  top: [
    {
      user_id: 7,
      username: 'alice',
      remark: 'enterprise lead',
      registered_at: midnight(-60),
      topup_paid: 800,
      subscription_paid: 100,
      lifetime_usd: 2000,
      balance_usd: 55,
      quota_usd: 700,
      share: 0.7,
      trend: [10, 20, 30, 40, 50, 60, 70],
      main_model: 'claude-opus-5-5',
      main_group: 'Claude',
      last_used_at: Math.floor(Date.now() / 1000) - 3600,
      active_days: 20,
    },
    {
      user_id: 8,
      username: 'bob',
      remark: '',
      registered_at: midnight(-30),
      topup_paid: 0,
      subscription_paid: 0,
      lifetime_usd: 300,
      balance_usd: 0,
      quota_usd: 300,
      share: 0.3,
      trend: [0, 0, 0, 0, 0, 0, 0],
      main_model: 'gpt-6.2',
      main_group: 'GPT',
      last_used_at: 0,
      active_days: 0,
    },
  ],
  watched: 50,
  churn: [
    {
      user_id: 8,
      username: 'bob',
      month_usd: 300,
      last7_usd: 10,
      previous7_usd: 100,
      last_request_at: 0,
      reasons: ['dropped', 'idle'],
    },
  ],
}

describe('biggest customers', () => {
  it('lists the profile of each customer with the sparkline and the concentration', () => {
    render(<CustomersPanel data={customers} />)
    expect(screen.getByText('Biggest customers')).toBeInTheDocument()
    expect(
      screen.getByText(/^3 customers spent .*1,000.* in the range\.$/)
    ).toBeInTheDocument()
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0)
    expect(screen.getAllByText('enterprise lead').length).toBeGreaterThan(0)
    expect(screen.getAllByText('claude-opus-5-5').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Never').length).toBeGreaterThan(0)
    expect(screen.getByText('Top 5 customers')).toBeInTheDocument()
    expect(screen.getByText('Top 20 customers')).toBeInTheDocument()
    expect(
      screen.getAllByRole('img', {
        name: /^Spend of alice over the last 7 days from/,
      }).length
    ).toBeGreaterThan(0)
  })

  it('shows a loading state, then an error, in place of the rows', () => {
    const { rerender } = render(
      <CustomersPanel data={undefined} source={{ status: 'pending' }} />
    )
    expect(screen.queryByText('alice')).toBeNull()
    rerender(
      <CustomersPanel
        data={undefined}
        source={{ status: 'error', error: 'boom' }}
      />
    )
    expect(screen.queryByText('alice')).toBeNull()
  })
})

describe('churn watch', () => {
  it('lists the customers slipping with the reason for each', () => {
    render(<ChurnWatchPanel data={customers} />)
    expect(screen.getByText('Churn watch')).toBeInTheDocument()
    expect(
      screen.getByText('1 of the 50 biggest customers are slipping.')
    ).toBeInTheDocument()
    expect(screen.getAllByText('bob').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Use fell by over half').length).toBeGreaterThan(
      0
    )
    expect(screen.getAllByText('No request in 3 days').length).toBeGreaterThan(
      0
    )
  })

  it('says none has dropped off when the list is empty', () => {
    render(<ChurnWatchPanel data={{ ...customers, churn: [] }} />)
    expect(
      screen.getByText('None of the 50 biggest customers has dropped off.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('No customer among the biggest has dropped off')
    ).toBeInTheDocument()
  })
})

const weeks: RetentionWeek[] = [
  {
    week: midnight(7),
    size: 40,
    partial: true,
    active: [40, 10],
    activated: { size: 20, active: [20, 10] },
    paid: { size: 4, active: [4, 2] },
  },
  {
    week: midnight(0),
    size: 50,
    partial: false,
    active: [50, 30, 20],
    activated: { size: 30, active: [30, 25, 20] },
    paid: { size: 50, active: [50, 40, 40] },
  },
]

describe('weekly retention', () => {
  it('draws a row per week with a column per week after it, and names the best', () => {
    render(<WeeklyRetentionPanel weeks={weeks} state='ready' />)
    expect(screen.getByText('Retention by sign-up week')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('W0')).toBeInTheDocument()
    expect(within(table).getByText('W2')).toBeInTheDocument()
    expect(within(table).getByText(/partial week/)).toBeInTheDocument()
    // 30 of 50 used quota the week after; the other week is still filling.
    expect(
      screen.getByText(/kept the most \(All sign-ups\): 60%/)
    ).toBeInTheDocument()
  })

  it('reads the sign-ups the reader picks', async () => {
    const user = userEvent.setup()
    render(<WeeklyRetentionPanel weeks={weeks} state='ready' />)
    await user.click(screen.getByRole('button', { name: 'Paid sign-ups' }))
    expect(
      screen.getByText(/kept the most \(Paid sign-ups\): 80%/)
    ).toBeInTheDocument()
  })

  it('leaves the panel out when the server sends no weeks', () => {
    const { container } = render(
      <WeeklyRetentionPanel weeks={undefined} state='ready' />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('says there are no sign-ups for an empty range', () => {
    render(<WeeklyRetentionPanel weeks={[]} state='ready' />)
    expect(screen.getByText('No sign-ups in this range')).toBeInTheDocument()
  })
})

function channel(
  id: number,
  username: string,
  overrides: Partial<ChannelRow> = {}
): ChannelRow {
  return {
    segment: 'channel',
    channel: { user_id: id, username },
    tier: 'A',
    accounts: 0,
    registered: 0,
    activated: 0,
    paid: 0,
    repeat: 0,
    revenue: 0,
    payers: 0,
    new_payers: 0,
    consumption_usd: 0,
    gift_consumption_usd: 0,
    granted_usd: 0,
    gift_outstanding_usd: 0,
    commission_usd: 0,
    fee_usd: 0,
    ...overrides,
  } as ChannelRow
}

describe('channel panels', () => {
  const rows = [
    channel(1, 'v2ex', { registered: 40, paid: 4, revenue: 400 }),
    channel(2, 'linuxdo', { registered: 90, paid: 9, revenue: 100 }),
    channel(0, '', {
      segment: 'organic',
      registered: 10,
      paid: 1,
      revenue: 50,
    }),
  ]

  it('ranks the sign-ups, paying accounts and revenue of each source', () => {
    render(<ChannelBarsPanel rows={rows} />)
    expect(screen.getByText('What each source brought')).toBeInTheDocument()
    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(3)
    expect(within(lists[0]).getAllByRole('listitem')[0]).toHaveTextContent(
      'linuxdo'
    )
    expect(within(lists[2]).getAllByRole('listitem')[0]).toHaveTextContent(
      'v2ex'
    )
    expect(screen.getAllByText('Organic').length).toBeGreaterThan(0)
  })

  it('stacks each day by the three largest sources and the rest together', () => {
    const many = [...rows, channel(3, 'extra', { registered: 5 })]
    const data = {
      signups_by_day: [
        {
          day: midnight(0),
          sources: [
            { segment: 'channel', channel_id: 1, registered: 4 },
            { segment: 'channel', channel_id: 2, registered: 9 },
            { segment: 'channel', channel_id: 3, registered: 1 },
            { segment: 'organic', channel_id: 0, registered: 2 },
          ],
        },
      ],
    } as unknown as ChannelInsights
    render(<ChannelDailyPanel data={data} rows={many} />)
    expect(screen.getByText('Sign-ups by day and source')).toBeInTheDocument()
    expect(screen.getAllByText('linuxdo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Other sources').length).toBeGreaterThan(0)
  })

  it('leaves the daily panel out on a server that does not send the days', () => {
    const { container } = render(
      <ChannelDailyPanel data={{} as ChannelInsights} rows={rows} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
