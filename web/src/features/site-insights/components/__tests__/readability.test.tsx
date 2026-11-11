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
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { InsightsView } from '../../api'
import type { InsightsRangeInfo } from '../../lib'
import type {
  CapacityInsights,
  EnginePool,
  FinanceInsights,
  QualityInsights,
  RiskInsights,
} from '../../types'
import { OverviewTab } from '../overview-tab'
import { BarSeries, DeltaBadge, SimpleTable, Sparkline } from '../shared'

describe('change against the previous period', () => {
  it('colors a rise by whether rising is better', () => {
    const { rerender } = render(
      <DeltaBadge delta={{ current: 125, previous: 100, better: 'up' }} />
    )
    expect(screen.getByText('▲ 25%')).toHaveClass('text-emerald-600')

    rerender(
      <DeltaBadge delta={{ current: 125, previous: 100, better: 'down' }} />
    )
    expect(screen.getByText('▲ 25%')).toHaveClass('text-destructive')

    rerender(
      <DeltaBadge delta={{ current: 125, previous: 100, better: 'neutral' }} />
    )
    expect(screen.getByText('▲ 25%')).not.toHaveClass('text-destructive')
  })

  it('states a figure that more than doubled as a multiple', () => {
    render(<DeltaBadge delta={{ current: 860, previous: 100, better: 'up' }} />)
    expect(screen.getByText('▲ ×8.6')).toBeInTheDocument()
  })

  it('compares shares in percentage points', () => {
    render(
      <DeltaBadge
        delta={{ current: 0.03, previous: 0.02, better: 'down', points: true }}
      />
    )
    expect(screen.getByText('▲ 1.0 pt')).toHaveClass('text-destructive')
  })

  it('shows nothing before the previous period loads', () => {
    const { container, rerender } = render(
      <DeltaBadge delta={{ current: 5, previous: undefined, better: 'up' }} />
    )
    expect(container).toBeEmptyDOMElement()

    rerender(<DeltaBadge delta={{ current: 5, previous: 0, better: 'up' }} />)
    expect(screen.getByText('New this period')).toBeInTheDocument()
  })
})

describe('bar series axes', () => {
  it('rounds the value axis up to even steps', () => {
    render(
      <BarSeries
        ariaLabel='sign-ups'
        series={[{ label: 'Sign-ups' }]}
        points={[
          { key: 1, title: 'a', values: [182] },
          { key: 2, title: 'b', values: [40] },
        ]}
      />
    )
    // 182 over four gridlines steps by 50, so the axis tops out at 200.
    for (const tick of ['0', '50', '100', '150']) {
      expect(screen.getByText(tick)).toBeInTheDocument()
    }
    expect(screen.getAllByText('200').length).toBeGreaterThan(0)
  })

  it('labels only the points that start a segment', () => {
    render(
      <BarSeries
        ariaLabel='hourly'
        series={[{ label: 'Peak' }]}
        points={Array.from({ length: 48 }, (_, hour) => ({
          key: hour,
          title: `hour ${hour}`,
          axis: hour % 24 === 0 ? `day ${hour / 24}` : undefined,
          values: [1],
        }))}
      />
    )
    expect(screen.getByText('day 0')).toBeInTheDocument()
    expect(screen.getByText('day 1')).toBeInTheDocument()
    expect(screen.queryByText('hour 5')).not.toBeInTheDocument()
  })
})

describe('table rows', () => {
  it('fades the rows the caller marks', () => {
    render(
      <SimpleTable
        rows={[
          { model: 'busy', requests: 500 },
          { model: 'quiet', requests: 3 },
        ]}
        rowKey={(row) => row.model}
        empty='none'
        faded={(row) => row.requests < 100}
        columns={[{ key: 'm', label: 'Model', render: (row) => row.model }]}
      />
    )
    expect(screen.getByText('quiet').closest('tr')).toHaveClass(
      'text-muted-foreground'
    )
    expect(screen.getByText('busy').closest('tr')).not.toHaveClass(
      'text-muted-foreground'
    )
  })
})

