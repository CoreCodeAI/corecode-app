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
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { InsightsView } from '../../api'
import type {
  ActivityInsights,
  EnginePool,
  FinanceInsights,
  QualityInsights,
  RiskInsights,
} from '../../types'
import type { Finding } from '../insight-kit'
import { TopCustomersPanel } from '../overview-kpis'
import {
  attentionCounts,
  tabHealth,
  URGENT_SHOWN,
} from '../overview-health'
import { niceAxis, overviewTrends } from '../overview-series'
import { OverviewTab } from '../overview-tab'
import { ComboChart } from '../overview-trend-charts'
import type { TabVerdicts } from '../overview-verdicts'
import type { TrendPoint } from '../shared'

const DAY = 86400

function point(title: string, value: number, extra?: Partial<TrendPoint>) {
  return { title, value, ...extra } satisfies TrendPoint
}

describe('overview axis', () => {
  it('rounds the top of an axis up to a step of 1, 2, 2.5 or 5', () => {
    expect(niceAxis(0)).toEqual({ top: 1, ticks: [0, 1] })
    expect(niceAxis(67_523).top).toBe(80_000)
    expect(niceAxis(0.034).top).toBeCloseTo(0.04)
    expect(niceAxis(304_535).ticks.at(-1)).toBe(niceAxis(304_535).top)
  })
})

describe('overview trends', () => {
  const finance = {
    daily: [
      {
        day: DAY,
        topup: 100,
        subscription: 20,
        consumption_usd: 50,
        root_consumption_usd: 5,
        recognized_revenue: 60,
      },
      {
        day: 2 * DAY,
        topup: 200,
        subscription: 0,
        consumption_usd: 70,
        recognized_revenue: 90,
      },
    ],
  } as unknown as FinanceInsights
  const quality = {
    daily: [
      { day: DAY, requests: 100, error_rate: 0.02, errors: 2 },
      { day: 2 * DAY, requests: 300, error_rate: 0.1, errors: 30 },
    ],
  } as unknown as QualityInsights
  const input = {
    hourly: false,
    end: 3 * DAY,
    span: 2 * DAY,
    previousMissing: false,
    logsSince: 0,
    dayTitle: (day: number) => `d${day / DAY}`,
    hourTitle: (hour: number) => `h${hour}`,
    // The first day is part of a day, and a projection of its requests.
    financeDay: (day: number, values?: number[]) =>
      day === DAY
        ? { note: 'part', projected: values?.map((value) => value * 2) }
        : undefined,
    qualityDay: (day: number, values?: number[]) =>
      day === DAY
        ? { note: 'part', projected: values?.map((value) => value * 2) }
        : undefined,
  }

  it('reads revenue, consumption and earned revenue from the same days', () => {
    const trends = overviewTrends({ ...input, finance })
    expect(trends.revenue?.map((p) => p.value)).toEqual([120, 200])
    // Root's own charge counts: the card says "root and staff included".
    expect(trends.consumption?.map((p) => p.value)).toEqual([55, 70])
    expect(trends.recognized?.map((p) => p.value)).toEqual([60, 90])
    expect(trends.revenue?.map((p) => p.title)).toEqual(['d1', 'd2'])
  })

  it('projects a part of a day for amounts, not for a rate or earned revenue', () => {
    const trends = overviewTrends({ ...input, finance, quality })
    expect(trends.revenue?.[0].partial?.projected).toEqual([240])
    expect(trends.requests?.[0].partial?.projected).toEqual([200])
    expect(trends.failureRate?.[0].partial).toEqual({ note: 'part' })
    expect(trends.recognized?.[0].partial).toEqual({ note: 'part' })
  })

  it('compares each day with the same place of the previous period', () => {
    const previousFinance = {
      daily: [{ day: 0, topup: 10, subscription: 0, consumption_usd: 1 }],
    } as unknown as FinanceInsights
    const trends = overviewTrends({ ...input, finance, previousFinance })
    expect(trends.revenue?.map((p) => p.previous)).toEqual([10, undefined])
    const missing = overviewTrends({
      ...input,
      finance,
      previousFinance,
      previousMissing: true,
    })
    expect(missing.revenue?.map((p) => p.previous)).toEqual([
      undefined,
      undefined,
    ])
  })

  it('leaves out series with no source and earned revenue by the hour', () => {
    expect(overviewTrends(input).revenue).toEqual([])
    const hourly = overviewTrends({
      ...input,
      hourly: true,
      finance: {
        ...finance,
        hourly: [
          {
            hour: 3600,
            topup: 5,
            subscription: 0,
            consumption_usd: 2,
            root_consumption_usd: 0,
          },
        ],
      } as unknown as FinanceInsights,
    })
    expect(hourly.revenue?.map((p) => p.value)).toEqual([5])
    expect(hourly.recognized).toBeUndefined()
    expect(hourly.requests).toBeUndefined()
  })
})

