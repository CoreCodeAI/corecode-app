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

import type { EngineAccount, EngineRunway } from '../../types'
import { expiringAccounts, poolRunsShort } from '../unused-quota'
import { UnusedQuotaPanel } from '../unused-quota-panel'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

// The pool on 2026-11-06: #10024 had $1,113 left, 103 hours to its reset and spent $4.17 an
// hour; #10023 had $58 left and was spending past its week.
function account(overrides: Partial<EngineAccount>): EngineAccount {
  return {
    credential_id: 1,
    group_id: 1,
    group: 'Team',
    email_mask: 'a***@example.com',
    plan: 'Team',
    tier: 'team_tier_1',
    status: 'available',
    five_hour: 10,
    seven_day: 10,
    five_hour_reset_ms: 0,
    seven_day_reset_ms: NOW + 103 * HOUR,
    cooldown_until_ms: 0,
    eligible: true,
    active: 0,
    sessions: 0,
    observed_at_ms: NOW,
    observation: '',
    successes: 0,
    failures: 0,
    last_used_at_ms: 0,
    last_failure: '',
    last_failure_at_ms: 0,
    five_hour_remaining_usd: 100,
    seven_day_remaining_usd: 1113,
    burn_usd_per_hour: 4.17,
    seven_day_capacity_usd: 1223,
    seven_day_unused_usd: 683,
    ...overrides,
  }
}

describe('accounts whose weekly quota will expire unused', () => {
  it('lists the accounts the engine projects to leave quota, worst first', () => {
    const rows = expiringAccounts(
      [
        account({ credential_id: 1, seven_day_unused_usd: 155 }),
        account({ credential_id: 2, seven_day_unused_usd: 683 }),
        account({ credential_id: 3, seven_day_unused_usd: 242 }),
      ],
      NOW
    )
    expect(rows.map((row) => row.account.credential_id)).toEqual([2, 3, 1])
  })

  it('leaves out waste inside the rounding noise', () => {
    // 3% of a $1,223 week is $36.7: $30 is noise on this account, but not on a small one.
    const rows = expiringAccounts(
      [
        account({ credential_id: 1, seven_day_unused_usd: 30 }),
        account({
          credential_id: 2,
          seven_day_unused_usd: 30,
          seven_day_capacity_usd: 276,
        }),
        account({ credential_id: 3, seven_day_unused_usd: 12 }),
      ],
      NOW
    )
    expect(rows.map((row) => row.account.credential_id)).toEqual([2])
  })

  it('skips accounts without a projection, as an older engine sends', () => {
    expect(
      expiringAccounts(
        [
          account({ credential_id: 1, seven_day_unused_usd: null }),
          account({ credential_id: 2, seven_day_unused_usd: undefined }),
        ],
        NOW
      )
    ).toEqual([])
  })

  it('reads the hours to the reset and the rate needed to spend what is left', () => {
    const [row] = expiringAccounts([account({})], NOW)
    expect(row.hours).toBeCloseTo(103, 6)
    expect(row.needed).toBeCloseTo(1113 / 103, 6)
    const [past] = expiringAccounts(
      [account({ seven_day_reset_ms: NOW - HOUR })],
      NOW
    )
    expect(past.hours).toBe(0)
    expect(past.needed).toBeNull()
  })

  it('renders the accounts, and nothing when no account will waste quota', () => {
    const { container, rerender } = render(
      <UnusedQuotaPanel
        accounts={[account({ email_mask: 'j***@alphafox.xyz' })]}
        observedAt={NOW}
        total={{ usd: 683, counted: 11 }}
      />
    )
    expect(screen.getByText('j***@alphafox.xyz')).toBeTruthy()
    expect(screen.getByText('Quota that will expire unused')).toBeTruthy()

    rerender(
      <UnusedQuotaPanel
        accounts={[account({ seven_day_unused_usd: 0 })]}
        observedAt={NOW}
        total={{ usd: 0, counted: 11 }}
      />
    )
    expect(container.textContent).toBe('')
  })
})

// The runway fields the verdict reads; the rest of the shape is not needed here.
function runway(overrides: Partial<EngineRunway>): EngineRunway {
  return { week_load: 0.7, week_hours: null, ...overrides } as EngineRunway
}

describe('a pool that runs short uses what one account would leave', () => {
  it('reads the same test as the capacity verdict', () => {
    expect(poolRunsShort(undefined)).toBe(false)
    expect(poolRunsShort(null)).toBe(false)
    expect(poolRunsShort(runway({}))).toBe(false)
    expect(poolRunsShort(runway({ week_load: 1 }))).toBe(true)
    expect(poolRunsShort(runway({ week_hours: 84 }))).toBe(true)
    // Tight is not short: 0.9 of the supply still leaves room.
    expect(poolRunsShort(runway({ week_load: 0.9 }))).toBe(false)
  })

  it('lists the accounts while the pool keeps up', () => {
    render(
      <UnusedQuotaPanel
        accounts={[account({ email_mask: 'j***@alphafox.xyz' })]}
        observedAt={NOW}
        total={{ usd: 683, counted: 11 }}
        runway={runway({ week_load: 0.7 })}
      />
    )
    expect(screen.getByText('j***@alphafox.xyz')).toBeTruthy()
  })

  it('says the quota will be used, and lists no account, when the pool runs short', () => {
    render(
      <UnusedQuotaPanel
        accounts={[account({ email_mask: 'j***@alphafox.xyz' })]}
        observedAt={NOW}
        total={{ usd: 683, counted: 11 }}
        runway={runway({ week_hours: 84 })}
      />
    )
    expect(screen.queryByText('j***@alphafox.xyz')).toBeNull()
    expect(screen.getByText(/most likely be used/)).toBeTruthy()
    expect(screen.getByText('Quota that will expire unused')).toBeTruthy()
  })

  it('stays out of the way when no account qualifies, short or not', () => {
    const { container } = render(
      <UnusedQuotaPanel
        accounts={[account({ seven_day_unused_usd: 0 })]}
        observedAt={NOW}
        total={{ usd: 0, counted: 11 }}
        runway={runway({ week_hours: 84 })}
      />
    )
    expect(container.textContent).toBe('')
  })
})
