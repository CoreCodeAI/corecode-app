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
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RiskInsights } from '../../types'
import {
  clusterRisk,
  exitsOf,
  giftOutcomes,
  grantedShare,
  hasRepeatBuyers,
  isHandFunded,
  largestBurst,
  materialDebtors,
  neverUsed,
  neverUsedComparable,
  rankClusters,
  riskSurges,
  sharedCounts,
  sharedExitSource,
  signalDelta,
  signupSurges,
  splitExits,
  suspectInviters,
  unpaidSpend,
  usesGiftPart,
  withRisk,
  type RiskCluster,
} from '../risk-analysis'
import { RiskTab } from '../risk-tab'

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
    if (props.hash) href += `#${props.hash}`
    return <a href={href}>{props.children}</a>
  },
}))

const HOUR = 3600

function member(
  id: number,
  overrides: Partial<RiskCluster['users'][number]> = {}
): RiskCluster['users'][number] {
  return {
    user_id: id,
    username: `u${id}`,
    requests: 0,
    paid: false,
    subscription: false,
    created_at: 0,
    balance_usd: 0,
    ...overrides,
  }
}

// Three unpaid, empty accounts created minutes apart inside the range.
const farm: RiskCluster = {
  ip: '10.0.0.1',
  requests: 5,
  subscription_buyers: 0,
  users: [
    member(11, { created_at: 1000 }),
    member(12, { created_at: 1100 }),
    member(13, { created_at: 1500 }),
  ],
}

// Four old accounts, all paying: an office.
const office: RiskCluster = {
  ip: '10.0.0.2',
  requests: 900,
  subscription_buyers: 0,
  users: [21, 22, 23, 24].map((id, index) =>
    member(id, { created_at: 10 + index * 5000, paid: true, balance_usd: 40 })
  ),
}

