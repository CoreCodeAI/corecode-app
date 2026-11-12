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
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { joinSentences } from '../lib'
import type {
  ActivityInsights,
  CapacityInsights,
  ChannelInsights,
  ChannelRow,
  FinanceInsights,
  GrowthInsights,
  QualityInsights,
  RiskInsights,
  UpstreamChannel,
  UpstreamInsights,
} from '../types'
import {
  useCapacityVerdict,
  useGrowthVerdict,
  useQualityVerdict,
  useRiskVerdict,
} from '../verdicts'
import { useChannelsVerdict } from '../verdicts/channels'
import { useFinanceVerdict } from '../verdicts/finance'
import { useActivityVerdict } from '../verdicts/growth'
import { useUpstreamVerdict } from '../verdicts/upstream'

describe('tab verdicts', () => {
  it('reads the capacity tab: requests, peak against slots, what was turned away', () => {
    const data = {
      requests: 1200,
      peak_concurrency: 30,
      error_categories: [{ name: 'engine_concurrency', count: 4 }],
      limit_rejection_total: 0,
      pool: { configured: true, effective_slots: 60 },
    } as unknown as CapacityInsights
    const previous = { requests: 1000 } as CapacityInsights
    const { result } = renderHook(() => useCapacityVerdict(data, previous))
    // A few stray refusals warn; they do not call for accounts.
    expect(result.current).toEqual({
      tone: 'warning',
      text: '1,200 requests (up 20%). Peak concurrency 30 of 60 slots (50%). 4 turned away with the pool full.',
    })
  })

  it('reads the capacity tab’s pool peak against the slots, and the engine’s caps and budgets apart', () => {
    const data = {
      requests: 1200,
      peak_concurrency: 70,
      pool_peak: 60,
      error_categories: [
        { name: 'engine_concurrency', count: 20 },
        { name: 'engine_limit', count: 3 },
        { name: 'engine_budget', count: 2 },
      ],
      limit_rejection_total: 9,
      pool: { configured: true, effective_slots: 60 },
    } as unknown as CapacityInsights
    const { result } = renderHook(() => useCapacityVerdict(data, undefined))
    expect(result.current).toEqual({
      tone: 'danger',
      text: "1,200 requests. Pool peak 60 of 60 slots (100%). 20 turned away with the pool full. 3 refused at the engine's own caps: raise the group's limit or the key's cap. 2 refused by accounts' request rate or quota budget: wait for the window or add accounts. 9 attempts refused by per-user limits, retries included.",
    })
    const calm = {
      ...data,
      pool_peak: 30,
      error_categories: [{ name: 'engine_limit', count: 3 }],
      limit_rejection_total: 0,
    } as unknown as CapacityInsights
    // The site's 70 on every channel is past the slots; the pool's 30 is not.
    expect(
      renderHook(() => useCapacityVerdict(calm, undefined)).result.current
    ).toEqual({
      tone: 'warning',
      text: "1,200 requests. Pool peak 30 of 60 slots (50%). 3 refused at the engine's own caps: raise the group's limit or the key's cap.",
    })
  })

  it('names the capacity tab’s worst hour, the cause of its 429s, and the action', () => {
    const hour = (
      at: number,
      peak: number,
      rejections: number
    ): CapacityInsights['hourly'][number] => ({
      hour: at,
      requests: 100,
      errors: rejections,
      peak_concurrency: peak,
      engine_rejections: rejections,
      upstream_rate_limits: 0,
    })
    const base = {
      requests: 200,
      error_categories: [{ name: 'engine_concurrency', count: 4 }],
      limit_rejection_total: 0,
      pool: { configured: true, effective_slots: 60 },
    }
    const short = {
      ...base,
      peak_concurrency: 30,
      hourly: [hour(0, 30, 0), hour(3600, 12, 20)],
    } as unknown as CapacityInsights
    const eligibility = renderHook(() => useCapacityVerdict(short, undefined))
      .result.current
    expect(eligibility?.tone).toBe('warning')
    expect(eligibility?.text).toContain(
      'with the peak only 12 of 60 slots: too few accounts were schedulable (cooldowns or spent quota); check the account pool.'
    )
    const full = {
      ...base,
      peak_concurrency: 55,
      hourly: [hour(0, 20, 0), hour(3600, 55, 20)],
    } as unknown as CapacityInsights
    expect(
      renderHook(() => useCapacityVerdict(full, undefined)).result.current?.text
    ).toContain(
      'with the peak at 55 of 60 slots: the pool is too small, add accounts.'
    )
    const near = {
      ...full,
      error_categories: [],
      hourly: [hour(0, 20, 0), hour(3600, 55, 0)],
    } as unknown as CapacityInsights
    const tight = renderHook(() => useCapacityVerdict(near, undefined)).result
      .current
    expect(tight?.tone).toBe('good')
    expect(tight?.text).toMatch(
      /1 hours reached 80% of today's slots; the tightest, .+, had 5 free\. Nothing turned away\.$/
    )
  })

  it('reads the quality tab: failure rate and its move, Claude’s first token, the worst model', () => {
    const data = {
      requests: 1000,
      error_rate: 0.03,
      vendors: [
        {
          vendor: 'claude',
          requests: 600,
          error_rate: 0.001,
          ttft_p50_ms: 1400,
          ttft_p95_ms: 6800,
        },
        {
          vendor: 'codex',
          requests: 400,
          error_rate: 0.15,
          ttft_p50_ms: 5700,
          ttft_p95_ms: 17000,
        },
      ],
      models: [
        { model: 'gpt-6.1-terra', requests: 400, error_rate: 0.15 },
        { model: 'claude-opus-5-5', requests: 600, error_rate: 0.001 },
      ],
    } as unknown as QualityInsights
    const previous = { requests: 900, error_rate: 0.01 } as QualityInsights
    const { result } = renderHook(() => useQualityVerdict(data, previous))
    expect(result.current?.tone).toBe('warning')
    expect(result.current?.text).toBe(
      'Failure rate 3% (+2 points). GPT fails 15% of requests. Claude first token 1.4s at p50, 6.8s at p95. Failing most: gpt-6.1-terra at 15%.'
    )
  })

  it('reads the quality failure rate without the customers’ own bad requests', () => {
    const data = {
      requests: 1000,
      errors: 60,
      error_rate: 0.06,
      error_categories: [
        { name: 'upstream_error', count: 10 },
        { name: 'client_error', count: 50 },
      ],
      vendors: [],
      models: [],
    } as unknown as QualityInsights
    const { result } = renderHook(() => useQualityVerdict(data, undefined))
    expect(result.current?.tone).toBe('good')
    expect(result.current?.text).toMatch(/^Failure rate 1\.0?\d?%/)
    expect(result.current?.text).not.toContain('6%')
  })

  it('reads the growth tab without a previous period', () => {
    const data = {
      funnel: { registered: 50, activated: 10, paid: 5, repeat: 1 },
    } as unknown as GrowthInsights
    const { result } = renderHook(() => useGrowthVerdict(data, undefined))
    expect(result.current).toEqual({
      tone: 'warning',
      text: '50 sign-ups. 20% activated and 10% paid.',
    })
  })

  it('names the segment that moved sign-ups and does not judge a young cohort', () => {
    const segment = (name: string, registered: number) => ({
      segment: name,
      registered,
      activated: 0,
      paid: 0,
      repeat: 0,
    })
    const data = {
      funnel: { registered: 40, activated: 4, paid: 0, repeat: 0 },
      by_source: [segment('linuxdo', 30), segment('password', 10)],
      by_invite: [],
    } as unknown as GrowthInsights
    const previous = {
      funnel: { registered: 20, activated: 10, paid: 2, repeat: 0 },
      by_source: [segment('linuxdo', 5), segment('password', 15)],
      by_invite: [],
    } as unknown as GrowthInsights
    const range = { start: 0, end: 86400, days: 1, hourly: true }
    const { result } = renderHook(() => useGrowthVerdict(data, previous, range))
    expect(result.current).toEqual({
      tone: 'default',
      text: '40 sign-ups (to 2×). Driven by LinuxDO (+25). 10% have activated and 0% paid so far; accounts hours old are too young to judge.',
    })
  })

  it('does not colour the conversion of a small cohort', () => {
    const data = {
      funnel: { registered: 10, activated: 1, paid: 0, repeat: 0 },
    } as unknown as GrowthInsights
    const { result } = renderHook(() => useGrowthVerdict(data, undefined))
    expect(result.current).toEqual({
      tone: 'default',
      text: '10 sign-ups. 10% activated and 0% paid; too few sign-ups to judge.',
    })
  })

  it('judges activation over sign-ups old enough to show it, not the newest hours', () => {
    // Days 0 to 2 ended at least 6 hours before the range's end; day 3 did not.
    const day = (index: number, registered: number, activated: number) => ({
      day: index * 86400,
      registered,
      activated,
      paid: 0,
    })
    const data = {
      funnel: { registered: 100, activated: 28, paid: 0, repeat: 0 },
      daily: [day(0, 50, 14), day(1, 25, 14), day(2, 0, 0), day(3, 25, 0)],
    } as unknown as GrowthInsights
    const range = {
      start: 0,
      end: 3 * 86400 + 18 * 3600,
      days: 4,
      hourly: false,
    }
    const { result } = renderHook(() =>
      useGrowthVerdict(data, undefined, range)
    )
    expect(result.current?.tone).toBe('good')
    expect(result.current?.text).toContain(
      '37.3% of sign-ups at least 6 hours old activated and 0% paid.'
    )
  })

  it('says too few sign-ups are old enough when the whole cohort is hours old', () => {
    const data = {
      funnel: { registered: 30, activated: 0, paid: 0, repeat: 0 },
      daily: [{ day: 3 * 86400, registered: 30, activated: 0, paid: 0 }],
    } as unknown as GrowthInsights
    const range = {
      start: 0,
      end: 3 * 86400 + 18 * 3600,
      days: 4,
      hourly: false,
    }
    const { result } = renderHook(() =>
      useGrowthVerdict(data, undefined, range)
    )
    expect(result.current).toEqual({
      tone: 'default',
      text: '30 sign-ups. Too few sign-ups at least 6 hours old to judge activation or payment.',
    })
  })

  it('says a sign-up burst’s timing and leaves its cause to the operator', () => {
    const hour = (index: number, registered: number) => ({
      hour: index * 3600,
      registered,
      activated: 0,
      paid: 0,
    })
    const data = {
      funnel: { registered: 20, activated: 0, paid: 0, repeat: 0 },
      hourly: [hour(0, 5), hour(1, 5), hour(2, 5), hour(3, 5)],
    } as unknown as GrowthInsights
    const range = { start: 0, end: 4 * 3600, days: 1, hourly: true }
    const { result } = renderHook(() =>
      useGrowthVerdict(data, undefined, range)
    )
    expect(result.current?.text).toMatch(
      /25% of them signed up in the hour from .+: check the sign-up source\./
    )
    expect(result.current?.text).not.toContain('promotion')
  })

  it('names the customer that moved consumption', () => {
    const top = (user_id: number, username: string, quota_usd: number) => ({
      user_id,
      username,
      quota_usd,
      requests: 1,
      share: 0,
    })
    const data = {
      active_users: 2,
      quota_usd: 100,
      usd_exchange_rate: 8,
      top_users: [top(1, 'alice', 70), top(2, 'bob', 30)],
      top1_share: 0.7,
      top10_share: 1,
    } as unknown as ActivityInsights
    const previous = {
      active_users: 2,
      quota_usd: 60,
      top_users: [top(1, 'alice', 30), top(2, 'bob', 30)],
    } as unknown as ActivityInsights
    const { result } = renderHook(() => useActivityVerdict(data, previous))
    expect(result.current).toEqual({
      tone: 'warning',
      text: '2 active users (flat). Consumption up 66.7%, mostly alice (+$5.00). The largest customer, alice, used 70%; the top 10, 100%.',
    })
  })

  it('reads a change past doubling as a multiple', () => {
    const data = {
      requests: 115919,
      peak_concurrency: 0,
      error_categories: [],
      limit_rejection_total: 0,
      pool: { configured: false },
    } as unknown as CapacityInsights
    const previous = { requests: 31740 } as CapacityInsights
    const { result } = renderHook(() => useCapacityVerdict(data, previous))
    expect(result.current).toEqual({
      tone: 'good',
      text: '115,919 requests (to 3.7×). Nothing turned away.',
    })
  })

  it('reads a quiet failure rate as good', () => {
    const data = {
      requests: 1000,
      error_rate: 0.016,
      vendors: [],
      models: [],
    } as unknown as QualityInsights
    const { result } = renderHook(() => useQualityVerdict(data, undefined))
    expect(result.current).toEqual({ tone: 'good', text: 'Failure rate 1.6%.' })
  })

  it('names media tasks failing after submission and requests with no channel', () => {
    const data = {
      requests: 1000,
      error_rate: 0.016,
      vendors: [],
      models: [],
      tasks: {
        total: {},
        models: [
          {
            model: 'seedance-2.5-720p',
            submitted: 100,
            succeeded: 70,
            failed: 30,
            failure_rate: 0.3,
          },
        ],
      },
      refusals: { no_channel: 12, risk_gate: 0 },
    } as unknown as QualityInsights
    const { result } = renderHook(() => useQualityVerdict(data, undefined))
    expect(result.current).toEqual({
      tone: 'warning',
      text: 'Failure rate 1.6%. seedance-2.5-720p tasks fail 30% after submission. 12 requests found no channel.',
    })
  })

  it('names the model that drove the failure rate, or says the previous period is too small', () => {
    const row = (model: string, requests: number, errors: number) => ({
      model,
      vendor: 'claude',
      requests,
      errors,
      error_rate: errors / requests,
    })
    const data = {
      requests: 1000,
      errors: 30,
      error_rate: 0.03,
      vendors: [],
      models: [row('opus', 500, 25), row('sonnet', 500, 5)],
    } as unknown as QualityInsights
    const previous = {
      requests: 1000,
      errors: 10,
      error_rate: 0.01,
      vendors: [],
      models: [row('opus', 500, 5), row('sonnet', 500, 5)],
    } as unknown as QualityInsights
    const moved = renderHook(() => useQualityVerdict(data, previous))
    expect(moved.result.current?.text).toBe(
      'Failure rate 3% (+2 points). Mostly opus (+2 points). Failing most: opus at 5%.'
    )
    const small = { ...previous, requests: 40, errors: 0, error_rate: 0 }
    const few = renderHook(() => useQualityVerdict(data, small))
    expect(few.result.current?.text).toBe(
      'Failure rate 3%; too few requests before to compare. Failing most: opus at 5%.'
    )
  })

  it('explains a first-token p95 move by the vendor mix', () => {
    const figures = (requests: number, p95: number) => ({
      vendor: '',
      requests,
      errors: 0,
      error_rate: 0,
      ttft_p50_ms: 1000,
      ttft_p95_ms: p95,
    })
    const data = {
      requests: 1000,
      errors: 0,
      error_rate: 0,
      models: [],
      all_models: figures(1000, 15000),
      vendors: [
        { ...figures(500, 6200), vendor: 'claude' },
        { ...figures(500, 18500), vendor: 'codex' },
      ],
    } as unknown as QualityInsights
    const previous = {
      requests: 1000,
      errors: 0,
      error_rate: 0,
      models: [],
      all_models: figures(1000, 9000),
      vendors: [
        { ...figures(800, 6000), vendor: 'claude' },
        { ...figures(200, 18000), vendor: 'codex' },
      ],
    } as unknown as QualityInsights
    const { result } = renderHook(() => useQualityVerdict(data, previous))
    expect(result.current?.text).toBe(
      'Failure rate 0%. Claude first token 1.0s at p50, 6.2s at p95. First-token p95 went from 9.0s to 15.0s with the mix: GPT from 20% to 50% of requests, while each vendor’s own p95 held.'
    )
  })

  it('joins Chinese sentences without a space after their full stop', () => {
    expect(joinSentences('注册 524。', false, '41.6% 发过请求。')).toBe(
      '注册 524。41.6% 发过请求。'
    )
    expect(joinSentences('524 sign-ups.', undefined, 'Nothing to check.')).toBe(
      '524 sign-ups. Nothing to check.'
    )
  })

  it('lists what the risk tab wants checked, or says nothing does', () => {
    const quiet = {
      signups: 8,
      shared_ips: [],
      alias_emails: 0,
      off_whitelist: 0,
      debtors: [],
    } as unknown as RiskInsights
    expect(renderHook(() => useRiskVerdict(quiet)).result.current).toEqual({
      tone: 'good',
      text: '8 sign-ups. Nothing to check.',
    })
    // A debt within a dollar is rounding, not a debtor.
    const busy = {
      ...quiet,
      alias_emails: 2,
      debtors: [
        { user_id: 1, username: 'a', balance_usd: -5 },
        { user_id: 2, username: 'b', balance_usd: -0.4 },
      ],
    } as RiskInsights
    expect(renderHook(() => useRiskVerdict(busy)).result.current).toEqual({
      tone: 'warning',
      text: '8 sign-ups. To check: 2 alias emails, 1 accounts in debt. Act on accounts from Users, usage logs and Risk Control.',
    })
  })

  it('reads several plan buyers on one address as danger, names it first, and says when sign-ups surged', () => {
    const user = (id: number, created: number) => ({
      user_id: id,
      username: `u${id}`,
      requests: 1,
      paid: false,
      subscription: true,
      created_at: created,
      balance_usd: 0,
    })
    const data = {
      signups: 12,
      series_unit: 'hour',
      signup_series: [1, 1, 9, 1, 0].map((count, index) => ({
        at: index * 3600,
        count,
      })),
      shared_ips: [
        {
          ip: '10.0.0.9',
          requests: 2,
          subscription_buyers: 2,
          users: [user(1, 100), user(2, 200)],
        },
      ],
      alias_emails: 0,
      off_whitelist: 0,
      debtors: [],
    } as unknown as RiskInsights
    const previous = {
      ...data,
      signup_series: [1, 1, 1, 1, 1].map((count, index) => ({
        at: (index - 5) * 3600,
        count,
      })),
    } as RiskInsights
    const range = { start: 0, end: 5 * 3600, days: 1, hourly: true }
    const verdict = renderHook(() => useRiskVerdict(data, previous, range))
      .result.current
    expect(verdict?.tone).toBe('danger')
    expect(verdict?.text).toMatch(
      /^12 sign-ups\. Sign-ups surged at .+: 9, 9× the same hour of the previous period\. To check: 1 addresses shared by several accounts, an address with repeat plan buyers\. Review 10\.0\.0\.9 first: 2 plan buyers, 2 registered within 10 minutes, 2 created in this range, All paid: likely an office or a reseller\. Act on accounts from Users, usage logs and Risk Control\.$/
    )
  })
  it('never says nothing to check while an address has repeat plan buyers', () => {
    const data = {
      signups: 4,
      signup_series: [],
      shared_ips: [
        {
          ip: '1.2.3.4',
          requests: 2,
          subscription_buyers: 2,
          users: [
            {
              user_id: 1,
              username: 'u1',
              requests: 1,
              paid: false,
              subscription: true,
              created_at: 0,
              balance_usd: 0,
            },
            {
              user_id: 2,
              username: 'u2',
              requests: 1,
              paid: false,
              subscription: true,
              created_at: 0,
              balance_usd: 0,
            },
          ],
        },
      ],
      alias_emails: 0,
      off_whitelist: 0,
      debtors: [],
    } as unknown as RiskInsights
    const verdict = renderHook(() => useRiskVerdict(data)).result.current
    expect(verdict?.tone).toBe('danger')
    expect(verdict?.text).not.toContain('Nothing to check.')
    expect(verdict?.text).toContain('To check: ')
    expect(verdict?.text).toContain('an address with repeat plan buyers')
  })

  it('leaves shared exits out of the risk verdict, counts every shared address, and names gift-farming inviters', () => {
    const user = (id: number) => ({
      user_id: id,
      username: `u${id}`,
      requests: 1,
      paid: false,
      subscription: true,
      created_at: 0,
      balance_usd: 0,
    })
    const data = {
      signups: 5,
      series_unit: 'hour',
      signup_series: [],
      shared_ip_total: 1,
      shared_exits: 1,
      shared_ips: [
        {
          ip: '10.0.0.7',
          requests: 40,
          subscription_buyers: 3,
          shared_exit: true,
          users: [user(1), user(2), user(3)],
        },
      ],
      alias_emails: 0,
      off_whitelist: 0,
      debtors: [],
      unpaid_inviters: [
        { user_id: 9, username: 'boss', accounts: 4, consumption_usd: 12 },
      ],
    } as unknown as RiskInsights
    expect(renderHook(() => useRiskVerdict(data)).result.current).toEqual({
      tone: 'warning',
      text: '5 sign-ups. To check: 1 inviters with 3 or more unpaid spenders. Act on accounts from Users, usage logs and Risk Control.',
    })
  })
})