describe('overview health', () => {
  const finding = (
    key: string,
    tone: Finding['tone'],
    tab?: Finding['tab']
  ): Finding => ({ key, tone, title: key, tab })

  it('counts red and amber and leaves notes out', () => {
    expect(
      attentionCounts([
        finding('a', 'danger'),
        finding('b', 'warning'),
        finding('c', 'warning'),
        finding('d', 'default'),
      ])
    ).toEqual({ danger: 1, warning: 2, total: 3 })
  })

  it('marks a tab by the worse of its verdict and the findings naming it', () => {
    const verdicts: TabVerdicts = [
      ['quality', { tone: 'good', text: 'fine', points: ['fine'] }],
      ['finance', { tone: 'warning', text: 'hm', points: ['hm'] }],
    ]
    const signals = [
      finding('q', 'danger', 'quality'),
      finding('p', 'warning', 'pool'),
    ]
    expect(tabHealth('quality', verdicts, signals, true)).toBe('danger')
    expect(tabHealth('finance', verdicts, signals, true)).toBe('warning')
    expect(tabHealth('pool', verdicts, signals, true)).toBe('warning')
    // Nothing says anything about the risk tab: green once read, grey before.
    expect(tabHealth('risk', verdicts, signals, true)).toBe('good')
    expect(tabHealth('risk', verdicts, signals, false)).toBeUndefined()
  })
})

describe('combo chart', () => {
  const bars = [point('Mon', 10), point('Tue', 30), point('Wed', 20)]
  const rate = [point('Mon', 0.1), point('Tue', 0.2), point('Wed', 0.05)]
  const pct = (value: number) => `${Math.round(value * 100)}%`

  function chart(extra?: Partial<Parameters<typeof ComboChart>[0]>) {
    return render(
      <ComboChart
        ariaLabel='Requests'
        bars={bars}
        barLabel='Requests'
        barFormat={String}
        barColor='red'
        rightAxisFormat={pct}
        lines={[
          {
            key: 'rate',
            label: 'Failure rate',
            points: rate,
            format: pct,
            axis: 'right',
            color: 'blue',
          },
        ]}
        {...extra}
      />
    )
  }

  it('draws a bar per point and a line on the right axis', () => {
    const { container } = chart()
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    expect(container.querySelector('[data-line="rate"] path')).toBeTruthy()
    expect(screen.getByText('right axis')).toBeInTheDocument()
    // The right axis reads in its own unit.
    expect(container.textContent).toContain('20%')
  })

  it('reads out a position under the pointer', () => {
    const { container } = chart()
    const box = screen.getByRole('img')
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 640,
      width: 640,
      top: 0,
      bottom: 220,
      height: 220,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.pointerMove(box, { clientX: 320 })
    const tip = within(box).getByRole('status')
    expect(tip).toHaveTextContent('Tue')
    expect(tip).toHaveTextContent('Requests 30')
    expect(tip).toHaveTextContent('Failure rate 20%')
    fireEvent.pointerLeave(box)
    expect(within(box).queryByRole('status')).not.toBeInTheDocument()
    expect(container.querySelectorAll('rect')).toHaveLength(3)
  })

  it('moves between points with the arrow keys', async () => {
    chart()
    const box = screen.getByRole('img')
    act(() => box.focus())
    // Focus opens on the latest point.
    expect(within(box).getByRole('status')).toHaveTextContent('Wed')
    await userEvent.keyboard('{ArrowLeft}')
    expect(within(box).getByRole('status')).toHaveTextContent('Tue')
  })

  it('draws a day in part faint, says so, and leaves a gap for no data', () => {
    const { container } = chart({
      bars: [
        point('Mon', 10, { partial: { note: 'In progress' } }),
        point('Tue', 0, { missing: true }),
        point('Wed', 20),
      ],
    })
    const rects = [...container.querySelectorAll('rect')]
    expect(rects).toHaveLength(2)
    expect(rects[0].getAttribute('opacity')).toBe('0.4')
  })

  it('leaves out a line that does not share the bars’ positions', () => {
    const { container } = chart({
      lines: [
        {
          key: 'short',
          label: 'Short',
          points: rate.slice(1),
          format: pct,
          color: 'blue',
        },
      ],
    })
    expect(container.querySelector('[data-line="short"]')).toBeNull()
    expect(screen.queryByText('Short')).not.toBeInTheDocument()
  })

  it('draws the previous period as a dashed reference', () => {
    const { container } = chart({
      bars: bars.map((each) => ({ ...each, previous: each.value / 2 })),
    })
    expect(container.querySelector('[data-reference]')).toBeTruthy()
  })

  it('draws nothing for fewer than two points', () => {
    const { container } = chart({ bars: [point('Mon', 1)], lines: [] })
    expect(container).toBeEmptyDOMElement()
  })
})

