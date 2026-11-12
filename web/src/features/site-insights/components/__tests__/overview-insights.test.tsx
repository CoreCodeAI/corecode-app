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

import type {
  ActivityInsights,
  CapacityHour,
  FinanceInsights,
  QualityInsights,
  UpstreamChannel,
  UpstreamInsights,
} from '../../types'
import {
  closedTrend,
  concentratedCustomer,
  consumptionContributions,
  failingChannels,
  lastHourSignals,
  losingChannels,
  marginTone,
  methodOrders,
  requestContributions,
  revenueComparable,
  staleCostChannels,
} from '../overview-analysis'
import { WhatChanged } from '../overview-insights'

const H = 3600
const DAY = 86400

function hour(
  at: number,
  fields: Partial<Omit<CapacityHour, 'hour'>> = {}
): CapacityHour {
  return {
    hour: at,
    requests: 0,
    errors: 0,
    peak_concurrency: 0,
    engine_rejections: 0,
    upstream_rate_limits: 0,
    ...fields,
  }
}

function channel(fields: Partial<UpstreamChannel>): UpstreamChannel {
  return {
    id: 1,
    name: 'a',
    requests: 0,
    errors: 0,
    failure_rate: 0,
    revenue_usd: 0,
    cost_usd: 0,
    cost_source: 'none',
    latest_cost_at: 0,
    ...fields,
  } as UpstreamChannel
}

describe('overview analysis', () => {
  it('splits the request change by model', () => {
    const now = {
      models: [
        { model: 'opus', requests: 900 },
        { model: 'gpt', requests: 100 },
      ],
    } as unknown as QualityInsights
    const before = {
      models: [
        { model: 'opus', requests: 500 },
        { model: 'gpt', requests: 150 },
      ],
    } as unknown as QualityInsights
    expect(requestContributions(now, before)).toEqual([
      { key: 'opus', current: 900, previous: 500, change: 400 },
      { key: 'gpt', current: 100, previous: 150, change: -50 },
    ])
  })

  it('sums each vendor’s daily charge before comparing', () => {
    const now = {
      daily: [
        { vendor_usd: { claude: 10, codex: 2 } },
        { vendor_usd: { claude: 5 } },
      ],
    } as unknown as FinanceInsights
    const before = {
      daily: [{ vendor_usd: { claude: 20 } }, {}],
    } as unknown as FinanceInsights
    expect(consumptionContributions(now, before)).toEqual({
      parts: [
        { key: 'claude', current: 15, previous: 20, change: -5 },
        { key: 'codex', current: 2, previous: 0, change: 2 },
      ],
      total: -3,
    })
  })

  it('counts orders by method and compares revenue only over enough orders', () => {
    const now = {
      methods: [{ payment_method: 'alipay', money: 30, count: 3 }],
    } as unknown as FinanceInsights
    const before = {
      methods: [{ payment_method: 'stripe', money: 10, count: 1 }],
    } as unknown as FinanceInsights
    expect([...methodOrders(now, before)]).toEqual([
      ['alipay', { current: 3, previous: 0 }],
      ['stripe', { current: 0, previous: 1 }],
    ])
    expect(revenueComparable(5, 5)).toBe(true)
    expect(revenueComparable(12, 4)).toBe(false)
    expect(revenueComparable(12, undefined)).toBe(false)
  })

  it('leaves the open hour out of a trend', () => {
    const rows = [{ hour: 0 }, { hour: H }, { hour: 2 * H }]
    expect(closedTrend(rows, 2 * H + 600, (row) => row.hour / H)).toEqual([
      { hour: 0, value: 0 },
      { hour: H, value: 1 },
    ])
  })

  it('flags a drop in the last full hour against the same hour before', () => {
    const end = DAY + 3 * H + 600
    const current = [
      hour(DAY + H, { requests: 400 }),
      hour(DAY + 2 * H, { requests: 150 }),
      // Open: left out, so its low count is not a drop.
      hour(DAY + 3 * H, { requests: 5 }),
    ]
    const previous = [hour(2 * H, { requests: 400 })]
    expect(lastHourSignals(current, previous, end, DAY)).toEqual([
      {
        kind: 'drop',
        hour: DAY + 2 * H,
        value: 150,
        baseline: 400,
        source: 'previous',
      },
    ])
  })

  it('does not call a drop from a baseline under the small sample', () => {
    const current = [hour(0, { requests: 90 }), hour(H, { requests: 10 })]
    expect(lastHourSignals(current, [], 2 * H, DAY)).toEqual([])
  })

  it('flags spikes against the median hour when the previous period lacks the hour', () => {
    const current = [
      hour(0, { requests: 200, errors: 5, upstream_rate_limits: 2 }),
      hour(H, { requests: 200, errors: 5, upstream_rate_limits: 2 }),
      hour(2 * H, {
        requests: 200,
        errors: 30,
        engine_rejections: 19,
        upstream_rate_limits: 6,
      }),
    ]
    // Errors: 30 >= 3 x 5 and >= 20. Engine: 19 is under the floor. Rate
    // limits: 6 is under the floor although 3 x 2.
    expect(lastHourSignals(current, null, 3 * H, DAY)).toEqual([
      { kind: 'errors', hour: 2 * H, value: 30, baseline: 5, source: 'median' },
    ])
  })

  it('needs floor x factor when no hour had any', () => {
    const current = [
      hour(0, { engine_rejections: 0 }),
      hour(H, { engine_rejections: 59 }),
    ]
    expect(lastHourSignals(current, null, 2 * H, DAY)).toEqual([])
    current[1].engine_rejections = 60
    expect(lastHourSignals(current, null, 2 * H, DAY)).toEqual([
      { kind: 'engine', hour: H, value: 60, baseline: 0, source: 'median' },
    ])
  })

  it('names failing channels over enough attempts, most failures first', () => {
    const data = {
      channels: [
        channel({ id: 1, requests: 90, errors: 20, failure_rate: 0.18 }),
        channel({ id: 2, requests: 900, errors: 60, failure_rate: 0.0625 }),
        channel({ id: 3, requests: 40, errors: 30, failure_rate: 0.43 }),
        channel({ id: 4, requests: 1000, errors: 10, failure_rate: 0.01 }),
      ],
    } as UpstreamInsights
    expect(failingChannels(data).map((row) => row.id)).toEqual([2, 1])
  })

  it('finds losing channels only where the cost is known', () => {
    const data = {
      channels: [
        channel({
          id: 1,
          revenue_usd: 5,
          cost_usd: 8,
          cost_source: 'upstream',
        }),
        channel({ id: 2, revenue_usd: 5, cost_usd: 9, cost_source: 'none' }),
        channel({ id: 3, revenue_usd: 1, cost_usd: 10, cost_source: 'fee' }),
      ],
    } as UpstreamInsights
    expect(
      losingChannels(data).map((row) => [row.channel.id, row.loss])
    ).toEqual([
      [3, 9],
      [1, 3],
    ])
  })

  it('finds an upstream bill read too long before the range ends', () => {
    const end = 10_000
    const data = {
      channels: [
        channel({
          id: 1,
          cost_source: 'upstream',
          revenue_usd: 1,
          latest_cost_at: end - 1801,
        }),
        channel({
          id: 2,
          cost_source: 'upstream',
          revenue_usd: 1,
          latest_cost_at: end - 1800,
        }),
        channel({
          id: 3,
          cost_source: 'upstream',
          revenue_usd: 0,
          latest_cost_at: 1,
        }),
        channel({
          id: 4,
          cost_source: 'fee',
          revenue_usd: 1,
          latest_cost_at: 1,
        }),
      ],
    } as UpstreamInsights
    expect(staleCostChannels(data, end).map((row) => row.id)).toEqual([1])
  })

  it('names a customer past the concentration share', () => {
    const top = {
      user_id: 7,
      username: 'big',
      quota_usd: 40,
      requests: 9,
      share: 0.4,
    }
    const data = {
      top1_share: 0.4,
      top_users: [top],
    } as unknown as ActivityInsights
    expect(concentratedCustomer(data)).toEqual(top)
    expect(concentratedCustomer({ ...data, top1_share: 0.3 })).toBeUndefined()
  })

  it('colors a margin as the funds verdict does', () => {
    expect(marginTone(100, -1)).toBe('danger')
    expect(marginTone(100, 19)).toBe('warning')
    expect(marginTone(100, 20)).toBe('default')
    expect(marginTone(0, -5)).toBe('default')
  })
})

