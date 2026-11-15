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

import { PLAN_MIN_REQUESTS, planServed } from '../finance-analysis'
import type { EnginePlanUsage } from '../types'

const usage: EnginePlanUsage = {
  plans: [
    {
      plan: 'Max',
      tier: 'default_claude_max_5x',
      accounts: 2,
      requests: 40,
      failures: 2,
      served_usd: 60,
      added_in_range: 1,
    },
    {
      plan: 'Pro',
      tier: 'default_claude_pro',
      accounts: 1,
      requests: 3,
      failures: 0,
      served_usd: 5,
      added_in_range: 0,
    },
    {
      plan: 'Codex',
      tier: '',
      accounts: 1,
      requests: 12,
      failures: 0,
      served_usd: 20,
      added_in_range: 0,
    },
  ],
  removed: { accounts: 1, requests: 2, failures: 0, served_usd: 10 },
  unattributed: { accounts: 0, requests: 1, failures: 0, served_usd: 5 },
}

describe('planServed', () => {
  it('joins served value to each costed plan and mutes what has no cost row', () => {
    const served = planServed({
      usage,
      costed: [
        { plan: 'Max', tier: 'default_claude_max_5x', costUSD: 200 / 3 },
        { plan: 'Pro', tier: 'default_claude_pro', costUSD: 20 / 3 },
        { plan: 'Team', tier: 'team_standard', costUSD: 25 / 3 },
      ],
    })

    expect(served.totalUSD).toBe(100)
    expect(served.rows.map((row) => row.key)).toEqual([
      'Max/default_claude_max_5x',
      'Pro/default_claude_pro',
      'Team/team_standard',
    ])
    expect(served.rows[0].servedUSD).toBe(60)
    expect(served.rows[0].perCost).toBeCloseTo(0.9, 6)
    expect(served.rows[0].share).toBeCloseTo(0.6, 6)
    expect(served.rows[0].judged).toBe(true)
    // Three requests is under the floor.
    expect(served.rows[1].judged).toBe(false)
    expect(served.rows[2]).toMatchObject({
      servedUSD: 0,
      requests: 0,
      perCost: 0,
      judged: false,
    })

    expect(served.muted.map((row) => row.key)).toEqual([
      'Codex/',
      'removed',
      'unattributed',
    ])
    expect(served.muted[0]).toMatchObject({ perCost: null, servedUSD: 20 })
    expect(served.muted[1]).toMatchObject({ accounts: 1, servedUSD: 10 })
    expect(served.muted[2]).toMatchObject({ accounts: 0, servedUSD: 5 })
  })

  it('makes the shares of every served group add up to one', () => {
    const served = planServed({
      usage,
      costed: [{ plan: 'Max', tier: 'default_claude_max_5x', costUSD: 1 }],
    })
    const shares = [...served.rows, ...served.muted].map(
      (row) => row.share ?? 0
    )
    const sum = shares.reduce((total, share) => total + share, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  it('names the judged plans with the most and least served per dollar', () => {
    const served = planServed({
      usage: {
        ...usage,
        plans: [
          ...usage.plans,
          {
            plan: 'Team',
            tier: 'team_standard',
            accounts: 1,
            requests: PLAN_MIN_REQUESTS,
            failures: 0,
            served_usd: 30,
            added_in_range: 0,
          },
        ],
      },
      costed: [
        { plan: 'Max', tier: 'default_claude_max_5x', costUSD: 200 / 3 },
        { plan: 'Pro', tier: 'default_claude_pro', costUSD: 20 / 3 },
        { plan: 'Team', tier: 'team_standard', costUSD: 25 / 3 },
      ],
    })
    expect(served.most?.key).toBe('Team/team_standard')
    expect(served.least?.key).toBe('Max/default_claude_max_5x')
    expect(served.addedInRange).toBe(1)
  })

  it('names no pair under two judged plans', () => {
    const served = planServed({
      usage,
      costed: [
        { plan: 'Max', tier: 'default_claude_max_5x', costUSD: 200 / 3 },
      ],
    })
    expect(served.most).toBeNull()
    expect(served.least).toBeNull()
  })

  it('leaves the cost out of a plan that has none', () => {
    const served = planServed({
      usage,
      costed: [{ plan: 'Max', tier: 'default_claude_max_5x', costUSD: null }],
    })
    expect(served.rows[0].perCost).toBeNull()
    expect(served.rows[0].judged).toBe(false)
  })
})
