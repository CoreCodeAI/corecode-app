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
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type {
  EngineAccount,
  EngineGroup,
  EnginePool,
  EngineRunway,
  PoolUsage,
} from '../../types'
import { PoolTab } from '../pool-tab'
import { Breakdown } from '../shared'

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

function account(overrides: Partial<EngineAccount>): EngineAccount {
  return {
    credential_id: 1,
    group_id: 1,
    group: 'group',
    email_mask: 'a***@example.com',
    plan: 'Pro',
    tier: 'default',
    status: 'available',
    five_hour: 42,
    seven_day: 10,
    five_hour_reset_ms: 0,
    seven_day_reset_ms: 0,
    cooldown_until_ms: 0,
    eligible: true,
    active: 0,
    sessions: 0,
    observed_at_ms: 0,
    observation: '',
    successes: 0,
    failures: 0,
    last_used_at_ms: 0,
    last_failure: '',
    last_failure_at_ms: 0,
    five_hour_remaining_usd: 15,
    seven_day_remaining_usd: 150,
    burn_usd_per_hour: null,
    ...overrides,
  }
}

function pool(groups: EngineGroup[], accounts: EngineAccount[]): EnginePool {
  return {
    configured: true,
    observed_at_ms: 0,
    credential_concurrency: 5,
    five_hour_budget: 90,
    seven_day_budget: 95,
    eligible_accounts: accounts.length,
    effective_slots: 5,
    in_flight: 0,
    groups,
    accounts,
    five_hour_estimate: null,
    week_estimate: null,
    refills: [],
  }
}

function budgetLine(meter: HTMLElement) {
  return meter.querySelector<HTMLElement>('span')?.style.left ?? null
}

describe('pool account quota meters', () => {
  it('draws each account against its own group budget', () => {
    render(
      <PoolTab
        data={pool(
          [
            group({ id: 1, name: 'strict', five_hour_budget: 70 }),
            group({ id: 2, name: 'open', quota_budget: false }),
          ],
          [
            account({ credential_id: 1, group_id: 1, five_hour: 42 }),
            account({ credential_id: 2, group_id: 2, five_hour: 130 }),
          ]
        )}
      />
    )

    const [strict, open] = screen.getAllByRole('meter', {
      name: /^5-hour window/,
    })
    expect(strict).toHaveAttribute('aria-valuenow', '42')
    expect(budgetLine(strict)).toBe('70%')
    // No budget means no line, and a reading past 100% stays inside the bar.
    expect(open).toHaveAttribute('aria-valuenow', '100')
    expect(budgetLine(open)).toBeNull()
  })

  it('explains the window when its cell is hovered', async () => {
    const user = userEvent.setup()
    render(<PoolTab data={pool([group({})], [account({ five_hour: 42 })])} />)

    await user.hover(screen.getByRole('meter', { name: /^5-hour window/ }))

    const tooltip = await screen.findByText('Left before the line')
    expect(tooltip.closest('[data-slot=tooltip-content]')).toHaveTextContent(
      /Budget line\s*90%/
    )
  })

  it('shows provider windows with their actual period, remaining share and reset', async () => {
    render(
      <PoolTab
        provider='codex'
        data={pool(
          [group({ channel: 'codex', quota_budget: false })],
          [
            account({
              five_hour: 0,
              seven_day: 0,
              quota_windows: [
                {
                  id: 'primary',
                  label: '7d',
                  scope: 'account',
                  utilization: 0.02,
                  reset_at_ms: 1794378753000,
                  observed_at_ms: 1793775167746,
                  state: 'available',
                },
                {
                  id: 'spark-primary',
                  label: '5h',
                  scope: 'Spark',
                  utilization: 0,
                  reset_at_ms: null,
                  observed_at_ms: null,
                  state: 'available',
                },
                {
                  id: 'spark-secondary',
                  label: '7d',
                  scope: 'Spark',
                  utilization: 1,
                  reset_at_ms: null,
                  observed_at_ms: null,
                  state: 'exhausted',
                },
                {
                  id: 'review',
                  label: 'Code review',
                  scope: 'account',
                  utilization: null,
                  reset_at_ms: null,
                  observed_at_ms: null,
                  state: 'unavailable',
                },
              ],
            }),
          ]
        )}
      />
    )

    expect(screen.getByText('98% left')).toBeInTheDocument()
    expect(screen.getByText('100% left')).toBeInTheDocument()
    expect(screen.getByText('0% left')).toBeInTheDocument()
    expect(screen.getByText('Spark · 5h')).toBeInTheDocument()
    expect(screen.getByText('Spark · 7d')).toBeInTheDocument()
    expect(screen.getByText('No quota reading')).toBeInTheDocument()
    expect(
      screen.queryByRole('meter', { name: /^5-hour window/ })
    ).not.toBeInTheDocument()
    const weekly = screen.getByRole('meter', { name: /^7d / })
    expect(weekly).toHaveAttribute('aria-valuenow', '2')
    await userEvent.hover(weekly)
    const reset = await screen.findByText('Resets')
    expect(reset.closest('[data-slot=tooltip-content]')).not.toHaveTextContent(
      /Resets\s*-/
    )
    expect(reset.closest('[data-slot=tooltip-content]')).toHaveTextContent(
      /Used\s*2%/
    )
  })

  it('does not turn absent provider windows into a full quota', () => {
    render(
      <PoolTab
        provider='codex'
        data={pool(
          [group({ channel: 'codex', quota_budget: false })],
          [account({ quota_windows: [] })]
        )}
      />
    )
    expect(screen.getByText('No quota reading')).toBeInTheDocument()
    expect(
      screen.queryByRole('meter', { name: /window/ })
    ).not.toBeInTheDocument()
  })
})

