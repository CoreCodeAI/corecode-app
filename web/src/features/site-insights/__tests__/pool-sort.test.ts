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

import {
  quotaHeadroom,
  scheduleRanks,
  sortPoolAccounts,
  type PoolSort,
} from '../pool-sort'
import type { EngineAccount } from '../types'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

function account(overrides: Partial<EngineAccount>): EngineAccount {
  return {
    credential_id: 1,
    group_id: 1,
    group: 'group',
    email_mask: 'a***@example.com',
    plan: 'Max',
    tier: 'default',
    status: 'available',
    five_hour: 0,
    seven_day: 0,
    five_hour_reset_ms: 0,
    seven_day_reset_ms: 0,
    cooldown_until_ms: 0,
    eligible: true,
    active: 0,
    sessions: 0,
    observed_at_ms: NOW,
    observation: 'fresh',
    successes: 0,
    failures: 0,
    last_used_at_ms: 0,
    last_failure: '',
    last_failure_at_ms: 0,
    five_hour_remaining_usd: null,
    seven_day_remaining_usd: null,
    burn_usd_per_hour: null,
    ...overrides,
  }
}

const budget = { five: 90, seven: 98 }

describe('quotaHeadroom', () => {
  // With the budget off, an unused account with no reset spreads the whole
  // week over 168 hours.
  it('matches the engine for an unused account', () => {
    expect(quotaHeadroom(account({}), { five: 0, seven: 0 }, NOW)).toBe(
      Math.floor(1_000_000_000 / 168)
    )
  })

  it('squares the 5-hour share left below the budget line', () => {
    const half = quotaHeadroom(account({ five_hour: 45 }), budget, NOW)
    const fresh = quotaHeadroom(account({}), budget, NOW)
    expect(half / fresh).toBeCloseTo(0.25, 6)
  })

  it('spends quota that resets soon first, holding the hours at one or more', () => {
    const soon = account({
      seven_day: 50,
      seven_day_reset_ms: NOW + 10 * 60_000,
    })
    const late = account({
      seven_day: 50,
      seven_day_reset_ms: NOW + 100 * HOUR,
    })
    expect(
      quotaHeadroom(soon, budget, NOW) / quotaHeadroom(late, budget, NOW)
    ).toBeCloseTo(100, 3)
  })

  it('counts a window past its reset as unused', () => {
    const reset = account({
      five_hour: 89,
      five_hour_reset_ms: NOW - 1,
      seven_day: 97,
      seven_day_reset_ms: NOW - 1,
    })
    expect(quotaHeadroom(reset, budget, NOW)).toBe(
      quotaHeadroom(account({}), budget, NOW)
    )
  })

  it('scales by the schedule weight over the default of 50, as the engine does', () => {
    const fresh = quotaHeadroom(account({}), budget, NOW)
    expect(
      quotaHeadroom(account({ weight: 100 }), budget, NOW) / fresh
    ).toBeCloseTo(2, 6)
    expect(
      quotaHeadroom(account({ weight: 25, capacity_weight: 3 }), budget, NOW) /
        fresh
    ).toBeCloseTo(1.5, 6)
    // A weight cannot lift an exhausted account off the floor.
    expect(
      quotaHeadroom(account({ five_hour: 95, weight: 100 }), budget, NOW)
    ).toBe(1)
  })

  it('scales by the account size, and keeps an exhausted account at 1', () => {
    expect(
      quotaHeadroom(account({ capacity_weight: 5 }), budget, NOW) /
        quotaHeadroom(account({}), budget, NOW)
    ).toBeCloseTo(5, 6)
    expect(quotaHeadroom(account({ five_hour: 95 }), budget, NOW)).toBe(1)
  })
})

describe('schedule order', () => {
  const headroom = (row: EngineAccount) => quotaHeadroom(row, budget, NOW)

  it('ranks within each group by sessions per unit of headroom', () => {
    const rows = [
      // Twice the headroom carries twice the sessions before it ranks lower.
      account({ credential_id: 1, capacity_weight: 2, sessions: 3 }),
      account({ credential_id: 2, sessions: 1 }),
      account({ credential_id: 3, sessions: 0, five_hour: 80 }),
      account({ credential_id: 4, eligible: false, status: 'cooldown' }),
      account({ credential_id: 5, group_id: 2, sessions: 9 }),
    ]
    const ranks = scheduleRanks(rows, headroom)
    // 1: 4 / 2 = 2, 2: 2 / 1 = 2 then fewer in flight ties to id;
    // 3: 1 / (1/9)² = 81.
    expect([...ranks.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [5, 1],
    ])
  })

  it('breaks an equal load by requests in flight', () => {
    const rows = [
      account({ credential_id: 1, active: 3 }),
      account({ credential_id: 2, active: 1 }),
    ]
    expect(scheduleRanks(rows, headroom).get(2)).toBe(1)
  })
})

describe('sortPoolAccounts', () => {
  const ctx = {
    headroom: () => 1,
    ranks: new Map<number, number>(),
    groupOrder: new Map<number, number>(),
    statusLabel: (status: string) => status,
  }
  const ids = (rows: EngineAccount[]) => rows.map((row) => row.credential_id)
  const sorted = (rows: EngineAccount[], sort: PoolSort) =>
    ids(sortPoolAccounts(rows, sort, ctx))

  it('puts accounts without the figure last in either direction', () => {
    const rows = [
      account({ credential_id: 1, seven_day_remaining_usd: null }),
      account({ credential_id: 2, seven_day_remaining_usd: 10 }),
      account({ credential_id: 3, seven_day_remaining_usd: 30 }),
    ]
    expect(sorted(rows, { key: 'seven_left', dir: 'desc' })).toEqual([3, 2, 1])
    expect(sorted(rows, { key: 'seven_left', dir: 'asc' })).toEqual([2, 3, 1])
  })

  it('reads a reset of 0 as unknown, not as the soonest', () => {
    const rows = [
      account({ credential_id: 1, five_hour_reset_ms: 0 }),
      account({ credential_id: 2, five_hour_reset_ms: NOW + 2 * HOUR }),
      account({ credential_id: 3, five_hour_reset_ms: NOW + HOUR }),
    ]
    expect(sorted(rows, { key: 'five_reset', dir: 'asc' })).toEqual([3, 2, 1])
  })

  it('keeps equal rows in account order', () => {
    const rows = [3, 1, 2].map((id) => account({ credential_id: id }))
    expect(sorted(rows, { key: 'burn', dir: 'desc' })).toEqual([1, 2, 3])
  })

  it('lists the schedule by group, then place, then the unschedulable', () => {
    const rows = [
      account({ credential_id: 1, group_id: 2 }),
      account({ credential_id: 2, group_id: 1 }),
      account({ credential_id: 3, group_id: 1, eligible: false }),
      account({ credential_id: 4, group_id: 1 }),
    ]
    const order = sortPoolAccounts(
      rows,
      { key: 'schedule', dir: 'asc' },
      {
        ...ctx,
        ranks: new Map([
          [1, 1],
          [2, 2],
          [4, 1],
        ]),
        groupOrder: new Map([
          [1, 0],
          [2, 1],
        ]),
      }
    )
    expect(ids(order)).toEqual([4, 2, 1, 3])
  })
})
