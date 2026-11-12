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

import {
  busiestHour,
  claudeCoverage,
  customerMoves,
  dayInProgress,
  hourSpan,
  lastFullDay,
  perActiveUser,
  segmentChanges,
  signupBurst,
  stickiness,
  viewState,
} from '../../growth-analysis'
import type { ActivityInsights, GrowthHour, GrowthInsights } from '../../types'
import { GrowthTab } from '../growth-tab'

const H = 3600
const D = 86400
const T0 = 1761408000

const user = (user_id: number, quota_usd: number) => ({
  user_id,
  username: `u${user_id}`,
  quota_usd,
  requests: 1,
  share: 0,
})

function hours(values: number[]): GrowthHour[] {
  return values.map((registered, index) => ({
    hour: T0 + index * H,
    registered,
    activated: 0,
    paid: 0,
  }))
}

describe('growth analysis', () => {
  it('finds an hour holding a quarter of enough sign-ups', () => {
    const steady = Array.from({ length: 23 }, () => 1)
    expect(signupBurst(hours([...steady, 10]))).toEqual({
      hour: T0 + 23 * H,
      registered: 10,
      share: 10 / 33,
    })
    // 19 sign-ups are too few to call a burst, however bunched.
    expect(signupBurst(hours([1, 18]))).toBeNull()
    expect(signupBurst(hours(Array.from({ length: 24 }, () => 2)))).toBeNull()
  })

  it('compares each segment with the same segment before', () => {
    expect(
      segmentChanges(
        [
          {
            segment: 'linuxdo',
            registered: 30,
            activated: 0,
            paid: 0,
            repeat: 0,
          },
          {
            segment: 'password',
            registered: 10,
            activated: 0,
            paid: 0,
            repeat: 0,
          },
        ],
        [
          {
            segment: 'linuxdo',
            registered: 5,
            activated: 0,
            paid: 0,
            repeat: 0,
          },
          {
            segment: 'github',
            registered: 2,
            activated: 0,
            paid: 0,
            repeat: 0,
          },
          {
            segment: 'password',
            registered: 10,
            activated: 0,
            paid: 0,
            repeat: 0,
          },
        ]
      )
    ).toEqual([
      { key: 'linuxdo', current: 30, previous: 5, change: 25 },
      { key: 'github', current: 0, previous: 2, change: -2 },
    ])
  })

  it('marks customers new to the list and those that left it', () => {
    const moves = customerMoves(
      [user(1, 50), user(2, 10)],
      [user(1, 20), user(3, 30)]
    )
    expect(
      moves.map((move) => [move.user_id, move.change, move.entered, move.left])
    ).toEqual([
      [1, 30, false, false],
      [3, -30, false, true],
      [2, 10, true, false],
    ])
  })

  it('counts a customer missing from a full list at its smallest figure', () => {
    const full = Array.from({ length: 20 }, (_, index) =>
      user(index + 1, 5 + index)
    )
    const move = customerMoves([user(99, 40)], full).find(
      (row) => row.user_id === 99
    )
    expect(move).toMatchObject({ current: 40, previous: 5, change: 35 })
  })

  it('reads the last calendar day wholly inside the range', () => {
    const daily = [0, 1, 2].map((offset) => ({
      day: T0 + offset * D,
      dau: offset + 1,
      wau: 10,
      requests: 0,
      quota_usd: 0,
    }))
    expect(
      lastFullDay(daily, { start: T0 + H, end: T0 + 2 * D + 2 * H })?.day
    ).toBe(T0 + D)
    expect(
      lastFullDay(daily.slice(0, 2), { start: T0 + H, end: T0 + D + H })
    ).toBeUndefined()
    expect(lastFullDay(daily)?.day).toBe(T0 + 2 * D)
    expect(stickiness(3, 10)).toBe(0.3)
    expect(stickiness(3, 0)).toBeNull()
  })

  it('picks the busiest closed hour and lines hours up with the previous period', () => {
    const rows = [
      { hour: T0, value: 4 },
      { hour: T0 + H, value: 9 },
      { hour: T0 + 2 * H, value: 20 },
    ]
    // The last hour is still filling and is left out.
    expect(busiestHour(rows, T0 + 2 * H + 600, (row) => row.value)?.hour).toBe(
      T0 + H
    )
    expect(hourSpan({ start: T0, end: T0 + D + 120 })).toBe(D)
    expect(
      perActiveUser({ quota_usd: 30, active_users: 3 } as ActivityInsights)
    ).toBe(10)
    expect(
      perActiveUser({ quota_usd: 30, active_users: 0 } as ActivityInsights)
    ).toBeUndefined()
  })
})

