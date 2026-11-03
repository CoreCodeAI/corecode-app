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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render as renderElement,
  screen,
  within,
} from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import type { EngineDailyCost, FinanceInsights } from '../../types'
import { FinanceTab } from '../finance-tab'

// The user table at the bottom reads its own window; these tests are about
// the rest of the view, so its read never settles.
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  getUserSpend: () => new Promise(() => undefined),
}))

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderElement(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  )
}

const day = (offset: number) => 1761408000 + offset * 86400

function earned(): FinanceInsights {
  return {
    revenue: 14,
    topup_revenue: 0,
    subscription_revenue: 14,
    orders: 1,
    paying_users: 1,
    methods: [],
    daily: [
      {
        day: day(0),
        topup: 0,
        subscription: 14,
        consumption_usd: 16,
        recognized_revenue: 10.8,
        claude_usd: 0,
      },
      {
        day: day(1),
        topup: 0,
        subscription: 0,
        consumption_usd: 9,
        recognized_revenue: 6.8,
        claude_usd: 0,
      },
    ],
    consumption_usd: 25,
    root_consumption_usd: 30,
    gift_consumption_usd: 8,
    revenue_per_usd: 0.56,
    recognized_revenue: 17.6,
    recognized_wallet_revenue: 12,
    recognized_subscription_revenue: 5.6,
    recognized_per_usd: 0.704,
    liability_usd: 50,
    liability_paid_value: 40,
    liability_users: 1,
    debt_usd: -0.5,
    debtors: [],
    top_balances: [],
    adjustments: [],
    adjustment_net_usd: 0,
    commission_usd: 0,
    redemption_usd: 0,
    bonus_usd: 0,
    topup_credit_usd: 0,
    adjustment_logs_found: false,
    claude_usd: 0,
    engine_cost: { configured: false, cost_usd: 0, requests: 0, daily: [] },
    matched_official_usd: 0,
    matched_claude_usd: 0,
    official_per_usd: 0,
    plans: [],
  } as FinanceInsights
}

describe('cash and credit at the head of the funds view', () => {
  it('keeps cash in yuan and reads revenue earned beside it', () => {
    render(<FinanceTab data={earned()} />)
    expect(screen.getByText('¥17.6')).toBeInTheDocument()
    expect(screen.getByText('Wallets ¥12 · plans ¥5.6')).toBeInTheDocument()
  })

  it('counts root’s use in consumption, in yuan with its dollars', () => {
    render(<FinanceTab data={{ ...earned(), usd_exchange_rate: 5 }} />)
    // Customers 25 and root 30: ¥55, $11 at five yuan to the dollar.
    const consumed = screen
      .getByText('Consumed at list price')
      .closest('dl') as HTMLElement
    expect(within(consumed).getByText('¥55')).toBeInTheDocument()
    expect(within(consumed).getByText('≈ $11.00')).toBeInTheDocument()
    expect(
      within(consumed)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['Paid part ¥17', 'Gifted part ¥8', 'Root (internal) ¥30'])
  })

  it('divides revenue earned by every yuan consumed, root’s included', () => {
    render(<FinanceTab data={earned()} />)
    // ¥17.6 earned over ¥55 consumed; paid use over the ¥17 paid part,
    // cash basis the ¥14 paid in the range over ¥55.
    expect(screen.getByText('¥0.32')).toBeInTheDocument()
    expect(
      screen.getByText('Paid use ¥1.04 · cash basis ¥0.2545')
    ).toBeInTheDocument()
  })

  it('states the balances owed in yuan', () => {
    render(<FinanceTab data={earned()} />)
    const owed = screen.getByText('Balances owed').closest('dl') as HTMLElement
    expect(within(owed).getByText('¥50')).toBeInTheDocument()
    expect(
      within(owed).getByText('1 customers · paid ¥40 · debt ¥0.5')
    ).toBeInTheDocument()
  })

  it('reads out each day’s revenue earned beside what was consumed', () => {
    render(<FinanceTab data={earned()} />)
    const chart = screen.getByRole('list', { name: 'Daily revenue' })
    const bars = chart.querySelectorAll('[tabindex="0"]')
    expect(bars).toHaveLength(2)
    expect(bars[0].getAttribute('aria-label')).toMatch(
      /Revenue earned ¥10\.8,.*Consumed at list price ¥16/
    )
  })
})