describe('channels verdict', () => {
  const channel = (
    user_id: number,
    username: string,
    overrides: Partial<ChannelRow>
  ): ChannelRow => ({
    segment: 'channel',
    channel: { user_id, username },
    tier: 'retail',
    accounts: 100,
    registered: 30,
    activated: 10,
    paid: 3,
    repeat: 1,
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
  })
  const insights = (channels: ChannelRow[]): ChannelInsights => ({
    channels,
    costs: [],
    usd_exchange_rate: 7,
  })
  const range = (days: number) => ({
    start: 0,
    end: days * 86400,
    days,
    hourly: days <= 3,
  })
  // A $100 fee is ¥700 at the rate.
  const magpie = channel(306, 'magpie', {
    fee_usd: 100,
    revenue: 500,
    new_payers: 3,
  })

  it('names the worst paid channel and its fee over 30 days, and reads a total loss as danger', () => {
    const previous = insights([{ ...magpie, revenue: 400 }])
    const { result } = renderHook(() =>
      useChannelsVerdict(insights([magpie]), previous, range(30))
    )
    expect(result.current).toEqual({
      tone: 'danger',
      text: 'Paid channels brought ¥500 (up 25%), net -¥200 after their cost. magpie loses the most (-¥200), mostly to its fee (¥700): renegotiate or drop it.',
    })
  })

  it('points at given credit when it is the largest cost of the worst channel', () => {
    const gifty = channel(7, 'gifty', {
      fee_usd: 10,
      revenue: 100,
      new_payers: 3,
      gift_consumption_usd: 300,
    })
    const data = insights([{ ...magpie, revenue: 2000 }, gifty])
    const { result } = renderHook(() =>
      useChannelsVerdict(data, undefined, range(7))
    )
    expect(result.current).toEqual({
      tone: 'warning',
      text: 'Paid channels brought ¥2,100, net ¥1,030 after their cost. gifty loses the most (-¥270), mostly to given credit its accounts spent (¥300): tighten its gifts.',
    })
  })

  it('does not judge a channel on a range under 7 days', () => {
    const { result } = renderHook(() =>
      useChannelsVerdict(insights([magpie]), undefined, range(1))
    )
    expect(result.current).toEqual({
      tone: 'default',
      text: 'Paid channels brought ¥500, net -¥200 after their cost. A range under 7 days cannot judge a channel: read 30 days or the contract to date.',
    })
  })

  it('does not renegotiate or call a channel profitable on fewer than 3 new payers', () => {
    const lossOnOnePayer = channel(306, 'magpie', {
      fee_usd: 30,
      revenue: 150,
      new_payers: 1,
    })
    const { result } = renderHook(() =>
      useChannelsVerdict(insights([lossOnOnePayer]), undefined, range(30))
    )
    expect(result.current).toEqual({
      tone: 'default',
      text: 'Paid channels brought ¥150, net -¥60 after their cost. Fewer than 3 new payers in this range: too few to judge a channel’s cost.',
    })
  })

  it('says so when no channel has a fee', () => {
    const { result } = renderHook(() =>
      useChannelsVerdict(insights([channel(1, 'free', {})]), undefined)
    )
    expect(result.current).toEqual({
      tone: 'default',
      text: 'No channel has a fee recorded.',
    })
  })

  it('warns when a fee channel is still credited commission, without changing net', () => {
    const earning = channel(306, 'magpie', {
      fee_usd: 100,
      revenue: 1000,
      new_payers: 3,
      commission_usd: 40,
      commission_accruing: 60,
    })
    const { result } = renderHook(() =>
      useChannelsVerdict(insights([earning]), undefined, range(30))
    )
    expect(result.current).toEqual({
      tone: 'warning',
      text: 'Paid channels brought ¥1,000, net ¥300 after their cost. Every paid channel covers its cost. magpie was still credited ¥60 of commission while its fee ran.',
    })
  })
})

