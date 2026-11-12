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
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  accountLimits,
  dailyPeaks,
  diagnoseRejections,
  enabledInFlight,
  engineRefusals,
  failureHours,
  headroom,
  peakTrend,
  periodSpan,
} from '../../capacity-analysis'
import type { CapacityHour, CapacityInsights, EngineGroup } from '../../types'
import { CapacityTab } from '../capacity-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

function group(overrides: Partial<EngineGroup>): EngineGroup {
  return {
    id: 1,
    name: 'group',
    channel: 'claude',
    enabled: true,
    in_flight: 0,
    effective_limit: 10,
    override_limit: null,
    accounts: 1,
    eligible: 1,
    slots: 5,
    counts: null,
    quota_budget: true,
    five_hour_budget: 90,
    seven_day_budget: 95,
    ...overrides,
  }
}

function insights(): CapacityInsights {
  return {
    requests: 10,
    errors: 0,
    peak_concurrency: 3,
    peak_at: 0,
    peak_rpm: 2,
    peak_rpm_at: 0,
    error_categories: [],
    hourly: [],
    user_peaks: [],
    truncated: false,
    in_flight: 7,
    in_flight_users: [],
    user_limits: [],
    limit_rejections: [],
    limit_rejection_total: 4,
    limit_rejected_users: [],
    concurrency_limits: null,
    concurrency_tiers: null,
    pool: {
      configured: true,
      observed_at_ms: 0,
      credential_concurrency: 5,
      five_hour_budget: 90,
      seven_day_budget: 95,
      eligible_accounts: 3,
      effective_slots: 30,
      in_flight: 0,
      groups: [
        group({
          id: 1,
          channel: 'claude',
          accounts: 4,
          slots: 20,
          in_flight: 5,
        }),
        group({
          id: 2,
          channel: 'codex',
          accounts: 1,
          slots: 10,
          in_flight: 2,
        }),
      ],
      accounts: [],
      five_hour_estimate: null,
      week_estimate: null,
      refills: [],
    },
  } as unknown as CapacityInsights
}

const client = new QueryClient()
const wrapper = (props: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
)

describe('capacity tab by provider', () => {
  it('offers every provider and reports which one was picked', async () => {
    const onVendor = vi.fn()
    render(<CapacityTab data={insights()} vendor='all' onVendor={onVendor} />, {
      wrapper,
    })
    expect(screen.getByText('All providers')).toBeTruthy()
    await userEvent.click(screen.getByText('Codex'))
    expect(onVendor).toHaveBeenCalledWith('codex')
  })

  it('shows per-user limits only across every provider', () => {
    const { rerender } = render(
      <CapacityTab data={insights()} vendor='all' />,
      { wrapper }
    )
    expect(screen.getByText('Per-user limit 429')).toBeTruthy()
    expect(screen.getByText('Peak concurrency by user')).toBeTruthy()
    expect(screen.getByText('30 pool slots')).toBeTruthy()

    rerender(<CapacityTab data={insights()} vendor='codex' />)
    expect(screen.queryByText('Per-user limit 429')).toBeNull()
    expect(screen.queryByText('Peak concurrency by user')).toBeNull()
    // Codex's own slots and in-flight count, from its engine groups.
    expect(screen.getByText('10 pool slots')).toBeTruthy()
    expect(screen.getAllByText('Upstream rate limit').length).toBeGreaterThan(0)
  })
})

const HOUR = 3600

function hour(at: number, values: Partial<CapacityHour> = {}): CapacityHour {
  return {
    hour: at,
    requests: 100,
    errors: 0,
    peak_concurrency: 0,
    engine_rejections: 0,
    upstream_rate_limits: 0,
    ...values,
  }
}

