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
import { describe, expect, it } from 'vitest'

import { overviewRunwaySignals } from '../components/overview-signals'
import type { UpstreamAccount, UpstreamRunway } from '../types'
import {
  formatDays,
  runwayAccounts,
  runwayDanger,
  runwayTone,
} from '../upstream-runway'

function account(over: Partial<UpstreamAccount>): UpstreamAccount {
  return {
    host: 'usdj.example',
    channels: [1],
    names: ['a'],
    balance: 100,
    balance_updated_at: 1,
    balance_channel: 1,
    basis: 'request',
    spent_usd: 70,
    daily_usd: 10,
    daily: [10, 10, 10, 10, 10, 10, 10],
    days_left: 10,
    ...over,
  }
}

const runway = (accounts: UpstreamAccount[]): UpstreamRunway => ({
  days: 7,
  at: 1,
  accounts,
  pools: [],
})

describe('runwayTone', () => {
  it('is red under 3 days, yellow under 7, and none without days', () => {
    expect(runwayTone(0.4)).toBe('danger')
    expect(runwayTone(2.99)).toBe('danger')
    expect(runwayTone(3)).toBe('warning')
    expect(runwayTone(6.99)).toBe('warning')
    expect(runwayTone(7)).toBe('good')
    expect(runwayTone(null)).toBe('default')
    expect(runwayTone(undefined)).toBe('default')
    expect(runwayTone(Number.NaN)).toBe('default')
  })
})

describe('runwayAccounts and runwayDanger', () => {
  const rich = account({ host: 'rich', days_left: 18 })
  const low = account({ host: 'low', days_left: 1.7 })
  const unknown = account({
    host: 'unknown',
    days_left: null,
    basis: 'none',
    balance: 500,
  })

  it('lists the fewest days first and the unmeasured last', () => {
    expect(
      runwayAccounts(runway([unknown, rich, low])).map((a) => a.host)
    ).toEqual(['low', 'rich', 'unknown'])
    expect(runwayAccounts(undefined)).toEqual([])
  })

  it('picks only accounts under three days; an unmeasured one is never red', () => {
    expect(
      runwayDanger(runway([unknown, rich, low])).map((a) => a.host)
    ).toEqual(['low'])
    expect(runwayDanger(undefined)).toEqual([])
  })
})

describe('formatDays', () => {
  it('keeps a place under ten and caps the long runways', () => {
    expect(formatDays(1.74)).toBe('1.7')
    expect(formatDays(9.96)).toBe('10')
    expect(formatDays(17.9)).toBe('18')
    expect(formatDays(400)).toBe('99+')
  })
})

describe('overviewRunwaySignals', () => {
  const t = ((key: string, options?: Record<string, unknown>) =>
    key.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(options?.[name] ?? '')
    )) as never
  const fmt = { usd: (value: number) => `$${value}` } as never

  it('raises one red finding naming every account under three days', () => {
    const found = overviewRunwaySignals(
      t,
      fmt,
      runway([
        account({ host: 'usdj', days_left: 1.7, balance: 208, daily_usd: 122 }),
        account({ host: 'sub', days_left: 17.9 }),
        account({ host: 'tiny', days_left: 0.5, balance: 3, daily_usd: 6 }),
      ])
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      key: 'upstream-runway',
      tone: 'danger',
      tab: 'upstream',
      title: '2 upstream accounts run out within 3 days',
      impact: 128,
    })
    expect(found[0].detail).toContain('usdj: 1.7 days, $208 left')
    expect(found[0].detail).toContain('tiny: 0.5 days, $3 left')
    expect(found[0].detail).not.toContain('sub')
  })

  it('stays quiet when every account has room, has no spend, or is unread', () => {
    expect(
      overviewRunwaySignals(
        t,
        fmt,
        runway([
          account({ days_left: 3 }),
          account({ host: 'x', days_left: null, basis: 'none' }),
        ])
      )
    ).toEqual([])
    expect(overviewRunwaySignals(t, fmt, undefined)).toEqual([])
  })
})
