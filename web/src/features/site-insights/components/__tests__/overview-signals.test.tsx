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
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import type { InsightsView } from '../../api'
import type {
  CapacityInsights,
  EnginePool,
  FinanceInsights,
  OrderMethodFunnel,
  QualityInsights,
  RiskInsights,
  TaskOutcome,
} from '../../types'
import { upstreamCost, type InsightsFormat } from '../overview-analysis'
import {
  attemptsSentence,
  categoryCount,
  checkoutCompletion,
  completionDrop,
  failingTasks,
  peakTone,
  poolPeakAgainstSlots,
} from '../overview-signals'
import { OverviewTab } from '../overview-tab'

const t = ((key: string, vars?: Record<string, unknown>) =>
  key.replaceAll(/\{\{(\w+)\}\}/g, (_, name) =>
    String(vars?.[name] ?? '')
  )) as unknown as TFunction
const fmt = { num: String } as unknown as InsightsFormat

function task(fields: Partial<TaskOutcome>): TaskOutcome {
  return {
    submitted: 0,
    succeeded: 0,
    failed: 0,
    timed_out: 0,
    running: 0,
    stalled: 0,
    failure_rate: 0,
    finish_p50_s: 0,
    finish_p95_s: 0,
    reasons: null,
    ...fields,
  }
}

function method(fields: Partial<OrderMethodFunnel>): OrderMethodFunnel {
  return {
    payment_method: 'alipay',
    created: 0,
    paid: 0,
    failed: 0,
    expired: 0,
    pending: 0,
    pending_stale: 0,
    plan_orders: 0,
    paid_money: 0,
    completion_rate: 0,
    ...fields,
  }
}

const slots50 = { configured: true, effective_slots: 50 }