describe('capacity analysis', () => {
  it('counts closed hours near and past the slots, leaving out the open one', () => {
    const rows = [
      hour(0, { peak_concurrency: 9 }),
      hour(HOUR, { peak_concurrency: 5 }),
      hour(2 * HOUR, { peak_concurrency: 12 }),
    ]
    expect(headroom(rows, 10, 2 * HOUR + 60)).toEqual({
      near: 1,
      over: 0,
      tightest: { hour: 0, peak: 9, free: 1 },
    })
    expect(headroom(rows, 10, 3 * HOUR)).toEqual({
      near: 2,
      over: 1,
      tightest: { hour: 2 * HOUR, peak: 12, free: -2 },
    })
    expect(headroom(rows, 0, 3 * HOUR)).toBeUndefined()
  })

  it('weighs engine rejections by the peak of their hour', () => {
    const rows = [
      hour(0, { peak_concurrency: 9, engine_rejections: 9 }),
      hour(HOUR, { peak_concurrency: 2, engine_rejections: 15 }),
      hour(2 * HOUR, { peak_concurrency: 1 }),
    ]
    expect(diagnoseRejections(rows, 10)).toEqual({
      total: 24,
      hours: 2,
      worst: { hour: HOUR, count: 15, peak: 2 },
      saturated: 9,
      cause: 'eligibility',
    })
    expect(diagnoseRejections(rows, 0)?.cause).toBeUndefined()
    expect(diagnoseRejections(rows.slice(2), 10)).toBeUndefined()
    rows[0].engine_rejections = 15
    expect(diagnoseRejections(rows, 10)?.cause).toBe('saturation')
    // Under POOL_FULL_DANGER rejections a cause is not named.
    expect(
      diagnoseRejections(
        [hour(0, { peak_concurrency: 9, engine_rejections: 3 })],
        10
      )?.cause
    ).toBeUndefined()
  })

  it('flags an hour failing far above the previous period’s same hour', () => {
    const day = 86400
    const rows = [
      hour(day, { errors: 30 }),
      hour(day + HOUR, { requests: 10, errors: 9 }),
      hour(day + 2 * HOUR, { errors: 2 }),
      hour(day + 3 * HOUR, { errors: 90 }),
    ]
    const previous = [hour(0, { errors: 2 }), hour(2 * HOUR, { errors: 1 })]
    const hours = failureHours(rows, previous, day, day + 3 * HOUR + 60)
    expect(
      hours.map((row) => [row.rate, row.previousRate, row.baseline, row.spike])
    ).toEqual([
      [0.3, 0.02, 0.02, true],
      // Too few requests for a rate.
      [null, null, 0.16, false],
      [0.02, 0.01, 0.01, false],
      // The open hour is never flagged.
      [0.9, null, 0.16, false],
    ])
  })

  it('takes the peak of whole days only', () => {
    const day = 86400
    const rows = Array.from({ length: 50 }, (_, index) =>
      hour(index * HOUR + 12 * HOUR, { peak_concurrency: index })
    )
    // Hours 12..61: the first and last days are cut.
    expect(dailyPeaks(rows, 100 * day, (at) => Math.floor(at / day))).toEqual([
      { day: 1, peak: 35 },
    ])
  })

  it('fits the daily peak and counts the days until it meets the slots', () => {
    expect(peakTrend([10, 12, 14, 16, 18], 30)).toEqual({
      slope: 2,
      fitted: 18,
      daysToFull: 6,
    })
    expect(peakTrend([10, 12, 14, 16, 18], 0)).toEqual({ slope: 2, fitted: 18 })
    expect(peakTrend([18, 16, 14, 12, 10], 30)?.daysToFull).toBeUndefined()
    expect(peakTrend([40, 40, 40, 41, 42], 30)?.daysToFull).toBe(0)
    expect(peakTrend([10, 12, 14, 16], 30)).toBeUndefined()
  })

  it('finds the previous period by the range, or by the series', () => {
    const range = { start: 100, end: 86500, days: 1, hourly: true }
    expect(periodSpan(range, [], [])).toBe(86400)
    expect(periodSpan(undefined, [hour(7200)], [hour(3600)])).toBe(3600)
    expect(periodSpan(undefined, [hour(7200)], null)).toBeUndefined()
  })
})

describe('capacity tab by range', () => {
  const now = 30 * 86400
  const day = { start: now - 86400, end: now, days: 1, hourly: true }
  const week = { start: now - 7 * 86400, end: now, days: 7, hourly: false }

  it('drops the weekday grid under a week and diagnoses short-pool 429s', () => {
    const data = insights()
    data.hourly = [
      hour(now - 2 * HOUR, { peak_concurrency: 4, engine_rejections: 20 }),
      hour(now - HOUR + 600, { peak_concurrency: 1 }),
    ]
    render(<CapacityTab data={data} vendor='all' range={day} />, { wrapper })
    expect(
      screen.queryByText('Peak concurrency by weekday and hour')
    ).toBeNull()
    expect(screen.queryByText('Daily peak concurrency')).toBeNull()
    expect(screen.getByText('Hourly failure rate')).toBeTruthy()
    expect(
      screen.getByText(
        /with the peak only 4 of 30 slots: too few accounts were schedulable then/
      )
    ).toBeTruthy()
    expect(screen.getByText('Check the account pool')).toBeTruthy()
  })

  it('keeps the weekday grid from a week up, beside the daily peak trend', () => {
    const data = insights()
    data.hourly = Array.from({ length: 7 * 24 }, (_, index) =>
      hour(now - (7 * 24 - index) * HOUR, { peak_concurrency: 2 })
    )
    render(<CapacityTab data={data} vendor='all' range={week} />, { wrapper })
    expect(
      screen.getByText('Peak concurrency by weekday and hour')
    ).toBeTruthy()
    expect(screen.getByText('Daily peak concurrency')).toBeTruthy()
  })
})