function runway(overrides: Partial<EngineRunway>): EngineRunway {
  return {
    channel: 'claude',
    burn_usd_per_hour: 40,
    week_to_date_usd_per_hour: 44,
    sustainable_usd_per_hour: 32,
    peak_usd_per_hour: 120,
    week_remaining_usd: 2000,
    week_capacity_usd: 5376,
    week_load: 1.25,
    short_hours: 0,
    served_share: 1,
    horizon_hours: 168,
    lowest_usd: 50,
    lowest_hours: 100,
    week_hours: null,
    first_short_hours: null,
    counted: 8,
    unknown: 0,
    ...overrides,
  }
}

function renderRunway(overrides: Partial<EngineRunway>) {
  render(
    <PoolTab
      data={{
        ...pool([group({})], [account({})]),
        runway: runway(overrides),
      }}
    />
  )
}

describe('pool supply', () => {
  it('sets demand against what the resets bring back', () => {
    renderRunway({})

    expect(screen.getByText('125%')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Weekly load' })).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
    // $8/h short for a week.
    expect(
      screen.getByText(/about \$1,344 more weekly capacity/)
    ).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
    expect(screen.getByText('$120/h')).toBeInTheDocument()
    expect(screen.getByText('3.00× the demand')).toBeInTheDocument()
  })

  it('reads a near miss as the tightest point, not as running out', () => {
    renderRunway({})

    expect(screen.getByText('$50')).toBeInTheDocument()
    expect(screen.getByText(/· 1.3 hours of demand$/)).toBeInTheDocument()
    expect(
      screen.getByText(/tightest around .* with \$50 left/)
    ).toBeInTheDocument()
  })

  it('reports a gap with its start, length and total', () => {
    renderRunway({
      week_hours: 30,
      first_short_hours: 0.25,
      short_hours: 20,
      served_share: 0.88,
      lowest_usd: 0,
      lowest_hours: 30,
    })

    expect(screen.getByText('≈ 20.0 hours')).toBeInTheDocument()
    expect(screen.getByText(/· 88% of demand served$/)).toBeInTheDocument()
    expect(
      screen.getByText(
        /first runs out around .* for 15 minutes; 20.0 hours without quota in all/
      )
    ).toBeInTheDocument()
  })

  it('reads one gap once', () => {
    renderRunway({
      week_hours: 30,
      first_short_hours: 6,
      short_hours: 6,
      served_share: 0.96,
      lowest_usd: 0,
      lowest_hours: 30,
    })

    expect(
      screen.getByText(/the quota runs out around .* for 6.0 hours\.$/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/without quota in all/)).toBeNull()
  })

  it('draws the quota left hour by hour and reads out each hour', async () => {
    const user = userEvent.setup()
    renderRunway({ curve: [400, 0, 0, 200, 100] })

    const chart = screen.getByRole('img', {
      name: /\$400 now, least \$0 around/,
    })
    expect(screen.getByText('No quota left')).toBeInTheDocument()

    await user.click(chart)
    expect(screen.getByRole('status')).toHaveTextContent('$400')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent('No quota left')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent('$200')
  })

  it('reads how far demand can move and the busiest hour', () => {
    renderRunway({ headroom_scale: 0.9, peak_hour_usd_per_hour: 80 })

    expect(screen.getByText('−10%')).toBeInTheDocument()
    expect(
      screen.getByText('Lasts 7 days at $36.00/h or less')
    ).toBeInTheDocument()
    expect(screen.getByText('Busiest hour $80/h · 66.7%')).toBeInTheDocument()
  })

  it('reads headroom above the search as plenty', () => {
    renderRunway({ headroom_scale: null })
    expect(screen.getByText('Over 4.00×')).toBeInTheDocument()
  })

  it('says when growing use runs out sooner', () => {
    const scenario = {
      demand_scale: 1.4,
      short_hours: 20,
      served_share: 0.9,
      week_hours: 30,
      first_short_hours: 20,
      curve: [400, 100, 0, 200, 50],
    }
    renderRunway({
      growth_per_day: 0.08,
      trend: scenario,
      curve: [400, 300, 200, 350, 250],
      low: { ...scenario, curve: [400, 350, 300, 420, 380] },
      high: { ...scenario, curve: [400, 200, 0, 150, 0] },
    })

    expect(
      screen.getByText(/If use keeps growing 8% a day, it runs out around/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Week to date \$44.00\/h · \+8% a day/)
    ).toBeInTheDocument()
    expect(screen.getByText('Usual range')).toBeInTheDocument()
    expect(screen.getByText('Growing as this week')).toBeInTheDocument()
  })

  it('reads the range and the growing projection at each hour', async () => {
    const user = userEvent.setup()
    const scenario = {
      demand_scale: 1,
      short_hours: 0,
      served_share: 1,
      week_hours: null,
      first_short_hours: null,
    }
    renderRunway({
      growth_per_day: 0.08,
      curve: [400, 300, 200],
      trend: { ...scenario, curve: [400, 250, 0] },
      low: { ...scenario, curve: [400, 350, 300] },
      high: { ...scenario, curve: [400, 200, 50] },
    })

    await user.click(screen.getByRole('img', { name: /quota left over/ }))
    await user.keyboard('{ArrowRight}{ArrowRight}')
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('$200')
    expect(status).toHaveTextContent('Usual range $50 – $300')
    expect(status).toHaveTextContent('Growing: No quota left')
  })

  it('leaves the curve out for a server that sends none', () => {
    renderRunway({})
    expect(screen.queryByRole('img', { name: /quota left over/ })).toBeNull()
  })

  it('stays hidden for a server that sends the first runway', () => {
    const first = { ...runway({}) } as Partial<EngineRunway>
    delete first.sustainable_usd_per_hour
    render(
      <PoolTab
        data={{
          ...pool([group({})], [account({})]),
          runway: first as EngineRunway,
        }}
      />
    )
    expect(screen.queryByText('Claude pool supply')).toBeNull()
  })
})

describe('breakdown rows', () => {
  it('shows the full name, count and share on hover', async () => {
    const user = userEvent.setup()
    const name = 'a failure reason long enough that the row truncates it'
    render(
      <Breakdown
        items={[
          { name, count: 3 },
          { name: 'other', count: 1 },
        ]}
        empty='none'
      />
    )

    await user.hover(screen.getByRole('generic', { name: new RegExp(name) }))

    const tooltip = await screen.findByText('3 of 4 · 75%')
    expect(tooltip.closest('[data-slot=tooltip-content]')).toHaveTextContent(
      name
    )
  })
})

function usage(overrides: Partial<PoolUsage> = {}): PoolUsage {
  return {
    provider: 'claude',
    observed_at: 1_800_000_000,
    usd_exchange_rate: 8,
    channels: ['claude'],
    engine_configured: true,
    windows: [
      // ¥80 charged, $40 spent: ¥1 brings $0.50 at the week's rate.
      {
        hours: 1,
        quota: 80,
        engine_usd: 44,
        engine_requests: 10,
        engine_unpriced: 0,
      },
      {
        hours: 168,
        quota: 8000,
        engine_usd: 4000,
        engine_requests: 900,
        engine_unpriced: 0,
      },
    ],
    official_per_quota: 0.5,
    hourly: [],
    forecast: {
      next_5h_usd: 230,
      next_24h_usd: 960,
      next_24h_trend_usd: 1000,
      next_24h_low_usd: 800,
      next_24h_high_usd: 1200,
      next_5h_quota: 460,
      next_24h_quota: 1920,
      profile_hours: 168,
      growth_per_day: 0.05,
      band_forecasts: 30,
    },
    ...overrides,
  }
}

describe('providers', () => {
  const groups = [
    group({ id: 1, name: 'Team', channel: 'claude', provider: 'claude' }),
    group({
      id: 2,
      name: 'Codex',
      channel: 'codex',
      provider: 'codex',
      quota_budget: false,
    }),
    // Before the server sends a provider, gpt-load's Gemini channel is still Gemini.
    group({
      id: 3,
      name: 'Antigravity',
      channel: 'antigravity',
      quota_budget: false,
    }),
  ]
  const accounts = [
    account({ credential_id: 1, group_id: 1, email_mask: 'claude@x' }),
    account({ credential_id: 2, group_id: 2, email_mask: 'codex@x' }),
    account({ credential_id: 3, group_id: 3, email_mask: 'gemini@x' }),
  ]

  it('shows only the chosen provider’s groups and accounts', () => {
    render(<PoolTab data={pool(groups, accounts)} provider='codex' />)

    expect(screen.getByText(/codex@x/)).toBeInTheDocument()
    expect(screen.queryByText(/claude@x/)).not.toBeInTheDocument()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
    // Dollar capacity is estimated for Claude only.
    expect(screen.queryByText('5-hour left')).not.toBeInTheDocument()
    expect(
      screen.getByText(/whether the Codex pool keeps up is not judged here/)
    ).toBeInTheDocument()
  })

  it('maps gpt-load’s antigravity channel to Gemini', () => {
    render(<PoolTab data={pool(groups, accounts)} provider='gemini' />)
    expect(screen.getByText(/gemini@x/)).toBeInTheDocument()
  })

  it('switches provider through the callback', async () => {
    const chosen: string[] = []
    render(
      <PoolTab
        data={pool(groups, accounts)}
        onProvider={(next) => chosen.push(next)}
      />
    )
    expect(screen.getByText(/claude@x/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Codex/ }))
    expect(chosen).toEqual(['codex'])
  })
})