function finance(engine: EngineDailyCost): FinanceInsights {
  return {
    revenue: 0,
    topup_revenue: 0,
    subscription_revenue: 0,
    orders: 0,
    paying_users: 0,
    methods: [],
    daily: [
      {
        day: 1761408000,
        topup: 0,
        subscription: 0,
        consumption_usd: 90,
        claude_usd: 80,
      },
      {
        day: 1761494400,
        topup: 0,
        subscription: 0,
        consumption_usd: 130,
        claude_usd: 120,
      },
    ],
    consumption_usd: 220,
    claude_usd: 200,
    revenue_per_usd: 0,
    liability_usd: 0,
    liability_users: 0,
    debt_usd: 0,
    debtors: [],
    top_balances: [],
    adjustments: [],
    adjustment_net_usd: 0,
    commission_usd: 0,
    redemption_usd: 0,
    bonus_usd: 0,
    topup_credit_usd: 0,
    engine_cost: engine,
    matched_official_usd: 100,
    matched_claude_usd: 200,
    official_per_usd: 0.5,
    plans: [
      {
        plan: 'Pro',
        tier: 'default_claude_ai',
        accounts: 3,
        measured: 2,
        week_usd: 250,
        week_low_usd: 240,
        week_high_usd: 260,
      },
    ],
  }
}

const engine: EngineDailyCost = {
  configured: true,
  cost_usd: 100,
  requests: 9,
  // The engine leaves out a day with no Claude requests.
  daily: [{ day: 1761494400, cost_usd: 60, requests: 9 }],
}

describe('Claude at official prices on the funds view', () => {
  it('states the multiple of official prices new-api charges', () => {
    render(<FinanceTab data={finance(engine)} />)
    expect(screen.getByText('2.00×')).toBeInTheDocument()
    expect(
      screen.getByText('Each $1 at official prices is charged $2.00 (¥2).')
    ).toBeInTheDocument()
  })

  it('converts a plan’s weekly official value into new-api dollars', () => {
    render(<FinanceTab data={finance(engine)} />)
    const row = screen.getByRole('row', { name: /default_claude_ai/ })
    const cells = within(row).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Prodefault_claude_ai',
      '2 / 3',
      '$250.00 ($240–$260)',
      '$500.00 (¥500)',
      '$2,142.86 (¥2,142.86)',
      '107.14×',
    ])
  })

  it('shows the engine’s error and no conversion when the read failed', () => {
    render(
      <FinanceTab
        data={finance({
          ...engine,
          error: 'engine /usage/daily returned HTTP 503',
        })}
      />
    )
    expect(
      screen.getByText('engine /usage/daily returned HTTP 503')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('list', {
        name: 'Daily Claude usage: new-api against gpt-load',
      })
    ).toBeNull()
    const row = screen.getByRole('row', { name: /default_claude_ai/ })
    expect(within(row).getAllByRole('cell')[3].textContent).toBe('-')
  })

  it('compares each day’s new-api charge with gpt-load’s official cost', () => {
    render(<FinanceTab data={finance(engine)} />)
    const chart = screen.getByRole('list', {
      name: 'Daily Claude usage: new-api against gpt-load',
    })
    const bars = chart.querySelectorAll('[tabindex="0"]')
    expect(bars).toHaveLength(2)
    expect(bars[0].getAttribute('aria-label')).toMatch(
      /new-api Claude charge \$80\.00.*gpt-load official cost \$0\.00.*new-api ÷ official -/
    )
    expect(bars[1].getAttribute('aria-label')).toMatch(
      /new-api Claude charge \$120\.00.*gpt-load official cost \$60\.00.*new-api ÷ official 2\.00×.*Claude requests 9/
    )
    expect(bars[1].getAttribute('aria-label')).not.toMatch(/Total/)
  })
})

const end = 1761580800

/** The text of the figure card with this label. */
const figure = (label: string) =>
  screen
    .getAllByText(label)
    .map((node) => node.closest('[data-slot=card]'))
    .find(Boolean)?.textContent

function priced(days: number, coveredDays: number): FinanceInsights {
  return {
    ...finance(engine),
    start_time: end - days * 86400,
    end_time: end,
    matched_since: end - coveredDays * 86400,
    plan_accounts: [
      { plan: 'Max', tier: 'default_claude_max_20x', accounts: 1, eligible: 1 },
      // Gemini reports a Pro plan with no tier: not a Claude account.
      { plan: 'Pro', tier: '', accounts: 2, eligible: 2 },
      { plan: 'Pro', tier: 'default_claude_ai', accounts: 3, eligible: 2 },
      { plan: 'Team', tier: 'team_tier_1', accounts: 1, eligible: 1 },
    ],
  }
}

