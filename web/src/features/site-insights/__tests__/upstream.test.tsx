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
import { describe, expect, it } from 'vitest'

import { UpstreamTab } from '../components/upstream-tab'
import type { UpstreamChannel, UpstreamInsights, UpstreamModel } from '../types'
import {
  channelTokens,
  feeBreakEven,
  routingHints,
  staleCosts,
  upstreamChanges,
  upstreamDailySeries,
  upstreamHourSlots,
  upstreamHourlySeries,
  upstreamIncidents,
  upstreamMargin,
  upstreamModelComparison,
  upstreamTotals,
} from '../upstream'

function channel(overrides: Partial<UpstreamChannel>): UpstreamChannel {
  return {
    id: 0,
    name: '',
    status: 1,
    priority: 0,
    host: '',
    requests: 0,
    errors: 0,
    failure_rate: 0,
    rescued: 0,
    revenue_usd: 0,
    cost_usd: 0,
    cost_source: 'none',
    monthly_fee_usd: 0,
    latest_cost_at: 0,
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
  }
}

function model(overrides: Partial<UpstreamModel>): UpstreamModel {
  return {
    model: '',
    channel_id: 0,
    requests: 0,
    errors: 0,
    failure_rate: 0,
    rescued: 0,
    ttft_p50_ms: 0,
    latency_p50_s: 0,
    revenue_usd: 0,
    cost_usd: 0,
    ...overrides,
  }
}

// Production's GPT channels on 2026-11-09: the engine's subscription fails
// under load, and the relay serves what it drops.
const engine = channel({
  id: 2,
  name: 'engine-gpt',
  host: 'gpt-load',
  priority: 10,
  requests: 136,
  errors: 120,
  failure_rate: 120 / 256,
  revenue_usd: 50,
  cost_source: 'fee',
  cost_usd: 10,
  monthly_fee_usd: 300,
  ttft_p50_ms: 9000,
  reasons: [{ name: 'Our servers are currently overloaded', count: 120 }],
})
const relay = channel({
  id: 7,
  name: '吱吱鼠渠道',
  host: 'usdj.zzshu.cc',
  requests: 139,
  rescued: 70,
  revenue_usd: 100,
  cost_source: 'upstream',
  cost_usd: 11,
  upstream_group: 'GPT特惠',
  upstream_group_ratio: 0.09,
  latest_cost_at: 1794212726,
  ttft_p50_ms: 2500,
})
const idle = channel({ id: 9, name: 'idle' })

const data: UpstreamInsights = {
  channels: [engine, relay, idle],
  models: [
    model({
      model: 'gpt-6-luna',
      channel_id: 2,
      requests: 26,
      errors: 21,
      failure_rate: 21 / 47,
      revenue_usd: 1,
    }),
    model({
      model: 'gpt-6.1-sol',
      channel_id: 2,
      requests: 110,
      errors: 99,
      failure_rate: 99 / 209,
      ttft_p50_ms: 9000,
      revenue_usd: 49,
    }),
    model({
      model: 'gpt-6.1-sol',
      channel_id: 7,
      requests: 139,
      failure_rate: 0,
      ttft_p50_ms: 2500,
      revenue_usd: 100,
      cost_usd: 11,
    }),
  ],
  daily: [
    {
      day: 1794153600,
      channel_id: 2,
      requests: 136,
      errors: 120,
      revenue_usd: 50,
      cost_usd: 10,
    },
    {
      day: 1794153600,
      channel_id: 7,
      requests: 139,
      errors: 0,
      revenue_usd: 100,
      cost_usd: 11,
    },
  ],
  rescues: [{ from: 2, to: 7, count: 70 }],
  truncated: false,
}

