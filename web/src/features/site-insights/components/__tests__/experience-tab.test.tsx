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
import { render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { InsightsRangeInfo } from '../../lib'
import type {
  ExperienceInsights,
  ExperiencePoint,
  ExperienceUser,
} from '../../types'
import { useExperienceVerdict } from '../../verdicts'
import {
  beforeWasteLogs,
  cacheUnreadBefore,
  replyComparable,
  stayedShare,
  unheard,
  unreadFrom,
  wasteComparable,
  wasteShare,
} from '../experience-analysis'
import { ExperienceTab } from '../experience-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: {
    to?: string
    params?: { section?: string }
    search?: Record<string, string> | ((prev: object) => object)
    hash?: string
    children: ReactNode
  }) => {
    let href = (props.to ?? '').replace('$section', props.params?.section ?? '')
    if (props.search && typeof props.search === 'object') {
      href += `?${new URLSearchParams(props.search).toString()}`
    }
    return <a href={href}>{props.children}</a>
  },
}))

const DAY = 86400
const START = 1_760_000_000 - (1_760_000_000 % DAY)
const range: InsightsRangeInfo = {
  start: START,
  end: START + 5 * DAY,
  days: 5,
  hourly: false,
}

function point(day: number, patch: Partial<ExperiencePoint> = {}) {
  return {
    at: START + day * DAY,
    refusal_usd: 0,
    failed_usd: 0,
    gate_usd: 0,
    cancel_usd: 0,
    cache_paid_usd: 0,
    cache_saved_usd: 0,
    refund_usd: 0,
    refusals: 0,
    bug: 0,
    suggestion: 0,
    billing: 0,
    other_feedback: 0,
    ...patch,
  } satisfies ExperiencePoint
}

function loser(
  id: number,
  patch: Partial<ExperienceUser> = {}
): ExperienceUser {
  return {
    user_id: id,
    username: `user${id}`,
    refusal_usd: 0,
    failed_usd: 0,
    gate_usd: 0,
    total_usd: 0,
    requests: 1,
    filed_feedback: false,
    last_request_at: START,
    silent: false,
    ...patch,
  }
}

function insights(patch: Partial<ExperienceInsights> = {}): ExperienceInsights {
  return {
    series_unit: 'day',
    series: [0, 1, 2, 3, 4].map((day) =>
      point(day, day === 2 ? { refusal_usd: 12, refusals: 3, bug: 1 } : {})
    ),
    waste: {
      log_start: START,
      cache_start: START,
      cache_judged_until: START + 5 * DAY - 3600,
      consumed_usd: 1000,
      total_usd: 20,
      truncated: false,
      stale_hours: 0,
      kinds: [
        { kind: 'refusal', requests: 3, users: 2, usd: 12 },
        { kind: 'failed_billed', requests: 2, users: 1, usd: 5 },
        { kind: 'gate_wallet', requests: 1, users: 1, usd: 3 },
      ],
      failed_causes: [
        { name: 'reset', requests: 1, users: 1, usd: 3 },
        { name: 'http2', requests: 1, users: 1, usd: 2 },
      ],
      failed_no_output: 1,
      failed_no_output_usd: 3,
      cancelled: { kind: 'client_cancel', requests: 7, users: 3, usd: 9 },
      cancelled_no_output: 2,
      cache: {
        paid_usd: 4,
        writes: 40,
        unread_usd: 1,
        unread_writes: 10,
        saved_usd: 10,
        reads: 25,
        net_usd: 6,
        users: 3,
        unpriced: 0,
      },
      refusals: [
        {
          user_id: 4673,
          username: 'zed',
          at: START + 2 * DAY,
          model_name: 'claude-fable-5-1',
          category: 'cyber',
          usd: 8,
          request_id: 'req-abc',
        },
      ],
      refusal_models: [
        { name: 'claude-fable-5-1', requests: 3, users: 2, usd: 12 },
      ],
      refusal_reasons: [{ name: 'cyber', requests: 3, users: 2, usd: 12 }],
      refunds: { kind: 'refund', requests: 2, users: 1, usd: 6 },
      refund_models: [{ name: 'sora', requests: 2, users: 1, usd: 6 }],
      top: [
        loser(1, { refusal_usd: 10, total_usd: 10, silent: true }),
        loser(2, {
          failed_usd: 5,
          total_usd: 5,
          filed_feedback: true,
        }),
      ],
      silent: [loser(1, { refusal_usd: 10, total_usd: 10, silent: true })],
      reported_top: 1,
      checked_top: 2,
    },
    feedback: {
      total: 4,
      statuses: [
        { name: 'pending', count: 3 },
        { name: 'resolved', count: 1 },
      ],
      categories: [
        { name: 'billing', count: 3 },
        { name: 'bug', count: 1 },
      ],
      replied: 2,
      first_reply_p50: 3600,
      first_reply_p90: 7200,
      open: 3,
      unanswered_24h: 2,
      rewarded: 1,
      reward_usd: 5,
      senders: 3,
      judged: 2,
      active: 1,
      pending: 1,
      before_usd: 13,
      after_usd: 3,
      waiting: [
        {
          id: 7,
          user_id: 3,
          username: 'carol',
          category: 'billing',
          title: 'Charged twice',
          created_time: START + DAY,
        },
      ],
      lapsed: [
        {
          user_id: 3,
          username: 'carol',
          category: 'billing',
          at: START + DAY,
          before_usd: 6,
        },
      ],
    },
    ...patch,
  }
}