describe('capacity verdict', () => {
  it('sizes the Team Tier 1 accounts to add, with Team Standard beside them', () => {
    render(
      <PoolTab
        data={{
          ...pool([group({})], [account({})]),
          five_hour_estimate: {
            remaining_usd: 200,
            remaining_low_usd: 190,
            remaining_high_usd: 210,
            capacity_usd: 400,
            counted: 1,
            unknown: 0,
          },
          runway: runway({
            additions: [
              {
                plan: 'Team',
                tier: 'team_tier_1',
                week_usd: 1458,
                budget_percent: 98,
                measured: 4,
                for_load: 2,
                for_trend: 3,
                for_week: 1,
              },
              {
                plan: 'Team',
                tier: 'team_standard',
                week_usd: 290,
                budget_percent: 98,
                measured: 6,
                for_load: 10,
                for_trend: 14,
                for_week: 5,
              },
            ],
          }),
        }}
        usage={usage()}
      />
    )

    expect(
      screen.getByText(
        /Not enough capacity\. To keep up with demand now, add 2 × Team Tier 1; each brings about \$1,458 a week\. If use keeps growing, 3 × Team Tier 1 by the end of the week\./
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Team Tier 1 to add')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Keep up 2 · 7 days 1 · with growth 3 · or 10 × Team Standard'
      )
    ).toBeInTheDocument()
    // $230 forecast against $200 left in the 5-hour windows.
    expect(screen.getByText('≈ $230')).toHaveClass('text-destructive')
    expect(screen.getByText('Range $800 – $1,200')).toBeInTheDocument()
    // new-api's ¥460 is $57.50 at ¥8 a dollar, and $230 of gpt-load at $0.50 a yuan.
    expect(screen.getByText('≈ $58')).toBeInTheDocument()
    expect(screen.getByText('¥460 · ≈ $230 in gpt-load')).toBeInTheDocument()
    expect(screen.getByText('≈ $240')).toBeInTheDocument()
    expect(screen.getByText('¥1,920 · ≈ $960 in gpt-load')).toBeInTheDocument()
  })

  it('sizes the accounts by the demand expected over the next week', () => {
    render(
      <PoolTab
        data={{
          ...pool([group({})], [account({})]),
          runway: runway({
            growth_per_day: 0.086,
            expected_usd_per_hour: 81.6,
            additions: [
              {
                plan: 'Team',
                tier: 'team_tier_1',
                week_usd: 1392,
                budget_percent: 98,
                measured: 5,
                for_expected: 4,
                for_low: 2,
                for_high: 7,
                for_load: 3,
                for_trend: 6,
                for_week: 2,
              },
              {
                plan: 'Team',
                tier: 'team_standard',
                week_usd: 278,
                budget_percent: 98,
                measured: 5,
                for_expected: 20,
                for_low: 7,
                for_high: 34,
                for_load: 11,
                for_trend: 26,
                for_week: 6,
              },
            ],
          }),
        }}
      />
    )

    expect(
      screen.getByText(
        /Use grows 8\.6% a day, so demand over the next week averages about \$82\/h: add 4 × Team Tier 1 to keep up; each brings about \$1,392 a week\. Past forecasts put it between 2 and 7\./
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Range 2 – 7 · 7 days 2 · at today’s demand 3 · or 20 × Team Standard'
      )
    ).toBeInTheDocument()
  })

  it('says when no account is needed', () => {
    render(
      <PoolTab
        data={{
          ...pool([group({})], [account({})]),
          runway: runway({
            week_load: 0.5,
            addition: {
              plan: 'Max',
              tier: 'default_claude_max_5x',
              week_usd: 1458,
              budget_percent: 98,
              measured: 1,
              for_load: 0,
              for_trend: 0,
              for_week: 0,
            },
          }),
        }}
      />
    )
    expect(
      screen.getByText(/^Enough capacity\. No account needed/)
    ).toBeInTheDocument()
  })
})

describe('provider usage', () => {
  it('converts new-api’s charge to gpt-load spend at the week’s rate', () => {
    render(<PoolTab data={pool([group({})], [account({})])} usage={usage()} />)

    const row = screen.getByText('Last hour').closest('tr') as HTMLElement
    // ¥80 is $10 at ¥8 a dollar; at $0.50 a yuan it is $40 of gpt-load,
    // which spent $44: 1.10× the conversion.
    expect(row).toHaveTextContent('$10.00 (¥80')
    expect(row).toHaveTextContent('$40.00')
    expect(row).toHaveTextContent('$44.00')
    expect(row).toHaveTextContent('1.10×')
    const forecast = screen
      .getByText('Next 24 hours (forecast)')
      .closest('tr') as HTMLElement
    expect(forecast).toHaveTextContent('$960.00')
    expect(
      screen.getByText(
        /each ¥1 new-api charged for Claude cost gpt-load \$0\.50/
      )
    ).toBeInTheDocument()
  })

  it('ignores another provider’s figures while the new ones load', () => {
    render(
      <PoolTab
        data={pool([group({})], [account({})])}
        provider='codex'
        usage={usage()}
      />
    )
    expect(screen.queryByText('Last hour')).not.toBeInTheDocument()
  })
})