describe('capacity on the pool’s own terms', () => {
  it('reads the pool’s peak against the slots where the server sends it', () => {
    const rows = [
      hour(0, { peak_concurrency: 14, pool_peak: 7, engine_rejections: 20 }),
      hour(HOUR, { peak_concurrency: 4 }),
    ]
    // The site's 14 is past the slots; the pool's 7 is under them.
    expect(headroom(rows, 10, 3 * HOUR)).toEqual({
      near: 0,
      over: 0,
      tightest: { hour: 0, peak: 7, free: 3 },
    })
    expect(diagnoseRejections(rows, 10)?.cause).toBe('eligibility')
    expect(dailyPeaks(rows, 100 * HOUR, () => 0)).toEqual([])
  })

  it('reads the site’s peak per day when the pool’s is not the headline', () => {
    const rows = Array.from({ length: 24 }, (_, index) =>
      hour(
        index * HOUR,
        index === 0 ? { peak_concurrency: 14, pool_peak: 7 } : {}
      )
    )
    expect(dailyPeaks(rows, 100 * HOUR, () => 0, false)).toEqual([
      { day: 0, peak: 14 },
    ])
    expect(dailyPeaks(rows, 100 * HOUR, () => 0)).toEqual([{ day: 0, peak: 7 }])
  })

  it('splits the engine’s refusals, counts enabled groups, and reads each group’s limit', () => {
    expect(
      engineRefusals([
        { name: 'engine_concurrency', count: 5 },
        { name: 'engine_limit', count: 2 },
        { name: 'engine_budget', count: 1 },
        { name: 'upstream_rate_limit', count: 9 },
      ])
    ).toEqual({ full: 5, limit: 2, budget: 1 })
    expect(engineRefusals(null)).toEqual({ full: 0, limit: 0, budget: 0 })
    const groups = [
      group({ id: 1, in_flight: 5 }),
      group({ id: 2, in_flight: 3, enabled: false }),
    ]
    expect(enabledInFlight(groups)).toBe(5)
    expect(accountLimits(groups, 4)).toEqual([4])
    expect(
      accountLimits(
        [
          { ...group({ id: 1 }), credential_limit: 8 },
          group({ id: 3 }),
          { ...group({ id: 2, enabled: false }), credential_limit: 2 },
        ],
        4
      )
    ).toEqual([4, 8])
    expect(
      accountLimits([{ ...group({ id: 5 }), credential_limit: 0 }], 4)
    ).toEqual([0])
  })

  it('shows the pool peak beside the site’s, and the engine’s in-flight count', () => {
    const data = insights()
    data.in_flight = 99
    data.pool_peak = 6
    data.pool_peak_at = 0
    data.peak_concurrency = 40
    data.error_categories = [{ name: 'upstream_rate_limit', count: 3 }]
    data.limit_rejected_users = [{ user_id: 3, username: 'eve', count: 4 }]
    render(<CapacityTab data={data} vendor='all' />, { wrapper })
    expect(screen.getByText('Pool peak concurrency')).toBeTruthy()
    expect(
      screen.getByText(
        /^Pool peak 6 at .+, 20% of the 30 pool slots; the site's, every channel, was 40\.$/
      )
    ).toBeTruthy()
    // The engine's 5 + 2 over enabled groups, not this server's 99.
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.queryByText('99')).toBeNull()
    // Every provider's 429s are not Claude's.
    expect(screen.queryByText('Claude upstream rate limit')).toBeNull()
    expect(screen.getAllByText('Upstream rate limit').length).toBeGreaterThan(0)
    expect(screen.getByText('Refused attempts')).toBeTruthy()
  })

  it('reads the site’s peak, not the pool’s, when a stale range sends no top-level pool peak', () => {
    const data = insights()
    data.peak_concurrency = 40
    data.hourly = [hour(0, { peak_concurrency: 40, pool_peak: 6 })]
    render(<CapacityTab data={data} vendor='all' />, { wrapper })
    expect(screen.queryByText('Pool peak concurrency')).toBeNull()
    expect(screen.getAllByText('Peak concurrency').length).toBeGreaterThan(0)
  })

  it('hides the in-flight meter when the pool cannot be read', () => {
    const data = insights()
    data.pool = { ...data.pool, error: 'engine down' }
    render(<CapacityTab data={data} vendor='all' />, { wrapper })
    expect(screen.getByText('The engine pool could not be read')).toBeTruthy()
    expect(screen.getByText('engine down')).toBeTruthy()
  })

  it('names the engine’s caps and budgets with their own actions', () => {
    const data = insights()
    data.error_categories = [
      { name: 'engine_limit', count: 3 },
      { name: 'engine_budget', count: 2 },
    ]
    render(<CapacityTab data={data} vendor='claude' />, { wrapper })
    expect(
      screen.getByText(
        /raise the group's limit or the key's cap\..*wait for the window to reset or add accounts\./
      )
    ).toBeTruthy()
    expect(
      screen.getByText('Also 3 at engine caps, 2 at account budgets')
    ).toBeTruthy()
  })

  it('says a failed read instead of printing none', () => {
    render(
      <CapacityTab
        data={undefined}
        vendor='all'
        sources={{
          view: { status: 'error', error: 'timeout' },
          previous: { status: 'error' },
        }}
      />,
      { wrapper }
    )
    expect(screen.getAllByText('timeout').length).toBeGreaterThan(0)
    expect(screen.queryByText('No failed requests in this range')).toBeNull()
    expect(screen.queryByText('No requests in this range')).toBeNull()
    expect(screen.getAllByText('Could not be read').length).toBeGreaterThan(0)
  })
})