describe('what changed', () => {
  const quality = (opus: number, gpt: number) =>
    ({
      requests: opus + gpt,
      models: [
        { model: 'opus', requests: opus },
        { model: 'gpt', requests: gpt },
      ],
    }) as unknown as QualityInsights

  it('names the model that drove the request change, with its share', () => {
    render(
      <WhatChanged
        quality={[quality(900, 100), quality(500, 100)]}
        finance={[undefined, undefined]}
      />
    )
    expect(screen.getByText('600 → 1,000 (+400)')).toBeInTheDocument()
    expect(screen.getByText('Mostly opus.')).toBeInTheDocument()
    expect(screen.getByText('+400')).toBeInTheDocument()
    expect(screen.getByText('· 100%')).toBeInTheDocument()
  })

  it('shows revenue by amount and orders when either period had few orders', () => {
    const finance = (money: number, count: number) =>
      ({
        revenue: money,
        orders: count,
        daily: [],
        methods: [{ payment_method: 'alipay', money, count }],
      }) as unknown as FinanceInsights
    render(
      <WhatChanged
        quality={[undefined, undefined]}
        finance={[finance(300, 3), finance(100, 1)]}
      />
    )
    expect(
      screen.getByText(
        '1 orders before, 3 now: too few to read as a percentage.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('· 1 → 3 orders')).toBeInTheDocument()
    expect(screen.queryByText(/^Mostly/)).not.toBeInTheDocument()
  })

  it('stays out of the way before the previous period loads', () => {
    const { container } = render(
      <WhatChanged
        quality={[quality(1, 1), undefined]}
        finance={[undefined, undefined]}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