function growth(overrides: Partial<GrowthInsights> = {}): GrowthInsights {
  return {
    funnel: {
      segment: 'all',
      registered: 40,
      activated: 4,
      paid: 0,
      repeat: 0,
    },
    by_source: [
      { segment: 'linuxdo', registered: 30, activated: 3, paid: 0, repeat: 0 },
      { segment: 'password', registered: 10, activated: 1, paid: 0, repeat: 0 },
    ],
    by_invite: [],
    daily: [],
    subscription_buyers: 0,
    subscription_to_topup: 0,
    ...overrides,
  }
}

describe('growth tab', () => {
  const range = { start: T0, end: T0 + 14 * H - 600, days: 1, hourly: true }
  const previous = growth({
    funnel: {
      segment: 'all',
      registered: 20,
      activated: 10,
      paid: 2,
      repeat: 0,
    },
    by_source: [
      { segment: 'linuxdo', registered: 5, activated: 2, paid: 0, repeat: 0 },
      { segment: 'password', registered: 15, activated: 8, paid: 2, repeat: 0 },
    ],
  })

  it('reads a short range by the hour and does not judge a young cohort', () => {
    const data = growth({
      hourly: hours([...Array.from({ length: 13 }, () => 2), 14]),
    })
    render(<GrowthTab data={data} previous={previous} range={range} />)

    const bars = screen
      .getByRole('list', { name: 'Sign-ups by hour' })
      .querySelectorAll('[tabindex="0"]')
    expect(bars).toHaveLength(14)
    // 10% activated, but accounts hours old are not coloured.
    expect(screen.getByText('10% so far')).not.toHaveClass('text-amber-600')
    expect(
      screen.getByText(/have paid so far; they signed up hours ago\.$/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^14 sign-ups, 35% of the range, came in the hour from/)
    ).toBeInTheDocument()
    expect(
      screen.getByText('LinuxDO explain most of the change.')
    ).toBeInTheDocument()
    // In the drivers and in the segment table's change column.
    expect(screen.getAllByText('+25')).toHaveLength(2)
    expect(screen.getByText(/5 → 30$/)).toBeInTheDocument()
  })

  it('keeps the daily chart when the server sends no hours', () => {
    render(<GrowthTab data={growth()} range={range} />)
    expect(
      screen.getByRole('list', { name: 'Sign-ups by day' })
    ).toBeInTheDocument()
    expect(screen.queryByText('What moved sign-ups')).not.toBeInTheDocument()
  })
})

describe('missing data and partial days', () => {
  it('tells loaded, loading and failed apart', () => {
    expect(viewState({}, { status: 'error' })).toBe('ready')
    expect(viewState(undefined, { status: 'error' })).toBe('error')
    expect(viewState(undefined, { status: 'pending' })).toBe('loading')
    expect(viewState(undefined, undefined)).toBe('loading')
  })

  it('marks a day that had not ended by the range end', () => {
    expect(dayInProgress(T0, T0 + D)).toBe(false)
    expect(dayInProgress(T0, T0 + D - 1)).toBe(true)
  })

  it('sets Claude’s charge on the engine’s days against its official cost', () => {
    const base = {
      active_users: 1,
      quota_usd: 50,
      requests: 3,
      retention: [],
      top_users: [],
      top1_share: 0,
      top3_share: 0,
      top10_share: 0,
      engine_cost: {
        configured: true,
        cost_usd: 10,
        requests: 2,
        daily: [{ day: T0 + D, cost_usd: 10, requests: 2 }],
      },
      daily: [
        {
          day: T0,
          dau: 1,
          wau: 1,
          requests: 1,
          quota_usd: 20,
          claude_quota_usd: 6,
        },
        {
          day: T0 + D,
          dau: 1,
          wau: 1,
          requests: 2,
          quota_usd: 30,
          claude_quota_usd: 16,
        },
      ],
    } satisfies ActivityInsights
    expect(claudeCoverage({ ...base, claude_quota_usd: 22 })).toEqual({
      charged: 16,
      official: 10,
      claudeOnly: true,
    })
    // An older server sends no Claude charge: every model's stands in.
    expect(claudeCoverage(base)).toEqual({
      charged: 50,
      official: 10,
      claudeOnly: false,
    })
    expect(
      claudeCoverage({
        ...base,
        engine_cost: { ...base.engine_cost, error: 'down' },
      })
    ).toBeNull()
  })

  it('says the growth view could not be read instead of printing zeros', () => {
    render(
      <GrowthTab
        data={undefined}
        sources={{ view: { status: 'error' }, previous: { status: 'error' } }}
      />
    )
    expect(screen.getAllByText('Could not be read').length).toBeGreaterThan(0)
    expect(
      screen.queryByText('No sign-ups in this range')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