function pool(overrides: Partial<EnginePool> = {}): EnginePool {
  return {
    configured: true,
    observed_at_ms: 0,
    credential_concurrency: 5,
    five_hour_budget: 90,
    seven_day_budget: 98,
    eligible_accounts: 10,
    effective_slots: 50,
    in_flight: 3,
    groups: [],
    accounts: [],
    five_hour_estimate: null,
    week_estimate: null,
    refills: [],
    ...overrides,
  }
}

const capacity = {
  error_categories: [],
  peak_concurrency: 10,
  peak_at: 0,
  limit_rejection_total: 0,
  limit_rejected_users: null,
  pool: pool(),
} as unknown as CapacityInsights

function views(overrides: {
  quality?: Partial<QualityInsights>
  finance?: Partial<FinanceInsights>
}) {
  return {
    capacity,
    pool: pool(),
    quality: {
      requests: 1000,
      errors: 10,
      error_rate: 0.01,
      ttft_p95_ms: 4000,
      models: [],
      daily: [],
      ...overrides.quality,
    } as unknown as QualityInsights,
    finance: {
      revenue: 100,
      orders: 2,
      paying_users: 2,
      consumption_usd: 50,
      debt_usd: 0,
      debtors: [],
      daily: [],
      ...overrides.finance,
    } as unknown as FinanceInsights,
    risk: {
      signups: 4,
      alias_emails: 0,
      off_whitelist: 0,
      shared_ips: [],
    } as unknown as RiskInsights,
  } as Partial<Record<InsightsView, unknown>>
}

function renderOverview(data: Partial<Record<InsightsView, unknown>>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const query = (view: InsightsView) => ({
    queryKey: ['test', view],
    queryFn: async () => data[view] ?? null,
    staleTime: Infinity,
  })
  render(
    <QueryClientProvider client={client}>
      <OverviewTab
        current={query}
        previous={(view) => ({ ...query(view), queryKey: ['prev', view] })}
        refreshMs={{}}
        onOpen={() => undefined}
      />
    </QueryClientProvider>
  )
}