describe('overview service signals', () => {
  it('reads the pool peak against the slots only when the server sends it', () => {
    const base = {
      peak_concurrency: 80,
      peak_at: 10,
      pool: slots50,
    } as unknown as CapacityInsights
    expect(poolPeakAgainstSlots(base)).toBeUndefined()
    expect(
      poolPeakAgainstSlots({ ...base, pool_peak: 45, pool_peak_at: 20 })
    ).toEqual({ peak: 45, at: 20, slots: 50, share: 0.9 })
    expect(
      poolPeakAgainstSlots({
        ...base,
        pool_peak: 45,
        pool: { configured: false },
      } as unknown as CapacityInsights)
    ).toBeUndefined()
  })

  it('colors a pool peak full at the slots and near from 80%', () => {
    expect(peakTone(1)).toBe('danger')
    expect(peakTone(0.8)).toBe('warning')
    expect(peakTone(0.79)).toBe('default')
  })

  it('counts a category, 0 when absent', () => {
    expect(
      categoryCount([{ name: 'no_channel', count: 3 }], 'no_channel')
    ).toBe(3)
    expect(categoryCount(null, 'no_channel')).toBe(0)
  })

  it('flags media tasks past 5% over 100 finished, naming models over 20', () => {
    const quality = (total: TaskOutcome, models: TaskOutcome[]) =>
      ({
        tasks: { total, models, channels: [], truncated: false },
      }) as unknown as QualityInsights
    const models = [
      task({ model: 'a', succeeded: 18, failed: 2, failure_rate: 0.1 }),
      task({ model: 'b', succeeded: 5, failed: 5, failure_rate: 0.5 }),
      task({ model: 'c', succeeded: 60, failed: 10, failure_rate: 0.14 }),
    ]
    const total = task({ succeeded: 83, failed: 17, failure_rate: 0.17 })
    expect(
      failingTasks(quality(total, models))?.models.map((row) => row.model)
    ).toEqual(['c', 'a'])
    expect(
      failingTasks(
        quality(task({ succeeded: 80, failed: 19, failure_rate: 0.19 }), [])
      )
    ).toBeUndefined()
    expect(failingTasks({} as QualityInsights)).toBeUndefined()
  })

  it('leaves checkouts opened within the hour out of the completion rate', () => {
    expect(
      checkoutCompletion([
        method({ created: 10, paid: 4, pending: 3, pending_stale: 1 }),
        method({ created: 4, paid: 2 }),
      ])
    ).toEqual({ created: 14, paid: 6, settled: 12, rate: 0.5 })
    expect(checkoutCompletion(null)).toEqual({
      created: 0,
      paid: 0,
      settled: 0,
      rate: undefined,
    })
  })

  it('calls a completion rate under half the previous one a drop, over enough checkouts', () => {
    const finance = (created: number, paid: number) =>
      ({
        order_methods: [method({ created, paid })],
      }) as unknown as FinanceInsights
    expect(completionDrop(finance(10, 2), finance(10, 8))).toEqual({
      rate: 0.2,
      previous: 0.8,
      paid: 2,
      created: 10,
    })
    expect(completionDrop(finance(10, 4), finance(10, 8))).toBeUndefined()
    expect(completionDrop(finance(4, 0), finance(10, 8))).toBeUndefined()
    expect(
      completionDrop({} as FinanceInsights, finance(10, 8))
    ).toBeUndefined()
  })

  it('states attempts beside requests only when they differ', () => {
    const capacity = (attempts?: number) =>
      ({
        requests: 100,
        attempts,
        attempt_errors: 12,
      }) as unknown as CapacityInsights
    expect(attemptsSentence(t, fmt, capacity(120))).toBe(
      'Customers’ attempts: 12 of 120 failed.'
    )
    expect(attemptsSentence(t, fmt, capacity(100))).toBeUndefined()
    expect(attemptsSentence(t, fmt, capacity())).toBeUndefined()
  })

  it('sums upstream bills one for one and fees at the exchange rate', () => {
    const finance = {
      vendor_upstream: [
        { vendor: 'codex', bill_usd: 30, fee_usd: 2 },
        { vendor: 'media', bill_usd: 5, fee_usd: 0 },
      ],
      upstream_unattributed_bill_usd: 1,
      upstream_unattributed_fee_usd: 1,
    } as unknown as FinanceInsights
    expect(upstreamCost(finance, 7)).toBe(36 + 3 * 7)
    expect(upstreamCost({} as FinanceInsights, 7)).toBeUndefined()
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

function renderOverview(
  data: Partial<Record<InsightsView, unknown>>,
  failing: InsightsView[] = [],
  previous: Partial<Record<InsightsView, unknown>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const query = (source: typeof data, tag: string) => (view: InsightsView) => ({
    queryKey: [tag, view],
    queryFn: async () => {
      if (tag === 'now' && failing.includes(view)) throw new Error('boom')
      return source[view] ?? null
    },
    staleTime: Infinity,
  })
  render(
    <QueryClientProvider client={client}>
      <OverviewTab
        current={query(data, 'now')}
        previous={query(previous, 'prev')}
        refreshMs={{}}
      />
    </QueryClientProvider>
  )
}

const quality = {
  requests: 1000,
  errors: 10,
  error_rate: 0.01,
  models: [],
  daily: [],
} as unknown as QualityInsights
const risk = {
  signups: 4,
  alias_emails: 0,
  off_whitelist: 0,
  shared_ips: [],
} as unknown as RiskInsights

describe('overview with a source missing', () => {
  it('shows - with no change for a failed source, never a zero', async () => {
    renderOverview({ quality, risk, pool }, ['finance'], {
      finance: { revenue: 3200 },
    })
    expect(
      await screen.findByText('Funds could not be read')
    ).toBeInTheDocument()
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/▼ 100%/)).not.toBeInTheDocument()
    expect(screen.queryByText('0 orders · 0 payers')).not.toBeInTheDocument()
  })

  it('puts what needs attention above the cards below the headline', async () => {
    renderOverview({ quality, risk, pool, finance: null })
    const attention = await screen.findByText('Needs attention')
    const failure = screen.getByText('Failure rate')
    expect(
      attention.compareDocumentPosition(failure) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('raises the new refusals and media task failures', async () => {
    renderOverview({
      quality: {
        ...quality,
        stale_hours: 0,
        refusals: { no_channel: 7, risk_gate: 0, risk_gate_stages: null },
        tasks: {
          total: task({ succeeded: 90, failed: 10, failure_rate: 0.1 }),
          models: [],
          channels: [],
          truncated: false,
        },
      },
      capacity: {
        requests: 1000,
        errors: 10,
        peak_concurrency: 70,
        peak_at: 0,
        pool_peak: 50,
        pool: slots50,
        error_categories: [
          { name: 'engine_budget', count: 4 },
          { name: 'upstream_auth', count: 3 },
        ],
        limit_rejection_total: 0,
        hourly: [],
      },
      risk,
      pool,
    })
    expect(
      await screen.findByText('7 requests found no channel for their model')
    ).toBeInTheDocument()
    expect(
      screen.getByText('10% of image and video tasks failed')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '4 requests found no pool account with rate or budget left'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('Upstreams refused our key 3 times')
    ).toBeInTheDocument()
    expect(
      screen.getByText('The pool’s peak 50 reached its 50 slots')
    ).toBeInTheDocument()
    expect(screen.getByText('Pool peak')).toBeInTheDocument()
    expect(screen.getByText('Requests failed')).toBeInTheDocument()
  })
})

describe('overview quality rate', () => {
  it('names the service failure rate, not one that counts customers’ own bad requests', async () => {
    const failing = {
      ...quality,
      requests: 1000,
      stale_hours: 0,
      errors: 60,
      error_rate: 0.06,
      error_categories: [
        { name: 'upstream_error', count: 10 },
        { name: 'client_error', count: 50 },
      ],
    }
    renderOverview({ quality: failing, risk, pool })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(document.body.textContent).not.toContain('of requests failed')
  })

  it('still names a failure rate the service caused', async () => {
    renderOverview({
      quality: {
        ...quality,
        requests: 1000,
        stale_hours: 0,
        errors: 60,
        error_rate: 0.06,
        error_categories: [{ name: 'upstream_error', count: 60 }],
      },
      risk,
      pool,
    })
    expect(await screen.findByText(/of requests failed/)).toBeInTheDocument()
  })
})