describe('risk analysis', () => {
  it('finds the most registrations within ten minutes', () => {
    expect(largestBurst([2000, 0, 300, 590])).toBe(3)
    expect(largestBurst([0, 601])).toBe(1)
    expect(largestBurst([])).toBe(0)
  })

  it('scores a fresh burst of empty accounts above a paying office', () => {
    expect(clusterRisk(farm, 1000)).toEqual({
      fresh: 3,
      burst: 3,
      buyers: 0,
      limited: false,
      empty: 3,
      allPaid: false,
      score: 15,
    })
    // No member in the range or in a burst, nothing unpaid: 0, quartered.
    expect(clusterRisk(office, 100000)).toEqual({
      fresh: 0,
      burst: 1,
      buyers: 0,
      limited: false,
      empty: 0,
      allPaid: true,
      score: 0,
    })
    const buyers = { ...office, subscription_buyers: 2 }
    expect(clusterRisk(buyers, 100000).score).toBe(1.5)
    expect(
      rankClusters([office, farm], 1000).map((cluster) => cluster.ip)
    ).toEqual(['10.0.0.1', '10.0.0.2'])
  })

  it('finds the same-hour baseline when the range starts partway through an hour', () => {
    // The range starts on the hour a day back from now, 10:00, and now is 10:10:
    // the span is whole days, so each hour finds the same hour of the day before.
    const day = 86400
    const start = day + 10 * HOUR
    const end = 2 * day + 10 * HOUR + 600
    const range = { start, end, days: 1, hourly: true }
    const series = Array.from({ length: 24 }, (_, index) => ({
      at: start + index * HOUR,
      count: index === 5 ? 20 : 1,
    }))
    const previous = Array.from({ length: 24 }, (_, index) => ({
      at: start - day + index * HOUR,
      count: 1,
    }))
    const data = { series_unit: 'hour', signup_series: series } as RiskInsights
    const prior = {
      series_unit: 'hour',
      signup_series: previous,
    } as RiskInsights
    expect(riskSurges(data, prior, range)).toEqual([
      {
        index: 5,
        at: start + 5 * HOUR,
        count: 20,
        baseline: 1,
        basis: 'same-hour',
      },
    ])
  })

  it('flags an hour against the same hour of the previous period, leaving the open hour out', () => {
    const span = 86400
    const series = [1, 2, 12, 1, 30].map((count, index) => ({
      at: span + index * HOUR,
      count,
    }))
    const previous = [1, 1, 2, 1, 1].map((count, index) => ({
      at: index * HOUR,
      count,
    }))
    const end = span + 4 * HOUR + 100
    expect(signupSurges(series, previous, { unit: HOUR, end, span })).toEqual([
      {
        index: 2,
        at: span + 2 * HOUR,
        count: 12,
        baseline: 2,
        basis: 'same-hour',
      },
    ])
    // With none the hour before, the range's median hour (1) is the baseline.
    const quiet = previous.map((point) => ({ ...point, count: 0 }))
    expect(signupSurges(series, quiet, { unit: HOUR, end, span })).toEqual([
      { index: 2, at: span + 2 * HOUR, count: 12, baseline: 1, basis: 'range' },
    ])
    // Under the floor of 5 nothing is a surge.
    const small = series.map((point) => ({ ...point, count: point.count % 5 }))
    expect(signupSurges(small, previous, { unit: HOUR, end, span })).toEqual([])
  })

  it('reads a day against the previous period’s median day', () => {
    const series = [4, 20, 5].map((count, index) => ({
      at: index * 86400,
      count,
    }))
    const previous = [4, 6, 5].map((count, index) => ({ at: index, count }))
    expect(
      signupSurges(series, previous, {
        unit: 86400,
        end: Number.POSITIVE_INFINITY,
      })
    ).toEqual([
      { index: 1, at: 86400, count: 20, baseline: 5, basis: 'previous' },
    ])
  })

  it('compares never-used shares only over mature or long, large cohorts', () => {
    const base = { signups: 40, zero_use_accounts: 30 } as RiskInsights
    const mature = { ...base, signups_mature: 25, zero_use_mature: 10 }
    expect(neverUsed(base)).toEqual({ zero: 30, signups: 40, mature: false })
    expect(neverUsed(mature)).toEqual({ zero: 10, signups: 25, mature: true })
    const old = neverUsed(base)
    expect(neverUsedComparable(old, old, true)).toBe(false)
    expect(neverUsedComparable(old, old, false)).toBe(true)
    expect(
      neverUsedComparable(neverUsed(mature), neverUsed(mature), true)
    ).toBe(true)
    const few = { zero: 1, signups: 19, mature: true }
    expect(neverUsedComparable(few, few, false)).toBe(false)
    expect(neverUsedComparable(old, undefined, false)).toBe(false)
  })

  it('hides a count’s change while both periods are under 3, and small debts', () => {
    expect(signalDelta(2, 1)).toBeUndefined()
    expect(signalDelta(3, 1)).toEqual({
      current: 3,
      previous: 1,
      better: 'down',
    })
    expect(signalDelta(1, undefined)).toBeUndefined()
    const debtors = [
      { user_id: 1, username: 'a', balance_usd: -0.5 },
      { user_id: 2, username: 'b', balance_usd: -2 },
      { user_id: 3, username: 'c', balance_usd: -9 },
    ]
    expect(materialDebtors(debtors).map((user) => user.user_id)).toEqual([3, 2])
  })

  it('sets shared exits apart and counts addresses in all against those listed', () => {
    const exit = { ...office, ip: '10.0.0.3', shared_exit: true }
    const buyers = { ...farm, shared_exit: false, subscription_buyers: 2 }
    const exitBuyers = { ...exit, subscription_buyers: 4 }
    expect(splitExits([farm, exit]).exits.map((c) => c.ip)).toEqual([
      '10.0.0.3',
    ])
    // An old server: the list is all there is.
    expect(sharedCounts({}, [farm, office, exit])).toEqual({
      total: 2,
      listed: 2,
      exits: 1,
      exitsListed: 1,
    })
    // 80 before the cut, 30 of them exits; 2 of the rest listed.
    expect(
      sharedCounts({ shared_ip_total: 80, shared_exits: 30 }, [
        farm,
        office,
        exit,
      ])
    ).toEqual({ total: 50, listed: 2, exits: 30, exitsListed: 1 })
    // A total never reads under what is listed.
    expect(sharedCounts({ shared_ip_total: 1 }, [farm, office]).total).toBe(2)
    // Plan buyers behind a shared exit are not the danger signal.
    expect(hasRepeatBuyers([farm, exitBuyers])).toBe(false)
    expect(hasRepeatBuyers([buyers, exit])).toBe(true)
    expect(clusterRisk(buyers, 1000).limited).toBe(true)
  })

  it('reads unpaid spenders, gift guard outcomes and suspect inviters when the server sends them', () => {
    const base = { signups: 10, zero_use_accounts: 4 } as RiskInsights
    expect(unpaidSpend(base)).toBeUndefined()
    expect(giftOutcomes(base)).toBeUndefined()
    expect(neverUsed({ ...base, zero_use_failed: 1 })).toEqual({
      zero: 4,
      signups: 10,
      mature: false,
      failed: 1,
    })
    const data = {
      ...base,
      signup_spenders: 8,
      unpaid_spenders: 2,
      unpaid_spend_usd: 6.5,
      signup_gifts: [
        { name: 'ip_used', count: 4 },
        { name: 'gifted', count: 3 },
        { name: 'email_signup', count: 2 },
        { name: 'cap_reached', count: 1 },
      ],
      unpaid_inviters: [
        { user_id: 1, username: 'a', accounts: 3, consumption_usd: 9 },
        { user_id: 0, username: '', accounts: 5, consumption_usd: 9 },
        { user_id: 2, username: 'b', accounts: 2, consumption_usd: 1 },
      ],
      gift_block_inviters: [
        { user_id: 1, username: 'a', blocked: 5, gifted: 1 },
      ],
    } as RiskInsights
    expect(unpaidSpend(data)).toEqual({
      spenders: 8,
      unpaid: 2,
      spend: 6.5,
      share: 0.25,
    })
    expect(giftOutcomes(data)).toEqual({ total: 10, blocked: 5, gifted: 3 })
    expect(suspectInviters(data)).toEqual({ unpaid: 1, blocked: 1 })
  })

  it('splits unpaid spend by source and marks an account funded mostly by hand', () => {
    const base = { signups: 10, zero_use_accounts: 4 } as RiskInsights
    const split = {
      ...base,
      signup_spenders: 8,
      unpaid_spenders: 2,
      unpaid_spend_usd: 10,
      unpaid_granted_usd: 6,
      unpaid_redeemed_usd: 1,
      unpaid_gift_plan_usd: 2,
      unpaid_signup_gift_usd: 1,
    } as RiskInsights
    expect(unpaidSpend(split)?.split).toEqual({
      granted: 6,
      redeemed: 1,
      gift: 2,
      signupGift: 1,
      checkin: 0,
    })
    expect(grantedShare(unpaidSpend(split))).toBe(0.6)
    // An older server sends no split: the spend reads as before.
    const older = unpaidSpend({
      ...base,
      signup_spenders: 8,
      unpaid_spenders: 2,
      unpaid_spend_usd: 10,
    } as RiskInsights)
    expect(older?.split).toBeUndefined()
    expect(grantedShare(older)).toBe(0)
    const account = {
      user_id: 5,
      username: 'a',
      consumption_usd: 10,
      gift_plan_usd: 0,
      granted_usd: 6,
      signup_method: 'email',
      inviter: { user_id: 0, username: '' },
      created_at: 1,
    }
    expect(isHandFunded(account)).toBe(true)
    expect(isHandFunded({ ...account, granted_usd: 5 })).toBe(false)
    expect(isHandFunded({ ...account, granted_usd: undefined })).toBe(false)
  })

  it('judges inviters on gift credit once the server sends it', () => {
    const inviter = { accounts: 3, consumption_usd: 9 }
    const data = {
      unpaid_inviters: [
        { user_id: 1, username: 'a', ...inviter, gift_usd: 0 },
        { user_id: 2, username: 'b', ...inviter, gift_usd: 4 },
        { user_id: 3, username: 'c', ...inviter },
      ],
    } as RiskInsights
    // Hand-granted credit alone is not farming; an older row has no gift part to read.
    expect(suspectInviters(data)).toEqual({ unpaid: 2, blocked: 0 })
    expect(usesGiftPart(data)).toBe(false)
    // Only invitees on gift credit count once the server sends how many they are.
    const counted = {
      unpaid_inviters: [
        {
          user_id: 1,
          username: 'a',
          ...inviter,
          gift_accounts: 1,
          gift_usd: 0.5,
        },
        {
          user_id: 2,
          username: 'b',
          ...inviter,
          gift_accounts: 3,
          gift_usd: 4,
        },
      ],
    } as RiskInsights
    expect(suspectInviters(counted)).toEqual({ unpaid: 1, blocked: 0 })
    expect(usesGiftPart({ unpaid_signup_gift_usd: 0 } as RiskInsights)).toBe(
      true
    )
  })

  it('lists the server’s shared exits as sent and counts addresses to review as the total less the exits', () => {
    const exitB = { ...office, ip: '10.0.0.4', shared_exit: true }
    const exitC = { ...office, ip: '10.0.0.5', shared_exit: true }
    const data = {
      shared_ip_total: 80,
      shared_exits: 30,
      shared_exit_top: [exitB, exitC],
    } as RiskInsights
    expect(sharedExitSource(data)?.shared_ips).toEqual([exitB, exitC])
    expect(sharedExitSource({} as RiskInsights)).toBeUndefined()
    expect(exitsOf(data, [farm], [exitB, exitC])).toEqual([exitB, exitC])
    // An older server keeps exits among shared_ips.
    expect(exitsOf({} as RiskInsights, [farm, exitB], [])).toEqual([exitB])
    expect(sharedCounts(data, [farm, office], [exitB, exitC])).toEqual({
      total: 50,
      listed: 2,
      exits: 30,
      exitsListed: 2,
    })
    expect(withRisk([office, farm], 1000).map((c) => c.ip)).toEqual([
      '10.0.0.2',
      '10.0.0.1',
    ])
  })
})