describe('account cost on the funds view', () => {
  it('spreads the monthly price of priced accounts over the range', () => {
    render(<FinanceTab data={priced(1, 1)} />)
    // Three Pro at $20 and one Team Tier 1 at $125: $185 a month.
    expect(figure('Account cost in this range')).toBe(
      'Account cost in this range$6.17$185 a month ÷ 30 × 1 days · 4 accounts'
    )
    expect(
      screen.getByText('4 accounts cost $185.00 a month, $6.17 a day.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 accounts have no known price and are not counted.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '2 accounts of other vendors, or whose plan the engine has not read, are left out.'
      )
    ).toBeInTheDocument()
  })

  it('lists each plan with its price and what it costs', () => {
    render(<FinanceTab data={priced(7, 7)} />)
    const cells = (name: RegExp) =>
      within(screen.getAllByRole('row', { name })[0])
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    expect(cells(/team_tier_1/)).toEqual([
      'Team Tier 1team_tier_1',
      '1',
      '1',
      '$125',
      '$125.00',
      '$29.17',
    ])
    expect(cells(/default_claude_max_20x/)).toEqual([
      'Maxdefault_claude_max_20x',
      '1',
      '1',
      'No price',
      '-',
      '-',
    ])
  })

  it('lists Claude’s plans only, priced first and dearest first', () => {
    render(<FinanceTab data={priced(7, 7)} />)
    const table = screen
      .getByText('Price per month')
      .closest('table') as HTMLElement
    const plans = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(plans).toEqual([
      'Team Tier 1team_tier_1',
      'Prodefault_claude_ai',
      'Maxdefault_claude_max_20x',
    ])
  })

  it('sets the ratios against the cost of the days gpt-load reported', () => {
    render(<FinanceTab data={priced(7, 2)} />)
    expect(
      screen.getByText(
        'gpt-load reported 2 of 7 days; every ratio uses those days.'
      )
    ).toBeInTheDocument()
    // Two days cost $12.33: $100 official is 8.11×, $200 charged 16.22×.
    expect(figure('Official ÷ account cost')).toMatch(
      /Official ÷ account cost8\.11×/
    )
    expect(figure('new-api ÷ account cost')).toMatch(
      /new-api ÷ account cost16\.22×/
    )
    expect(figure('Account cost in this range')).toMatch(/\$43\.17/)
  })

  it('reads out each day’s account cost beside the two charges', () => {
    render(<FinanceTab data={priced(7, 7)} />)
    const chart = screen.getByRole('list', {
      name: 'Daily Claude usage: new-api against gpt-load',
    })
    const bars = chart.querySelectorAll('[tabindex="0"]')
    expect(bars[1].getAttribute('aria-label')).toMatch(
      /Account cost per day \$6\.17.*Official ÷ account cost 9\.73×/
    )
  })

  it('shows no cost before the server reports the pool’s accounts', () => {
    render(<FinanceTab data={finance(engine)} />)
    expect(screen.getByText('No accounts in the pool')).toBeInTheDocument()
    const chart = screen.getByRole('list', {
      name: 'Daily Claude usage: new-api against gpt-load',
    })
    expect(
      chart.querySelector('[tabindex="0"]')?.getAttribute('aria-label')
    ).not.toMatch(/Account cost per day/)
  })
})

function vendors(): FinanceInsights {
  const data = finance(engine)
  data.daily[0].vendor_usd = { claude: 80, codex: 12 }
  data.daily[1].vendor_usd = { claude: 120, codex: 18, grok: 5 }
  data.vendor_models = [
    { vendor: 'claude', model: 'claude-opus-5-5', usd: 200, requests: 40 },
    { vendor: 'codex', model: 'gpt-6-sol', usd: 24, requests: 12 },
    { vendor: 'codex', model: 'codex-auto-review', usd: 6, requests: 30 },
    { vendor: 'grok', model: 'grok-4.7', usd: 5, requests: 2 },
  ]
  return data
}