describe('upstream figures', () => {
  it('leaves the margin out when nothing says what a channel cost', () => {
    expect(upstreamMargin(idle)).toEqual({ margin: null, rate: null })
    expect(upstreamMargin(relay).margin).toBeCloseTo(89)
    expect(upstreamMargin(relay).rate).toBeCloseTo(0.89)
  })

  it('totals only the channels whose cost is known into the margin', () => {
    const totals = upstreamTotals({
      ...data,
      channels: [
        ...data.channels,
        channel({ id: 11, requests: 5, revenue_usd: 20 }),
      ],
    })
    expect(totals.attempts).toBe(400)
    expect(totals.failureRate).toBeCloseTo(0.3)
    expect(totals.cost).toBe(21)
    expect(totals.margin).toBe(129)
    expect(totals.uncostedRevenue).toBe(20)
  })

  it('draws the busiest channels as series and leaves idle ones out', () => {
    const series = upstreamDailySeries(data.channels, data.daily)
    expect(series.named).toEqual([2, 7])
    expect(series.hasOther).toBe(false)
    expect(series.days[0].attempts).toEqual([256, 139])
    expect(series.days[0].failureRates[0]).toBeCloseTo(120 / 256)
    expect(series.days[0].cost).toBe(21)
  })

  it('compares only shared models and marks the best channel per figure', () => {
    const rows = upstreamModelComparison(data.models, data.channels)
    expect(rows.map((row) => `${row.model}:${row.channel_id}`)).toEqual([
      'gpt-6.1-sol:2',
      'gpt-6.1-sol:7',
    ])
    const [onEngine, onRelay] = rows
    expect(onEngine.first).toBe(true)
    expect(onRelay.best).toEqual({ failure: true, ttft: true, margin: false })
    expect(onEngine.best).toEqual({
      failure: false,
      ttft: false,
      margin: false,
    })
    expect(onEngine.marginRate).toBeNull()
    expect(onRelay.marginRate).toBeCloseTo(0.89)
  })

  it('names no best channel when only one has enough attempts', () => {
    const rows = upstreamModelComparison(
      [
        model({ model: 'm', channel_id: 2, requests: 100 }),
        model({ model: 'm', channel_id: 7, requests: 5 }),
      ],
      data.channels
    )
    expect(rows.every((row) => !row.best.failure && !row.best.ttft)).toBe(true)
  })

  it('counts the failures no other channel rescued', () => {
    expect(upstreamTotals(data).unrescued).toBe(50)
  })

  it('reads a channel ranked below a better one as a routing hint', () => {
    const rows = upstreamModelComparison(data.models, data.channels)
    expect(routingHints(rows, data.channels)).toEqual([
      { model: 'gpt-6.1-sol', busiest: 2, better: 7, earnsMore: false },
    ])
    expect(
      routingHints(rows, [
        { ...engine, priority: 0 },
        { ...relay, priority: 10 },
      ])
    ).toEqual([])
  })

  it('reads cache hits by how the channel counts prompt tokens', () => {
    const openai = channel({
      id: 1,
      prompt_tokens: 1000,
      cache_read_tokens: 400,
      completion_tokens: 1000,
      cost_source: 'upstream',
      cost_usd: 2,
    })
    expect(channelTokens(openai, [])).toEqual({
      input: 1000,
      cacheRate: 0.4,
      costPerMillion: 1000,
    })
    const claude = { ...openai, id: 3, cost_source: 'none' as const }
    expect(
      channelTokens(claude, [
        model({ model: 'claude-opus-5', channel_id: 3, requests: 1 }),
      ])
    ).toEqual({ input: 1400, cacheRate: 400 / 1400, costPerMillion: null })
    expect(channelTokens({ ...openai, prompt_tokens: 100 }, []).cacheRate).toBe(
      0.8
    )
  })

  it('says whether a fee channel pays for itself', () => {
    expect(feeBreakEven(engine, 1)).toEqual({
      dailyFee: 10,
      dailyRevenue: 50,
      gap: 40,
    })
    expect(feeBreakEven(engine, 10)?.gap).toBe(-5)
    expect(feeBreakEven(relay, 1)).toBeNull()
  })

  it('reads a channel absent from the previous period as new', () => {
    const changes = upstreamChanges(data, {
      ...data,
      channels: [{ ...engine, errors: 20 }],
      rescues: [],
    })
    expect([...changes.fresh].sort()).toEqual(['7', '9'])
    expect(changes.failures).toEqual([
      { key: '2', current: 120, previous: 20, change: 100 },
    ])
    expect(changes.unrescued).toEqual([
      { key: '2', current: 50, previous: 20, change: 30 },
    ])
    expect(changes.margin.map((row) => row.key)).toEqual(['7'])
  })
})

const HOUR = 3600
const H0 = 1794211200

function hour(
  at: number,
  channelID: number,
  requests: number,
  errors: number,
  revenue = 0
) {
  return {
    hour: H0 + at * HOUR,
    channel_id: channelID,
    requests,
    errors,
    revenue_usd: revenue,
    cost_usd: 0,
  }
}