const loaded = {
  view: { status: 'success' as const },
  previous: { status: 'success' as const },
}

describe('experience analysis', () => {
  it('reads the share of consumption, and nothing when nothing was consumed', () => {
    const data = insights()
    expect(wasteShare(data.waste)).toBeCloseTo(0.02)
    expect(wasteShare({ ...data.waste, consumed_usd: 0 })).toBeNull()
  })

  it('says where the logs begin only when the range reached further back', () => {
    const data = insights()
    expect(unreadFrom(data.waste, range)).toBeNull()
    expect(
      unreadFrom({ ...data.waste, log_start: START + 2 * DAY }, range)
    ).toBe(START + 2 * DAY)
    expect(unreadFrom(data.waste, undefined)).toBeNull()
  })

  it('marks the cache estimate when it reads less than the other kinds', () => {
    const data = insights()
    expect(cacheUnreadBefore(data.waste)).toBeNull()
    expect(
      cacheUnreadBefore({ ...data.waste, cache_start: START + 2 * DAY })
    ).toBe(START + 2 * DAY)
  })

  it('treats a day wholly before the logs as missing, not zero', () => {
    const { waste } = insights({
      waste: { ...insights().waste, log_start: START + 2 * DAY },
    })
    expect(beforeWasteLogs(START, DAY, waste)).toBe(true)
    expect(beforeWasteLogs(START + DAY, DAY, waste)).toBe(true)
    expect(beforeWasteLogs(START + 2 * DAY, DAY, waste)).toBe(false)
  })

  it('compares two periods only when both were read in full', () => {
    const data = insights()
    const before = insights({
      waste: { ...data.waste, log_start: range.start - 5 * DAY },
    })
    expect(wasteComparable(data, before, range)).toBe(true)
    expect(wasteComparable(data, undefined, range)).toBe(false)
    const partial = insights({
      waste: { ...data.waste, log_start: range.start - 2 * DAY },
    })
    expect(wasteComparable(data, partial, range)).toBe(false)
    const clipped = insights({
      waste: { ...data.waste, log_start: range.start + 2 * DAY },
    })
    expect(wasteComparable(clipped, before, range)).toBe(false)
  })

  it('compares reply times only when both periods have replies', () => {
    const { feedback } = insights()
    expect(replyComparable(feedback, feedback)).toBe(true)
    expect(replyComparable(feedback, { ...feedback, replied: 0 })).toBe(false)
    expect(replyComparable({ ...feedback, replied: 0 }, feedback)).toBe(false)
    expect(replyComparable(feedback, undefined)).toBe(false)
  })

  it('counts the big losers who never wrote, and the share that stayed', () => {
    const data = insights()
    expect(unheard(data.waste)).toBe(1)
    expect(stayedShare(data.feedback)).toBe(0.5)
    expect(stayedShare({ ...data.feedback, judged: 0 })).toBeNull()
  })
})