describe('top customers', () => {
  const user = (id: number, quota: number, share: number) => ({
    user_id: id,
    username: `user${id}`,
    quota_usd: quota,
    requests: 5,
    share,
  })

  it('ranks the customers with their charge and share, ten at most', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      user(index + 1, 1200 - index * 100, 0.1)
    )
    render(
      <TopCustomersPanel
        activity={{ top_users: rows } as unknown as ActivityInsights}
      />
    )
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    expect(within(list).getByText('user1')).toBeInTheDocument()
    expect(within(list).queryByText('user11')).not.toBeInTheDocument()
  })

  it('says when it cannot be read, and when nobody used the service', () => {
    const { rerender } = render(
      <TopCustomersPanel activity={undefined} failed />
    )
    expect(screen.getByText('Could not be read')).toBeInTheDocument()
    rerender(
      <TopCustomersPanel
        activity={{ top_users: [] } as unknown as ActivityInsights}
      />
    )
    expect(
      screen.getByText('No customer used the service in this range')
    ).toBeInTheDocument()
  })
})

const pool = {
  configured: true,
  eligible_accounts: 10,
  effective_slots: 50,
  in_flight: 3,
  groups: [],
  accounts: [],
  five_hour_estimate: null,
  week_estimate: null,
} as unknown as EnginePool

const quality = {
  requests: 1000,
  errors: 10,
  error_rate: 0.01,
  models: [],
  daily: [
    { day: DAY, requests: 400, errors: 4, error_rate: 0.01 },
    { day: 2 * DAY, requests: 600, errors: 6, error_rate: 0.01 },
  ],
} as unknown as QualityInsights

const finance = {
  revenue: 320,
  topup_revenue: 300,
  subscription_revenue: 20,
  recognized_revenue: 250,
  orders: 4,
  paying_users: 3,
  consumption_usd: 100,
  root_consumption_usd: 5,
  debt_usd: -5,
  debtors: [
    { user_id: 1, username: 'a', balance_usd: -3 },
    { user_id: 2, username: 'b', balance_usd: -2 },
  ],
  top_balances: [],
  methods: [],
  daily: [
    {
      day: DAY,
      topup: 100,
      subscription: 0,
      consumption_usd: 40,
      recognized_revenue: 90,
    },
    {
      day: 2 * DAY,
      topup: 200,
      subscription: 20,
      consumption_usd: 60,
      recognized_revenue: 160,
    },
  ],
} as unknown as FinanceInsights

const risk = {
  signups: 4,
  alias_emails: 3,
  off_whitelist: 1,
  shared_ips: [],
} as unknown as RiskInsights

function renderOverview(data: Partial<Record<InsightsView, unknown>>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const query = (source: typeof data, tag: string) => (view: InsightsView) => ({
    queryKey: [tag, view],
    queryFn: async () => source[view] ?? null,
    staleTime: Infinity,
  })
  const onOpen = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <OverviewTab
        current={query(data, 'now')}
        previous={query({}, 'prev')}
        refreshMs={{}}
        onOpen={onOpen}
      />
    </QueryClientProvider>
  )
  return onOpen
}

const attentionPanel = () =>
  document.querySelector('#overview-attention') as HTMLElement