describe('upstream hours', () => {
  it('lists every hour of the range, a mid-hour start adding one', () => {
    expect(
      upstreamHourSlots([], { start: H0, end: H0 + 24 * HOUR })
    ).toHaveLength(24)
    expect(
      upstreamHourSlots([], { start: H0 + 600, end: H0 + 24 * HOUR + 600 })
    ).toHaveLength(25)
    const series = upstreamHourlySeries(data.channels, [hour(1, 2, 10, 5)], {
      start: H0,
      end: H0 + 3 * HOUR,
    })
    expect(series.hours.map((row) => row.attempts[0])).toEqual([0, 15, 0])
  })

  it('finds a run of failing hours over enough attempts, with its rescuer', () => {
    const rows = [
      hour(0, 2, 50, 0),
      hour(1, 2, 30, 30),
      hour(2, 2, 20, 40),
      hour(3, 2, 50, 0),
      // Failing, but too few attempts to call an incident.
      hour(1, 9, 5, 5),
    ]
    const range = { start: H0, end: H0 + 4 * HOUR }
    expect(upstreamIncidents(rows, data.rescues, range)).toEqual([
      {
        channel_id: 2,
        start: H0 + HOUR,
        end: H0 + 3 * HOUR,
        attempts: 120,
        errors: 70,
        rate: 70 / 120,
        ongoing: false,
        rescuer: { from: 2, to: 7, count: 70 },
      },
    ])
  })

  it('extends a run into the open hour but never starts one there', () => {
    const range = { start: H0, end: H0 + HOUR + 1800 }
    const ongoing = upstreamIncidents(
      [hour(0, 2, 60, 60), hour(1, 2, 5, 5)],
      [],
      range
    )
    expect(ongoing).toHaveLength(1)
    expect(ongoing[0]).toMatchObject({
      ongoing: true,
      end: range.end,
      attempts: 130,
    })
    expect(upstreamIncidents([hour(1, 2, 100, 100)], [], range)).toEqual([])
  })

  it('flags an upstream bill read long before the range ended while revenue kept coming', () => {
    const read = H0 + HOUR + 60
    const billed = { ...relay, latest_cost_at: read }
    const hourly = [
      hour(0, 7, 10, 0, 20),
      hour(1, 7, 10, 0, 10),
      hour(2, 7, 10, 0, 5),
    ]
    const view = { ...data, channels: [billed], hourly }
    expect(staleCosts(view, H0 + 3 * HOUR)).toEqual([
      { channel: billed, revenue: 15 },
    ])
    expect(staleCosts(view, read + 1000)).toEqual([])
    expect(staleCosts(view, undefined)).toEqual([])
    expect(staleCosts({ ...view, hourly: undefined }, H0 + 3 * HOUR)).toEqual([
      { channel: billed, revenue: null },
    ])
  })
})

describe('UpstreamTab', () => {
  it('names the failing channel, its rescuer and each cost source', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <UpstreamTab data={data} />
      </QueryClientProvider>
    )
    expect(screen.getByRole('status')).toHaveTextContent('engine-gpt')
    expect(screen.getByRole('status')).toHaveTextContent('吱吱鼠渠道')
    expect(screen.getAllByText(/GPT特惠/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Cost unknown/).length).toBeGreaterThan(0)
    expect(screen.getByText('Failures customers saw')).toBeInTheDocument()
    expect(screen.queryByText('Incidents')).not.toBeInTheDocument()
  })

  it('reads a short range by the hour: incidents, a stale bill, new channels', () => {
    const range = { start: H0, end: H0 + 3 * HOUR, days: 1, hourly: true }
    const hourly = [
      hour(0, 2, 136, 120, 50),
      hour(0, 7, 139, 0, 90),
      hour(2, 7, 10, 0, 10),
    ]
    const view = {
      ...data,
      channels: [engine, { ...relay, latest_cost_at: H0 + 600 }, idle],
      hourly,
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <UpstreamTab
          data={view}
          previous={{ ...data, channels: [engine] }}
          range={range}
        />
      </QueryClientProvider>
    )
    expect(screen.getByText('Incidents')).toBeInTheDocument()
    expect(
      screen.getAllByText(/engine-gpt: 46\.9% failed from/).length
    ).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent('margin is overstated')
    expect(
      screen.getAllByText(/of later revenue has no cost yet/).length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('New this period').length).toBeGreaterThan(0)
    expect(screen.getByText('What changed by channel')).toBeInTheDocument()
  })
})