describe('experience verdict', () => {
  const verdictOf = (data: ExperienceInsights | undefined) =>
    renderHook(() => useExperienceVerdict(data, range)).result.current

  it('has nothing to say without data', () => {
    expect(verdictOf(undefined)).toBeUndefined()
  })

  it('names the money, its biggest kind and the reports waiting', () => {
    const verdict = verdictOf(insights())
    expect(verdict?.tone).toBe('warning')
    expect(verdict?.points[0]).toMatch(/paid \$20\.00 for nothing, 2% of what/)
    expect(verdict?.text).toContain('Most of it was “Refused but charged”')
    expect(verdict?.text).toContain(
      '1 of the 2 customers who lost most never filed'
    )
    expect(verdict?.text).toContain('2 reports have waited more than a day')
    expect(verdict?.text).toContain(
      'Customers hung up on 7 charged requests ($9.00); that is their choice, not waste.'
    )
    expect(verdict?.text).toContain(
      'The 1h cache saved customers $6.00 net: its reads saved $10.00, its writes cost $4.00 more.'
    )
    expect(verdict?.chips?.map((chip) => chip.label)).toEqual([
      'Wasted',
      'Refusals charged',
      'Reports',
      'Unanswered over 24 hours',
    ])
  })

  it('says when the 1h cache cost customers more than it saved', () => {
    const data = insights()
    const verdict = verdictOf({
      ...data,
      waste: {
        ...data.waste,
        cache: { ...data.waste.cache, saved_usd: 1, net_usd: -3 },
      },
    })
    expect(verdict?.text).toContain(
      'The 1h cache cost customers $3.00 net: its writes cost $4.00 more, its reads saved $1.00.'
    )
  })

  it('turns red from 5% of consumption lost or five reports unanswered', () => {
    const data = insights()
    expect(
      verdictOf({ ...data, waste: { ...data.waste, total_usd: 60 } })?.tone
    ).toBe('danger')
    expect(
      verdictOf({
        ...data,
        feedback: { ...data.feedback, unanswered_24h: 5 },
      })?.tone
    ).toBe('danger')
  })

  it('is good when nothing was wasted and nobody waits', () => {
    const data = insights()
    const verdict = verdictOf({
      ...data,
      waste: { ...data.waste, total_usd: 0, kinds: [] },
      feedback: { ...data.feedback, unanswered_24h: 0, total: 0, replied: 0 },
    })
    expect(verdict?.tone).toBe('good')
    expect(verdict?.points[0]).toBe('No wasted money found in this range.')
    expect(verdict?.text).toContain('No reports were filed in this range.')
    expect(verdict?.text).not.toContain('at the median')
  })

  it('says the logs reach back only so far when the range is longer', () => {
    const data = insights()
    const verdict = verdictOf({
      ...data,
      waste: { ...data.waste, log_start: START + 2 * DAY },
    })
    expect(verdict?.text).toContain('Waste figures cover only from')
  })
})