describe('finance verdict', () => {
  const base = {
    revenue: 200,
    recognized_revenue: 150,
    orders: 10,
    methods: [
      { payment_method: 'alipay', money: 180, count: 9 },
      { payment_method: 'stripe', money: 20, count: 1 },
    ],
    vendor_models: [
      { vendor: 'claude', model: 'claude-opus', usd: 300, requests: 9 },
      { vendor: 'codex', model: 'gpt-6', usd: 50, requests: 5 },
    ],
    consumption_usd: 350,
    gift_consumption_usd: 20,
    debt_usd: 0,
  } as unknown as FinanceInsights
  const before = {
    ...base,
    revenue: 100,
    orders: 8,
    methods: [
      { payment_method: 'alipay', money: 60, count: 5 },
      { payment_method: 'stripe', money: 40, count: 3 },
    ],
    vendor_models: [
      { vendor: 'claude', model: 'claude-opus', usd: 100, requests: 3 },
      { vendor: 'codex', model: 'gpt-6', usd: 60, requests: 6 },
    ],
  } as FinanceInsights

  it('names the payment method and model that drove the change', () => {
    const { result } = renderHook(() => useFinanceVerdict(base, before))
    expect(result.current?.text).toMatch(
      /^Paid ¥200 \(to 2×, mostly .+ \+¥120\), earned ¥150\. Consumption ¥350 \(to 2\.2×\), mostly claude-opus \+¥200\.$/
    )
  })

  it('reads revenue over few orders as an amount with the counts', () => {
    const few = { ...base, orders: 3 } as FinanceInsights
    const { result } = renderHook(() => useFinanceVerdict(few, before))
    expect(result.current?.text).toMatch(
      /^Paid ¥200 \(\+¥100, 8 → 3 orders\), earned ¥150\./
    )
  })

  it('warns when gifted credit is a large share of consumption', () => {
    const gifted = { ...base, gift_consumption_usd: 140 } as FinanceInsights
    const { result } = renderHook(() => useFinanceVerdict(gifted, undefined))
    expect(result.current?.tone).toBe('warning')
    expect(result.current?.text).toBe(
      'Paid ¥200, earned ¥150. Gifted credit is 40% of customers’ consumption.'
    )
  })

  it('says the margin is before upstream bills, and warns on free accounts', () => {
    const priced = {
      ...base,
      start_time: 0,
      end_time: 30 * 86400,
      usd_exchange_rate: 7,
      vendor_revenue: [
        {
          vendor: 'claude',
          customer_usd: 300,
          share: 1,
          recognized_revenue: 150,
        },
      ],
      plan_accounts: [
        { vendor: '', plan: 'Max', tier: '', accounts: 2, eligible: 2 },
      ],
    } as FinanceInsights
    const { result } = renderHook(() => useFinanceVerdict(priced, undefined))
    expect(result.current?.tone).toBe('warning')
    expect(result.current?.text).toBe(
      'Paid ¥200, earned ¥150. Gross margin before upstream bills ¥150 (100%). 2 pool accounts have no recorded price and count as free, so the margin reads high.'
    )
    const billed = {
      ...priced,
      plan_accounts: [],
      vendor_upstream: [
        {
          vendor: 'claude',
          bill_usd: 30,
          fee_usd: 0,
          costed_revenue_usd: 300,
          uncosted_revenue_usd: 0,
          oldest_bill_at: 0,
          channels: [7],
        },
      ],
    } as FinanceInsights
    const { result: withBills } = renderHook(() =>
      useFinanceVerdict(billed, undefined)
    )
    expect(withBills.current?.tone).toBe('good')
    expect(withBills.current?.text).toBe(
      'Paid ¥200, earned ¥150. Gross margin ¥120 (80%).'
    )
  })

  it('warns when a payment method’s checkouts stop completing', () => {
    const funnel = (paid: number) => ({
      payment_method: 'alipay',
      created: 10,
      paid,
      failed: 0,
      expired: 0,
      pending: 10 - paid,
      pending_stale: 0,
      plan_orders: 0,
      paid_money: paid,
      completion_rate: paid / 10,
    })
    const now = { ...base, order_methods: [funnel(2)] } as FinanceInsights
    const prior = { ...before, order_methods: [funnel(6)] } as FinanceInsights
    const { result } = renderHook(() => useFinanceVerdict(now, prior))
    expect(result.current?.tone).toBe('warning')
    expect(result.current?.text).toMatch(
      /completed 20%, down from 60%: check the payment page\.$/
    )
  })
})