const before = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('overview layout', () => {
  it('opens on the status bar, then the figures, then the charts', async () => {
    renderOverview({ quality, finance, risk, pool })
    const bar = await screen.findByText(/items need attention/)
    const revenue = screen.getAllByText('Revenue')[0]
    const chart = screen.getByText('Revenue and consumption')
    const requests = screen.getByText('Requests and failure rate')
    const tabs = screen.getByText('Tab by tab')
    const attention = screen.getByRole('heading', { name: /Needs attention/ })
    expect(before(bar, revenue)).toBe(true)
    expect(before(revenue, chart)).toBe(true)
    expect(before(chart, requests)).toBe(true)
    expect(before(requests, tabs)).toBe(true)
    // What needs attention is the last panel.
    expect(before(tabs, attention)).toBe(true)
  })

  it('draws eight figures, each with its own trend where it has one', async () => {
    renderOverview({ quality, finance, risk, pool })
    await screen.findByText('Revenue earned')
    for (const label of [
      'Revenue',
      'Revenue earned',
      'Gross margin',
      'Consumption',
      'Requests',
      'Failure rate',
      'Active users',
      'Sign-ups',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    // Revenue, earned revenue, consumption, requests and the failure rate
    // draw a trend above the charts' own.
    expect(
      (await screen.findAllByRole('img', { name: /from .* to .*, latest/ }))
        .length
    ).toBeGreaterThanOrEqual(5)
  })

  it('draws the two charts from the cards’ series', async () => {
    renderOverview({ quality, finance, risk, pool })
    const revenueChart = await screen.findByRole('img', {
      name: /^Revenue and consumption:/,
    })
    expect(within(revenueChart).queryByRole('status')).not.toBeInTheDocument()
    const requestChart = screen.getByRole('img', {
      name: /^Requests and failure rate:/,
    })
    expect(requestChart.querySelectorAll('rect')).toHaveLength(2)
  })

  it('keeps the findings in the page but folds all but the first red ones', async () => {
    renderOverview({
      quality,
      finance: { ...finance, debt_usd: -50 },
      risk,
      pool,
    })
    await screen.findByText(/items need attention/)
    const panel = within(attentionPanel())
    const debt = panel.getByText(/owe/)
    const amber = panel.getByText(/alias emails/)
    // Every finding is in the page; the amber one waits behind the fold.
    expect(debt.closest('[hidden]')).toBeNull()
    expect(amber.closest('[hidden]')).not.toBeNull()
    expect(URGENT_SHOWN).toBe(3)
    await userEvent.click(screen.getByRole('button', { name: /Show all/ }))
    expect(amber.closest('[hidden]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(amber.closest('[hidden]')).not.toBeNull()
  })

  it('opens the folded findings from the status bar', async () => {
    renderOverview({ quality, finance, risk, pool })
    await screen.findByText(/items need attention/)
    const amber = within(attentionPanel()).getByText(/alias emails/)
    expect(amber.closest('[hidden]')).not.toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: /items need attention/ })
    )
    expect(amber.closest('[hidden]')).toBeNull()
  })

  it('opens a tab from its dot in the status bar', async () => {
    const onOpen = renderOverview({ quality, finance, risk, pool })
    await screen.findByText(/items need attention/)
    await userEvent.click(screen.getByRole('button', { name: 'Funds' }))
    expect(onOpen).toHaveBeenCalledWith('finance')
  })

  it('says all clear when nothing needs attention', async () => {
    renderOverview({
      quality,
      finance: { ...finance, debt_usd: 0, debtors: [] },
      risk: { ...risk, alias_emails: 0, off_whitelist: 0 },
      pool,
    })
    expect(await screen.findByText('All clear')).toBeInTheDocument()
  })

  it('gives each tab a card with its headline, the rest under a fold', async () => {
    renderOverview({ quality, finance, risk, pool })
    const heading = await screen.findByText('Tab by tab')
    const panel = heading.closest('[data-slot="card"]') as HTMLElement
    expect(panel).not.toBeNull()
    const cards = panel.querySelectorAll('li[data-tone]')
    expect(cards.length).toBeGreaterThanOrEqual(3)
    // Only a headline shows; the rest of a verdict sits under a fold.
    expect(panel.querySelectorAll('details').length).toBeGreaterThan(0)
  })
})