describe('risk tab', () => {
  it('ranks the farm first, marks a clustered debtor, and links to where the operator acts', () => {
    const data = {
      signups: 3,
      signup_series: [],
      series_unit: 'hour',
      peak_signups: { at: 0, count: 0 },
      signup_methods: [],
      email_domains: [],
      alias_emails: 0,
      off_whitelist: 0,
      zero_use_accounts: 3,
      shared_ips: [office, farm],
      debtors: [
        { user_id: 12, username: 'u12', balance_usd: -6 },
        { user_id: 99, username: 'tiny', balance_usd: -0.3 },
      ],
    } as unknown as RiskInsights
    render(
      <RiskTab
        data={data}
        range={{ start: 1000, end: 1000 + 86400, days: 1, hourly: true }}
      />
    )
    expect(
      screen.getByText(
        '3 sign-ups. To check: 2 addresses shared by several accounts, 1 accounts in debt. Review 10.0.0.1 first: 3 registered within 10 minutes, 3 created in this range, 3 unpaid with nothing left. Act on accounts from Users, usage logs and Risk Control.'
      )
    ).toBeInTheDocument()
    const addresses = screen
      .getAllByText(/^10\.0\.0\.\d$/)
      .map((node) => node.textContent)
    expect(addresses).toEqual(['10.0.0.1', '10.0.0.2'])
    expect(
      screen.getByText('All paid: likely an office or a reseller')
    ).toBeInTheDocument()

    expect(screen.queryByText('tiny')).toBeNull()
    const debtor = screen.getByText('Shares an address').closest('tr')
    expect(debtor).not.toBeNull()
    const links = within(debtor as HTMLElement).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/usage-logs/common?userId=12',
      '/users?filter=u12',
    ])
    expect(
      screen.getByRole('link', { name: 'Risk audit' }).getAttribute('href')
    ).toBe('/risk-control#audit')
    expect(
      screen
        .getByRole('link', { name: 'Violation records' })
        .getAttribute('href')
    ).toBe('/risk-control#violations')
  })

  it('folds shared exits away, counts addresses in all, and shows unpaid spenders and gift outcomes', () => {
    const exit = { ...office, ip: '10.0.0.3', shared_exit: true }
    const data = {
      signups: 3,
      signup_series: [],
      series_unit: 'hour',
      peak_signups: { at: 0, count: 0 },
      signup_methods: [],
      email_domains: [],
      alias_emails: 1,
      alias_pattern_emails: 4,
      alias_clusters: [
        {
          canonical: 'johnsmith@gmail.com',
          users: [
            { user_id: 5, username: 'inbox' },
            { user_id: 8, username: 'alias' },
          ],
        },
      ],
      email_restriction: false,
      off_whitelist: 0,
      zero_use_accounts: 3,
      zero_use_failed: 2,
      shared_ip_total: 60,
      shared_exits: 9,
      shared_ips: [{ ...farm, shared_exit: false }, exit],
      debtors: [],
      signup_spenders: 4,
      unpaid_spenders: 3,
      unpaid_spend_usd: 7.5,
      unpaid_spender_top: [
        {
          user_id: 31,
          username: 'farm31',
          consumption_usd: 3,
          gift_plan_usd: 2,
          signup_method: 'password',
          inviter: { user_id: 1, username: 'boss' },
          created_at: 1200,
        },
      ],
      unpaid_inviters: [
        { user_id: 1, username: 'boss', accounts: 3, consumption_usd: 7.5 },
      ],
      signup_gifts: [
        { name: 'ip_used', count: 2 },
        { name: 'gifted', count: 1 },
      ],
      gift_block_inviters: [
        { user_id: 1, username: 'boss', blocked: 2, gifted: 1 },
      ],
    } as unknown as RiskInsights
    render(
      <RiskTab
        data={data}
        range={{ start: 1000, end: 1000 + 86400, days: 1, hourly: true }}
      />
    )
    expect(
      screen.getByText(
        '51 addresses are shared by several accounts; the 1 riskiest are listed, the riskiest first.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('9 shared exits, 1 listed: not counted above')
    ).toBeInTheDocument()
    expect(screen.getByText('9 shared exits left out')).toBeInTheDocument()
    expect(
      screen.getByText(
        /^3 of the 4 new accounts that used credit have never paid; they used ¥7\.5 in the range\.$/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('2 of 3 gift claims were blocked.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Blocked: address already claimed')
    ).toBeInTheDocument()
    expect(screen.getByText('johnsmith@gmail.com')).toBeInTheDocument()
    expect(
      screen.getByText('Domain restriction is off: not checked')
    ).toBeInTheDocument()
    expect(
      screen.getByText('2 of them tried and every request failed.', {
        exact: false,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/1 inviters with 3 or more unpaid spenders/)
    ).toBeInTheDocument()
  })

  it('says the figures could not be read instead of printing zero or none', () => {
    render(
      <RiskTab
        data={undefined}
        sources={{
          view: { status: 'error', error: 'boom' },
          previous: { status: 'error' },
        }}
      />
    )
    expect(screen.queryByText('No address is shared in this range')).toBeNull()
    expect(screen.queryByText('No customer owes money')).toBeNull()
    expect(screen.getAllByText('Could not be read').length).toBeGreaterThan(0)
    expect(screen.queryByText('0')).toBeNull()
  })

  it('reads unpaid spend by source, says how much an administrator granted, and marks the account funded by hand', () => {
    const data = {
      signups: 3,
      signup_series: [],
      series_unit: 'hour',
      peak_signups: { at: 0, count: 0 },
      signup_methods: [],
      email_domains: [],
      alias_emails: 0,
      off_whitelist: 0,
      zero_use_accounts: 3,
      shared_ips: [],
      debtors: [],
      signup_spenders: 4,
      unpaid_spenders: 2,
      unpaid_spend_usd: 10,
      unpaid_granted_usd: 8,
      unpaid_redeemed_usd: 0,
      unpaid_gift_plan_usd: 1,
      unpaid_signup_gift_usd: 1,
      unpaid_spender_top: [
        {
          user_id: 31,
          username: 'granted31',
          consumption_usd: 6,
          gift_plan_usd: 0,
          granted_usd: 6,
          redeemed_usd: 0,
          signup_gift_usd: 0,
          signup_method: 'password',
          inviter: { user_id: 0, username: '' },
          created_at: 1200,
        },
        {
          user_id: 32,
          username: 'gift32',
          consumption_usd: 4,
          gift_plan_usd: 1,
          granted_usd: 2,
          redeemed_usd: 0,
          signup_gift_usd: 1,
          signup_method: 'email',
          inviter: { user_id: 0, username: '' },
          created_at: 1300,
        },
      ],
    } as unknown as RiskInsights
    render(
      <RiskTab
        data={data}
        range={{ start: 1000, end: 1000 + 86400, days: 1, hourly: true }}
      />
    )
    expect(
      screen.getByText(
        /Of that, .* was granted by hand, .* came from redemption codes/
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Granted by hand')).toBeInTheDocument()
    expect(screen.getByText('Redeemed codes')).toBeInTheDocument()
    expect(screen.getByText('Sign-up and invite gifts')).toBeInTheDocument()
    // Only the account funded mostly by hand is marked.
    expect(screen.getAllByText('Credited by an administrator')).toHaveLength(1)
    expect(screen.getByText('granted31').closest('tr')).toHaveTextContent(
      'Credited by an administrator'
    )
    // Eight of the ten are by hand: information, not a finding.
    expect(
      screen.getByText(
        /of unpaid spend was credit an administrator granted by hand\./
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/unpaid spenders on gift credit/)).toBeNull()
  })

  it('judges farming on gift credit only, so an inviter whose spenders were hand-funded is not named', () => {
    const inviter = {
      user_id: 9,
      username: 'boss',
      accounts: 3,
      consumption_usd: 9,
    }
    const data = {
      signups: 3,
      signup_series: [],
      series_unit: 'hour',
      peak_signups: { at: 0, count: 0 },
      signup_methods: [],
      email_domains: [],
      alias_emails: 0,
      off_whitelist: 0,
      zero_use_accounts: 3,
      shared_ips: [],
      debtors: [],
      signup_spenders: 4,
      unpaid_spenders: 3,
      unpaid_spend_usd: 9,
      unpaid_granted_usd: 9,
      unpaid_redeemed_usd: 0,
      unpaid_gift_plan_usd: 0,
      unpaid_signup_gift_usd: 0,
      unpaid_inviters: [{ ...inviter, gift_usd: 0 }],
    } as unknown as RiskInsights
    render(
      <RiskTab
        data={data}
        range={{ start: 1000, end: 1000 + 86400, days: 1, hourly: true }}
      />
    )
    expect(
      screen.queryByText(/inviters with 3 or more unpaid spenders/)
    ).toBeNull()
    expect(
      screen.getByText(
        /100% of unpaid spend was credit an administrator granted by hand\./
      )
    ).toBeInTheDocument()
  })

  it('lists shared exits as a table in the server’s order, under the count', () => {
    const exitB = { ...office, ip: '10.0.0.4', shared_exit: true }
    const exitC = { ...office, ip: '10.0.0.5', shared_exit: true }
    const data = {
      signups: 3,
      signup_series: [],
      series_unit: 'hour',
      peak_signups: { at: 0, count: 0 },
      signup_methods: [],
      email_domains: [],
      alias_emails: 0,
      off_whitelist: 0,
      zero_use_accounts: 3,
      shared_ips: [{ ...farm, shared_exit: false }],
      shared_ip_total: 3,
      shared_exits: 2,
      shared_exit_top: [exitB, exitC],
      debtors: [],
    } as unknown as RiskInsights
    render(
      <RiskTab
        data={data}
        range={{ start: 1000, end: 1000 + 86400, days: 1, hourly: true }}
      />
    )
    expect(
      screen.getByText('2 shared exits: not counted above')
    ).toBeInTheDocument()
    const rows = screen
      .getAllByText(/^10\.0\.0\.[45]$/)
      .map((node) => node.textContent)
    expect(rows).toEqual(['10.0.0.4', '10.0.0.5'])
    expect(screen.getByText('Address')).toBeInTheDocument()
    expect(screen.getByText('Reasons')).toBeInTheDocument()
  })
})