describe('upstream verdict', () => {
  const channel = (overrides: Partial<UpstreamChannel>): UpstreamChannel =>
    ({
      status: 1,
      priority: 0,
      requests: 0,
      errors: 0,
      failure_rate: 0,
      rescued: 0,
      revenue_usd: 0,
      cost_usd: 0,
      cost_source: 'none',
      latest_cost_at: 0,
      reasons: [],
      ...overrides,
    }) as UpstreamChannel
  const insights = (
    channels: UpstreamChannel[],
    extra: Partial<UpstreamInsights> = {}
  ): UpstreamInsights => ({
    channels,
    models: [],
    daily: [],
    rescues: [],
    truncated: false,
    ...extra,
  })

  it('gives an all-clear led by the change when every busy channel fails under 2%', () => {
    const data = insights([
      channel({
        id: 1,
        name: 'a',
        requests: 990,
        errors: 10,
        failure_rate: 0.01,
      }),
      // Too few attempts to count, however it fails.
      channel({ id: 2, name: 'b', requests: 5, errors: 5, failure_rate: 0.5 }),
    ])
    const previous = insights([
      channel({
        id: 1,
        name: 'a',
        requests: 980,
        errors: 20,
        failure_rate: 0.02,
      }),
    ])
    const { result } = renderHook(() => useUpstreamVerdict(data, previous))
    expect(result.current).toEqual({
      tone: 'good',
      text: 'Failure rate 1.5% (−0.5 points). All clear: every channel with at least 100 attempts fails under 2%.',
    })
  })

  it('leads with the channel customers saw fail most, its change, rescuer, incident and stale bill', () => {
    const hour = 1794211200
    const data = insights(
      [
        channel({
          id: 2,
          name: 'engine-gpt',
          requests: 136,
          errors: 120,
          failure_rate: 120 / 256,
          cost_source: 'fee',
          revenue_usd: 50,
          cost_usd: 10,
        }),
        channel({
          id: 7,
          name: 'relay',
          requests: 139,
          rescued: 70,
          cost_source: 'upstream',
          revenue_usd: 100,
          cost_usd: 11,
          latest_cost_at: hour - 7200,
        }),
      ],
      {
        rescues: [{ from: 2, to: 7, count: 70 }],
        hourly: [
          {
            hour,
            channel_id: 2,
            requests: 136,
            errors: 120,
            revenue_usd: 50,
            cost_usd: 10,
          },
          {
            hour,
            channel_id: 7,
            requests: 139,
            errors: 0,
            revenue_usd: 5,
            cost_usd: 0,
          },
        ],
      }
    )
    const previous = insights([
      channel({
        id: 2,
        name: 'engine-gpt',
        requests: 200,
        errors: 20,
        failure_rate: 20 / 220,
      }),
    ])
    const range = { start: hour, end: hour + 7200, days: 1, hourly: true }
    const { result } = renderHook(() =>
      useUpstreamVerdict(data, previous, range)
    )
    expect(result.current?.tone).toBe('danger')
    expect(result.current?.text).toMatch(
      /^engine-gpt fails 46\.9% of its attempts, up 37\.8 points on the previous period\. 50 of its failed attempts were not served by another channel\. 70 requests that failed on engine-gpt were served by relay\. engine-gpt failed 46\.9% of 256 attempts from .+ to .+\. The upstream bill of relay was last read .+; \$5\.00 of revenue since has no cost yet, so the margin is overstated\.$/
    )
  })

  it('says when no channel has enough attempts to judge', () => {
    const data = insights([
      channel({
        id: 1,
        name: 'a',
        requests: 10,
        errors: 10,
        failure_rate: 0.5,
      }),
    ])
    expect(
      renderHook(() => useUpstreamVerdict(data, undefined)).result.current
    ).toEqual({
      tone: 'default',
      text: 'No channel served enough requests to compare.',
    })
  })

  it('names a channel disabled all range, failing tasks and a bill read from some keys', () => {
    const data = insights([
      channel({
        id: 1,
        name: 'a',
        requests: 990,
        errors: 10,
        failure_rate: 0.01,
        cost_source: 'upstream',
        revenue_usd: 100,
        cost_usd: 40,
        key_count: 8,
        tasks: {
          channel_id: 1,
          submitted: 40,
          succeeded: 30,
          failed: 10,
          timed_out: 0,
          running: 0,
          stalled: 0,
          failure_rate: 0.25,
          finish_p50_s: 60,
          finish_p95_s: 120,
          reasons: [],
        },
      }),
      channel({
        id: 3,
        name: 'media',
        status: 3,
        status_reason: 'quota exhausted',
      }),
    ])
    const { result } = renderHook(() => useUpstreamVerdict(data, undefined))
    expect(result.current).toEqual({
      tone: 'danger',
      text: 'Failure rate 1%. All clear: every channel with at least 100 attempts fails under 2%. a failed 25% of its 40 finished tasks. media was disabled automatically and served nothing in this range. Gross margin on channels with a known cost: 60%, overstated: the bill of a is read from some keys only.',
    })
  })
})