describe('overview signals', () => {
  it('says so when nothing needs attention', async () => {
    renderOverview(views({}))
    expect(
      await screen.findByText('Nothing needs attention in this range.')
    ).toBeInTheDocument()
  })

  it('lists a failure rate and debt past their thresholds, danger first', async () => {
    renderOverview(
      views({
        quality: { error_rate: 0.03, errors: 30 },
        finance: {
          debt_usd: -25,
          debtors: [{ user_id: 2, username: 'b', balance_usd: -25 }],
        },
      })
    )
    const debt = await screen.findByText('1 customers owe ¥25')
    const rate = screen.getByText('Failure rate 3%')
    // Debt is a danger signal and the failure rate a warning, so debt leads.
    expect(
      debt.compareDocumentPosition(rate) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

function renderOverviewWith(
  data: Partial<Record<InsightsView, unknown>>,
  previous: Partial<Record<InsightsView, unknown>>,
  range?: InsightsRangeInfo
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const query = (source: typeof data, tag: string) => (view: InsightsView) => ({
    queryKey: [tag, view],
    queryFn: async () => source[view] ?? null,
    staleTime: Infinity,
  })
  render(
    <QueryClientProvider client={client}>
      <OverviewTab
        current={query(data, 'test')}
        previous={query(previous, 'prev')}
        refreshMs={{}}
        range={range}
      />
    </QueryClientProvider>
  )
}

describe('overview depth', () => {
  const HOUR = 3600
  const end = 10 * 86400 + 5 * HOUR + 900
  const range: InsightsRangeInfo = {
    start: end - 86400,
    end,
    days: 1,
    hourly: true,
  }
  const hour = (at: number, requests: number) => ({
    hour: at,
    requests,
    errors: 0,
    peak_concurrency: 0,
    engine_rejections: 0,
    upstream_rate_limits: 0,
  })

  it('calls a fall in the last full hour a possible outage, ahead of warnings', async () => {
    const last = end - 900 - HOUR
    const data = views({ quality: { error_rate: 0.03, errors: 30 } })
    data.capacity = {
      ...capacity,
      hourly: [hour(last - HOUR, 500), hour(last, 40), hour(last + HOUR, 1)],
    }
    renderOverviewWith(
      data,
      { capacity: { ...capacity, hourly: [hour(last - 86400, 480)] } },
      range
    )
    const drop = await screen.findByText(
      /^Requests fell to 40 in the hour from/
    )
    expect(drop.textContent).toMatch(/against 480 at the same hour before$/)
    const rate = screen.getByText('Failure rate 3%')
    expect(
      drop.compareDocumentPosition(rate) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('does not raise a failure rate over too few requests', async () => {
    renderOverviewWith(
      views({ quality: { requests: 50, errors: 5, error_rate: 0.1 } }),
      {}
    )
    expect(
      await screen.findByText('Nothing needs attention in this range.')
    ).toBeInTheDocument()
    expect(screen.getByText('Too few requests to judge')).toBeInTheDocument()
  })

  it('keeps debt and shared addresses when the pool is not configured', async () => {
    const data = views({ finance: { debt_usd: -25, debtors: [] } })
    data.pool = pool({ configured: false })
    renderOverviewWith(data, {})
    expect(
      await screen.findByText('Debt (negative balances)')
    ).toBeInTheDocument()
    expect(screen.getByText('Shared addresses')).toBeInTheDocument()
    expect(screen.queryByText('Schedulable accounts')).not.toBeInTheDocument()
  })

  it('raises failing upstream channels and a concentrated customer', async () => {
    const data = views({})
    data.upstream = {
      channels: [
        {
          id: 1,
          name: 'relay-a',
          requests: 900,
          errors: 100,
          failure_rate: 0.1,
          revenue_usd: 0,
          cost_usd: 0,
          cost_source: 'none',
          latest_cost_at: 0,
        },
      ],
      models: [],
      daily: [],
      rescues: [],
      truncated: false,
    }
    data.activity = {
      active_users: 3,
      top1_share: 0.6,
      top_users: [
        {
          user_id: 9,
          username: 'whale',
          quota_usd: 60,
          requests: 10,
          share: 0.6,
        },
      ],
    }
    renderOverviewWith(data, {})
    expect(
      await screen.findByText(
        '1 upstream channels fail more than 5% of attempts'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('relay-a 10%')).toBeInTheDocument()
    expect(
      screen.getByText('One customer, whale, used 60% of the consumption')
    ).toBeInTheDocument()
  })
})

describe('sparkline', () => {
  const points = [
    { title: '10/26', value: 100 },
    { title: '10/27', value: 300 },
    { title: '10/28', value: 200 },
  ]

  it('reads out the point under the pointer', () => {
    render(
      <Sparkline points={points} format={(v) => `¥${v}`} label='Revenue' />
    )
    const line = screen.getByRole('img', { name: /^Revenue/ })
    line.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 32 }) as DOMRect
    fireEvent.pointerMove(line, { clientX: 100 })
    expect(screen.getByRole('status')).toHaveTextContent('10/27 ¥300')

    fireEvent.pointerLeave(line)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps a tapped point read after the finger lifts', () => {
    render(
      <Sparkline points={points} format={(v) => `¥${v}`} label='Revenue' />
    )
    const line = screen.getByRole('img', { name: /^Revenue/ })
    line.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 32 }) as DOMRect
    // A tap sends pointerdown, then focus, then pointerleave as the finger
    // lifts; the point it picked survives all three.
    fireEvent.pointerDown(line, { clientX: 100, pointerType: 'touch' })
    fireEvent.focus(line)
    fireEvent.pointerLeave(line, { pointerType: 'touch' })
    expect(screen.getByRole('status')).toHaveTextContent('10/27 ¥300')

    fireEvent.blur(line)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('steps through points with the arrow keys', () => {
    render(
      <Sparkline points={points} format={(v) => `¥${v}`} label='Revenue' />
    )
    const line = screen.getByRole('img', { name: /^Revenue/ })
    fireEvent.focus(line)
    expect(screen.getByRole('status')).toHaveTextContent('10/28 ¥200')
    fireEvent.keyDown(line, { key: 'ArrowLeft' })
    expect(screen.getByRole('status')).toHaveTextContent('10/27 ¥300')
  })

  it('reads out the bar under the pointer across its whole column', () => {
    render(
      <Sparkline
        bars
        points={points}
        format={(v) => `¥${v}`}
        label='Revenue earned'
      />
    )
    const chart = screen.getByRole('img', { name: /^Revenue earned/ })
    chart.getBoundingClientRect = () =>
      ({ left: 0, width: 300, top: 0, height: 32 }) as DOMRect
    // Each bar owns a 100px column: its edges read out, not only its centre.
    for (const [clientX, text] of [
      [1, '10/26 ¥100'],
      [99, '10/26 ¥100'],
      [101, '10/27 ¥300'],
      [199, '10/27 ¥300'],
      [299, '10/28 ¥200'],
    ] as const) {
      fireEvent.pointerMove(chart, { clientX })
      expect(screen.getByRole('status')).toHaveTextContent(text)
    }
    expect(chart.querySelectorAll('rect')).toHaveLength(3)
  })
})

describe('bar hover areas', () => {
  it('keeps the gap between bars inside each bar, so no point is dead', () => {
    render(
      <BarSeries
        ariaLabel='daily'
        series={[{ label: 'Count' }]}
        points={[
          { key: 1, title: 'a', values: [1] },
          { key: 2, title: 'b', values: [2] },
        ]}
      />
    )
    const list = screen.getByRole('list', { name: 'daily' })
    expect(list.className).not.toMatch(/\bgap-/)
    const bar = screen.getByLabelText(/^a,/)
    expect(bar).toHaveClass('px-px')
  })

  it('opens a bar on a tap, which a touch screen sends instead of a hover', async () => {
    render(
      <BarSeries
        ariaLabel='daily'
        series={[{ label: 'Count' }]}
        points={[
          { key: 1, title: 'a', values: [1] },
          { key: 2, title: 'b', values: [2] },
        ]}
      />
    )
    fireEvent.pointerDown(screen.getByLabelText(/^b,/), {
      pointerType: 'touch',
    })
    const popup = await screen.findByText('b', {
      selector: '[data-slot=tooltip-content] p',
    })
    expect(popup.closest('[data-slot=tooltip-content]')).toHaveTextContent(
      'Count2'
    )
  })

  it('makes each bar its own list item, divider included, so no edge is dead', () => {
    render(
      <BarSeries
        ariaLabel='hourly'
        series={[{ label: 'Count' }]}
        points={[
          { key: 1, title: 'd1 00', axis: 'd1', values: [1] },
          { key: 2, title: 'd1 01', values: [1] },
          { key: 3, title: 'd2 00', axis: 'd2', values: [1] },
        ]}
      />
    )
    for (const item of screen.getAllByRole('listitem')) {
      expect(item).toHaveAttribute('data-slot', 'tooltip-trigger')
    }
    expect(screen.getByLabelText(/^d2 00,/)).toHaveClass('border-l')
    expect(screen.getByLabelText(/^d1 01,/)).not.toHaveClass('border-l')
  })

  it('draws a dense series edge to edge', () => {
    render(
      <BarSeries
        ariaLabel='hourly'
        series={[{ label: 'Count' }]}
        points={Array.from({ length: 168 }, (_, hour) => ({
          key: hour,
          title: `h${hour}`,
          values: [1],
        }))}
      />
    )
    expect(screen.getByLabelText(/^h0,/)).not.toHaveClass('px-px')
  })
})
