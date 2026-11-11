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
import { outlook, outlookModel } from './outlook-fixture'

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

// The engine's runway as a server before the outlook sends it.
function runway(overrides: Partial<EngineRunway>): EngineRunway {
  return {
    channel: 'claude',
    burn_usd_per_hour: 40,
    week_to_date_usd_per_hour: 44,
    sustainable_usd_per_hour: 32,
    peak_usd_per_hour: 120,
    week_remaining_usd: 2000,
    week_capacity_usd: 5376,
    week_load: 0.7,
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

// An account the engine projects to leave $683 of its week unspent.
const idle = account({
  email_mask: 'idle@x',
  seven_day_remaining_usd: 1113,
  seven_day_capacity_usd: 1223,
  seven_day_unused_usd: 683,
})

describe('the Claude pool’s quota ahead', () => {
  it('shows what is left, then whether it meets demand', () => {
    render(
      <PoolTab data={pool([group({})], [account({})])} outlook={outlook()} />
    )

    expect(screen.getByText('Quota left')).toBeInTheDocument()
    expect(screen.getByText('Supply and demand')).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Count resets' })
    ).toBeInTheDocument()
    // The stock figures the panels replace are gone from the summary.
    expect(screen.queryByText('5-hour left')).not.toBeInTheDocument()
    expect(screen.queryByText('Unused at reset')).not.toBeInTheDocument()
    expect(screen.queryByText('Is capacity enough?')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude pool supply')).not.toBeInTheDocument()
  })

  it('holds the place while the outlook loads', () => {
    render(<PoolTab data={pool([group({})], [account({})])} />)

    expect(screen.getByText('Quota left')).toBeInTheDocument()
    expect(screen.getByLabelText('Loading')).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(screen.queryByText('Supply and demand')).not.toBeInTheDocument()
  })

  it('says why when the outlook cannot be read, as before the server sends one', () => {
    render(
      <PoolTab
        data={pool([group({})], [account({})])}
        outlookError='Request failed with status code 404'
      />
    )
    expect(
      screen.getByText(
        'The pool’s quota ahead could not be read: Request failed with status code 404'
      )
    ).toBeInTheDocument()
  })

  it('reports the engine’s own failure', () => {
    render(
      <PoolTab
        data={pool([group({})], [account({})])}
        outlook={outlook({ error: 'pool estimate timed out', models: [] })}
      />
    )
    expect(
      screen.getByText(
        'The pool’s quota ahead could not be read: pool estimate timed out'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Supply and demand')).not.toBeInTheDocument()
  })

  it('keeps the last figures through a failed refresh', () => {
    render(
      <PoolTab
        data={pool([group({})], [account({})])}
        outlook={outlook()}
        outlookError='Network Error'
      />
    )
    expect(screen.getByText('Supply and demand')).toBeInTheDocument()
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument()
  })

  it('lists quota about to expire only while the forecast is served', () => {
    const data = pool([group({})], [idle])
    const { rerender } = render(<PoolTab data={data} outlook={outlook()} />)

    // The smart forecast runs short: the pool spends what one account leaves.
    expect(
      screen.queryByText('Quota that will expire unused')
    ).not.toBeInTheDocument()

    rerender(
      <PoolTab
        data={data}
        outlook={outlook({ models: [outlookModel('smart')] })}
      />
    )
    expect(
      screen.getByText('Quota that will expire unused')
    ).toBeInTheDocument()
  })

  it('reads the engine’s runway for that until the outlook arrives', () => {
    const data = pool([group({})], [idle])
    const { rerender } = render(
      <PoolTab data={{ ...data, runway: runway({ week_hours: 84 }) }} />
    )
    expect(
      screen.queryByText('Quota that will expire unused')
    ).not.toBeInTheDocument()

    rerender(<PoolTab data={{ ...data, runway: runway({}) }} />)
    expect(
      screen.getByText('Quota that will expire unused')
    ).toBeInTheDocument()
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
    expect(screen.queryByText('Quota left')).not.toBeInTheDocument()
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
    // Claude's forecast is the supply and demand panel's.
    expect(screen.queryByText(/\(forecast\)$/)).not.toBeInTheDocument()
    expect(
      screen.getByText(
        /each ¥1 new-api charged for Claude cost gpt-load \$0\.50/
      )
    ).toBeInTheDocument()
  })

  it('forecasts the next hours for a provider without a quota forecast', () => {
    render(
      <PoolTab
        data={pool([group({ channel: 'codex' })], [account({})])}
        provider='codex'
        usage={usage({ provider: 'codex', channels: ['codex'] })}
      />
    )
    const forecast = screen
      .getByText('Next 24 hours (forecast)')
      .closest('tr') as HTMLElement
    expect(forecast).toHaveTextContent('$960.00')
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