describe('usage by vendor on the funds view', () => {
  it('names each vendor with its charge and opens on Claude', () => {
    render(<FinanceTab data={vendors()} />)
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Claude$200', 'Codex$30', 'Grok$5', 'Gemini$0'])
    expect(screen.getByText('Account cost in this range')).toBeInTheDocument()
  })

  it('shows only new-api’s charge for a vendor without account cost', async () => {
    render(<FinanceTab data={vendors()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Codex/ }))
    expect(await screen.findByText('Codex: new-api usage')).toBeInTheDocument()
    expect(figure('Requests')).toBe('Requests42')
    expect(figure('Charge per request')).toBe(
      'Charge per request$0.7143(¥0.7143)'
    )
    expect(figure('Share of all new-api charge')).toBe(
      'Share of all new-api charge12.8%'
    )
    expect(screen.queryByText('Account cost in this range')).toBeNull()
    const cells = within(screen.getByRole('row', { name: /gpt-6-sol/ }))
      .getAllByRole('cell')
      .map((cell) => cell.textContent)
    expect(cells).toEqual([
      'gpt-6-sol',
      '12',
      '$2.00 (¥2)',
      '$24.00 (¥24)',
      '80%',
    ])
    const bars = screen
      .getByRole('list', { name: 'Daily Codex charge' })
      .querySelectorAll('[tabindex="0"]')
    expect(bars[1].getAttribute('aria-label')).toMatch(
      /new-api charge \$18\.00/
    )
  })

  it('adds a tab for unrecognised models only when they were charged for', () => {
    const data = vendors()
    data.vendor_models = [
      ...(data.vendor_models ?? []),
      { vendor: 'other', model: 'opus', usd: 3, requests: 1 },
    ]
    render(<FinanceTab data={data} />)
    expect(
      screen.getByRole('tab', { name: /Other models/ })
    ).toBeInTheDocument()
    cleanup()
    render(<FinanceTab data={vendors()} />)
    expect(screen.queryByRole('tab', { name: /Other models/ })).toBeNull()
  })
})

describe('new-api’s charge in dollars', () => {
  // Customers pay ¥1 for each new-api dollar: at 6.8 yuan to the dollar,
  // the $200 new-api counted for Claude is ¥200, or $29.41.
  const yuan = (rate?: number) => ({
    ...priced(7, 7),
    usd_exchange_rate: rate,
  })

  it('shows the charge in dollars with the yuan beside it', () => {
    render(<FinanceTab data={yuan(6.8)} />)
    expect(figure('new-api Claude charge')).toBe(
      'new-api Claude charge$29.41(¥200)'
    )
  })

  it('compares the dollars with the official cost and the account cost', () => {
    render(<FinanceTab data={yuan(6.8)} />)
    // $29.41 against $100 official, and against $43.17 of accounts.
    expect(figure('new-api ÷ official')).toMatch(/0\.29×/)
    expect(figure('Official ÷ account cost')).toMatch(/2\.32×/)
    expect(figure('new-api ÷ account cost')).toMatch(/0\.68×/)
    const bars = screen
      .getByRole('list', {
        name: 'Daily Claude usage: new-api against gpt-load',
      })
      .querySelectorAll('[tabindex="0"]')
    expect(bars[1].getAttribute('aria-label')).toMatch(
      /new-api Claude charge \$17\.65 \(¥120\).*new-api ÷ official 0\.29×/
    )
  })

  it('converts each vendor’s charge the same way', () => {
    const data = { ...vendors(), usd_exchange_rate: 6.8 }
    render(<FinanceTab data={data} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Claude$29',
      'Codex$4',
      'Grok$1',
      'Gemini$0',
    ])
    fireEvent.click(screen.getByRole('tab', { name: /Codex/ }))
    expect(figure('new-api charge')).toBe('new-api charge$4.41(¥30)')
    // ¥30 over 42 requests is ¥0.7143, or $0.105.
    expect(figure('Charge per request')).toBe(
      'Charge per request$0.105(¥0.7143)'
    )
  })

  it('uses the site’s rate until the server sends one', () => {
    const before = useSystemConfigStore.getState().config.currency
    useSystemConfigStore.setState((state) => ({
      config: {
        ...state.config,
        currency: { ...before, usdExchangeRate: 6.8 },
      },
    }))
    try {
      render(<FinanceTab data={yuan(undefined)} />)
      expect(figure('new-api Claude charge')).toBe(
        'new-api Claude charge$29.41(¥200)'
      )
    } finally {
      useSystemConfigStore.setState((state) => ({
        config: { ...state.config, currency: before },
      }))
    }
  })
})