describe('experience tab', () => {
  it('draws the cards, the chart and the lists from the data', () => {
    render(<ExperienceTab data={insights()} range={range} sources={loaded} />)
    for (const label of [
      'Money wasted',
      'Refusals charged',
      'Refunded',
      'Reports',
      'First reply, median',
      'Open reports',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('$20.00').length).toBeGreaterThan(0)
    expect(
      screen.getByText('2% of what customers consumed')
    ).toBeInTheDocument()
    expect(screen.getAllByText('1 h').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('list', { name: 'Money wasted over time' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Reports over time' })
    ).toBeInTheDocument()

    const losers = screen
      .getByText('Customers who lost the most')
      .closest('[data-slot=card]') as HTMLElement
    expect(within(losers).getAllByText('user1').length).toBeGreaterThan(0)
    expect(within(losers).getAllByText('Silent').length).toBeGreaterThan(0)
    expect(
      within(losers).getAllByText('Filed a report').length
    ).toBeGreaterThan(0)
    expect(
      screen.getByText('1 of the 2 biggest losers filed a report.')
    ).toBeInTheDocument()

    const silent = screen
      .getByText('Lost money, never wrote, went silent')
      .closest('[data-slot=card]') as HTMLElement
    expect(within(silent).getAllByText('user1').length).toBeGreaterThan(0)
    expect(within(silent).queryByText('user2')).toBeNull()

    const causes = screen
      .getByText('Why streams failed')
      .closest('[data-slot=card]') as HTMLElement
    expect(
      within(causes).getByText('Upstream reset the connection')
    ).toBeInTheDocument()
    expect(
      within(causes).getByText(
        /1 failed requests returned no output at all \(\$3\.00\)\. Customers hung up on 7 more/
      )
    ).toBeInTheDocument()
    const cache = screen
      .getByText('One-hour cache: cost against saving')
      .closest('[data-slot=card]') as HTMLElement
    expect(
      within(cache).getByText('Net for customers: +$6.00 over 3 customers.')
    ).toBeInTheDocument()
    expect(within(cache).getByText('25 reads')).toBeInTheDocument()

    expect(screen.getByText('Charged twice')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Open feedback review' })
    ).toHaveAttribute('href', '/feedback-admin?status=pending')
    expect(screen.getByText('Did senders stay?')).toBeInTheDocument()
    expect(
      screen.getByText(/1 of 2 senders sent a request in the 7 days after/)
    ).toBeInTheDocument()
  })

  it('lists the refused requests folded until asked', async () => {
    const user = userEvent.setup()
    render(<ExperienceTab data={insights()} range={range} sources={loaded} />)
    const toggle = screen.getByRole('button', {
      name: 'Refused requests that were charged (3)',
    })
    await user.click(toggle)
    expect(await screen.findByText('req-abc')).toBeInTheDocument()
    expect(screen.getAllByText('zed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('#4673').length).toBeGreaterThan(0)
  })

  it('says the range was read only in part, and what is a lower bound', () => {
    const data = insights()
    render(
      <ExperienceTab
        data={{
          ...data,
          waste: {
            ...data.waste,
            log_start: START + 2 * DAY,
            cache_start: START + 4 * DAY,
            truncated: true,
            stale_hours: 5,
            cache: { ...data.waste.cache, unpriced: 2 },
          },
        }}
        range={range}
        sources={loaded}
      />
    )
    expect(
      screen.getByText(
        /Waste is stored by the hour and the stored hours begin at/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/The one-hour cache reads only from/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /more logs than one read takes, so waste is a lower bound/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/2 requests lacked the prices to be valued/)
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/5 hours are still stored the old way/).length
    ).toBeGreaterThan(0)
  })

  it('names empty lists, not zeros, when the range had nothing', () => {
    const data = insights()
    render(
      <ExperienceTab
        data={{
          ...data,
          waste: {
            ...data.waste,
            total_usd: 0,
            top: [],
            silent: [],
            refunds: { kind: 'refund', requests: 0, users: 0, usd: 0 },
            refund_models: [],
            reported_top: 0,
            checked_top: 0,
          },
          feedback: {
            ...data.feedback,
            total: 0,
            replied: 0,
            statuses: [],
            categories: [],
            waiting: [],
            lapsed: [],
            judged: 0,
            unanswered_24h: 0,
          },
        }}
        range={range}
        sources={loaded}
      />
    )
    expect(
      screen.getByText('No customer lost money in this range')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Every big loser either wrote in or is still sending')
    ).toBeInTheDocument()
    expect(screen.getByText('No refunds in this range')).toBeInTheDocument()
    expect(screen.getAllByText('No reports in this range')).toHaveLength(2)
    expect(
      screen.getByText('No report is waiting more than a day')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Every follow-up sender kept sending')
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(
        'No sender of this range has been followed for a full week yet.'
      ).length
    ).toBeGreaterThan(0)
  })

  it('shows a dash on every card and no list rows when the read failed', () => {
    render(
      <ExperienceTab
        data={undefined}
        range={range}
        sources={{
          view: { status: 'error', error: 'boom' },
          previous: { status: 'pending' },
        }}
      />
    )
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(6)
    expect(screen.queryByText('$0.00')).toBeNull()
    expect(screen.getAllByText('Could not be read').length).toBeGreaterThan(2)
    expect(
      screen.queryByText('No customer lost money in this range')
    ).toBeNull()
    expect(screen.queryByText('No refunds in this range')).toBeNull()
  })

  it('holds the places of its cards while loading', () => {
    render(
      <ExperienceTab
        data={undefined}
        range={range}
        sources={{
          view: { status: 'pending' },
          previous: { status: 'pending' },
        }}
      />
    )
    expect(screen.queryByText('Could not be read')).toBeNull()
    expect(screen.queryByText('$0.00')).toBeNull()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('reads an hourly range by the hour', () => {
    const start = START
    const hourly = insights({
      series_unit: 'hour',
      series: Array.from({ length: 24 }, (_, hour) => ({
        ...point(0),
        at: start + hour * 3600,
        refusal_usd: hour === 5 ? 3 : 0,
      })),
    })
    render(
      <ExperienceTab
        data={hourly}
        range={{ start, end: start + DAY, days: 1, hourly: true }}
        sources={loaded}
      />
    )
    expect(
      screen.getByRole('list', { name: 'Money wasted over time' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Quota dollars by kind, per hour.')
    ).toBeInTheDocument()
  })
})
