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
  largestBurst,
  materialDebtors,
  neverUsed,
  neverUsedComparable,
  rankClusters,
  signalDelta,
  signupSurges,
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
      empty: 3,
      allPaid: false,
      score: 15,
    })
    // No member in the range or in a burst, nothing unpaid: 0, quartered.
    expect(clusterRisk(office, 100000)).toEqual({
      fresh: 0,
      burst: 1,
      buyers: 0,
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
})
