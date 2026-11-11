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

import {
  balanceRunway,
  bestWholeDay,
  claudeEarned,
  financeDrivers,
  financeMargins,
  groupRows,
  monthProjection,
  orderFunnels,
  ordersComparable,
  owedNow,
  peakHour,
  planBookTotals,
  poolUse,
  spendFlags,
} from '../../finance-analysis'
import type { InsightsSources } from '../../lib'
import type {
  BusinessInsights,
  EngineDailyCost,
  FinanceHour,
  FinanceInsights,
  OrderMethodFunnel,
  PlanBookRow,
  UserSpendRow,
} from '../../types'
import { ModelMixPanel } from '../business-panels'
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

  it('divides revenue earned by customers’ consumption, root left out', () => {
    render(<FinanceTab data={earned()} />)
    // ¥17.6 earned over customers’ ¥25 (root’s ¥30 left out); paid use over
    // the ¥17 paid part, cash basis the ¥14 paid in the range over ¥25.
    const ratio = screen
      .getByText('Earned per ¥1 consumed')
      .closest('dl') as HTMLElement
    expect(within(ratio).getByText(/^¥0\.70/)).toBeInTheDocument()
    expect(
      screen.getByText(/^Paid use ¥1\.0\d* · cash basis ¥0\.56$/)
    ).toBeInTheDocument()
  })

  it('states the balances owed in yuan', () => {
    render(<FinanceTab data={earned()} />)
    const owed = screen.getByText('Balances owed').closest('dl') as HTMLElement
    expect(within(owed).getByText('¥50')).toBeInTheDocument()
    expect(
      within(owed).getByText('1 customers · deferred revenue ¥40 · debt ¥0.5')
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

const hour = (index: number) => 1761580800 + index * 3600

function hourRow(index: number, topup: number): FinanceHour {
  return {
    hour: hour(index),
    topup,
    subscription: 0,
    consumption_usd: 2,
    root_consumption_usd: 1,
  }
}

describe('a short range on the funds view', () => {
  // Three hours, the last still open; it took the most but is not the peak.
  const hourly = (): FinanceInsights => ({
    ...earned(),
    start_time: hour(0),
    end_time: hour(2) + 1800,
    hourly: [hourRow(0, 5), hourRow(1, 9), hourRow(2, 40)],
  })
  const range = {
    start: hour(0),
    end: hour(2) + 1800,
    days: 2.5 / 24,
    hourly: true,
  }

  it('draws revenue by the hour and names the peak closed hour', () => {
    render(<FinanceTab data={hourly()} range={range} />)
    const bars = screen
      .getByRole('list', { name: 'Hourly revenue' })
      .querySelectorAll('[tabindex="0"]')
    expect(bars).toHaveLength(3)
    expect(bars[0].getAttribute('aria-label')).toMatch(
      /Consumed at list price ¥3/
    )
    expect(screen.getByText(/^Peak hour .*: ¥9\.$/)).toBeInTheDocument()
    expect(screen.queryByText(/^Best day/)).toBeNull()
  })

  it('keeps the daily chart when the server sends no hours', () => {
    render(<FinanceTab data={earned()} range={range} />)
    expect(screen.getByRole('list', { name: 'Daily revenue' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Hourly revenue' })).toBeNull()
  })

  it('never calls a partial day the best day', () => {
    // The range starts an hour into the first day, the only one with money.
    const data = {
      ...earned(),
      start_time: day(0) + 3600,
      end_time: day(2),
    }
    render(<FinanceTab data={data} />)
    expect(screen.queryByText(/^Best day/)).toBeNull()
    cleanup()
    render(<FinanceTab data={{ ...data, start_time: day(0) }} />)
    expect(screen.getByText(/^Best day .*: ¥14\.$/)).toBeInTheDocument()
  })
})

describe('revenue over few orders', () => {
  it('reads the change as an amount with the order counts', () => {
    const previous = { ...earned(), revenue: 10, orders: 3 }
    render(<FinanceTab data={earned()} previous={previous} />)
    expect(screen.getByText('+¥4 on 3 → 1 orders')).toBeInTheDocument()
    expect(screen.getByText(/^Paid ¥14 \(\+¥4, 3 → 1 orders\)/)).toBeTruthy()
  })
})

describe('balances owed against customers’ paid use', () => {
  // ¥17 paid use over two days is ¥8.5 a day.
  const twoDays = (liability: number): FinanceInsights => ({
    ...earned(),
    start_time: day(0),
    end_time: day(2),
    liability_usd: liability,
  })

  it('states the runway and leaves a short one uncolored', () => {
    render(<FinanceTab data={twoDays(50)} />)
    const owed = screen.getByText('Balances owed').closest('dl') as HTMLElement
    expect(
      within(owed).getByText(
        'Covers 6 days of customers’ paid use at this range’s pace.'
      )
    ).toBeInTheDocument()
    expect(within(owed).getByText('¥50')).not.toHaveClass('text-amber-600')
  })

  it('colors a balance that covers over 60 days of paid use', () => {
    render(<FinanceTab data={twoDays(1000)} />)
    const owed = screen.getByText('Balances owed').closest('dl') as HTMLElement
    expect(within(owed).getByText('¥1,000')).toHaveClass('text-amber-600')
    expect(within(owed).getByText(/^Covers 118 days/)).toBeInTheDocument()
  })
})

describe('gift watch', () => {
  it('does not judge a gifted share over little consumption', () => {
    render(<FinanceTab data={earned()} />)
    expect(
      screen.getByText('Too little consumption to judge')
    ).toBeInTheDocument()
  })

  it('flags gifted use and unpaid credit, linked to where to look', () => {
    const onOpen = vi.fn()
    const data = {
      ...earned(),
      consumption_usd: 200,
      gift_consumption_usd: 80,
      bonus_usd: 30,
      topup_credit_usd: 50,
    }
    render(<FinanceTab data={data} onOpen={onOpen} />)
    expect(
      screen.getAllByText('Gifted credit is 40% of customers’ consumption.')
    ).not.toHaveLength(0)
    expect(
      screen.getByText('¥0.6 of unpaid credit was issued for each ¥1 paid.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Growth →' }))
    expect(onOpen).toHaveBeenCalledWith('growth')
  })
})

describe('the Claude pool against its measured capacity', () => {
  it('recommends fewer accounts when the pool is mostly idle', () => {
    render(<FinanceTab data={priced(7, 7)} />)
    // $100 over 7 days against 3 Pro at $250 a week: 13.3%.
    expect(
      screen.getByText(
        'The pool used 13.3% of its measured capacity, $14.29 a day at official prices of $107.14: fewer accounts would serve this use.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /^The accounts break even at \$6\.17 .* a day; it charged \$28\.57/
      )
    ).toBeInTheDocument()
  })

  it('says nothing while a plan’s capacity is unmeasured', () => {
    const data = priced(7, 7)
    data.plans = [{ ...data.plans[0], measured: 0 }]
    render(<FinanceTab data={data} />)
    expect(screen.queryByText(/measured capacity/)).toBeNull()
  })
})

describe('funds analysis', () => {
  it('names the model and payment method that drove a change', () => {
    const now = {
      ...earned(),
      revenue: 200,
      methods: [
        { payment_method: 'alipay', money: 180, count: 6 },
        { payment_method: 'stripe', money: 20, count: 1 },
      ],
      vendor_models: [
        { vendor: 'claude', model: 'claude-opus', usd: 300, requests: 9 },
        { vendor: 'codex', model: 'gpt-6', usd: 50, requests: 5 },
      ],
    }
    const before = {
      ...earned(),
      revenue: 100,
      methods: [
        { payment_method: 'alipay', money: 60, count: 2 },
        { payment_method: 'stripe', money: 40, count: 2 },
      ],
      vendor_models: [
        { vendor: 'claude', model: 'claude-opus', usd: 100, requests: 3 },
        { vendor: 'codex', model: 'gpt-6', usd: 60, requests: 6 },
      ],
    }
    const drivers = financeDrivers(now, before)
    expect(drivers?.consumption).toEqual({
      current: 350,
      previous: 160,
      change: 190,
    })
    expect(drivers?.consumptionBy).toEqual({
      kind: 'model',
      parts: [{ key: 'claude-opus', current: 300, previous: 100, change: 200 }],
    })
    expect(drivers?.revenueBy).toEqual([
      { key: 'alipay', current: 180, previous: 60, change: 120 },
    ])
    expect(financeDrivers(now, undefined)).toBeUndefined()
  })

  it('compares revenue in percent only over enough orders', () => {
    expect(ordersComparable(5, 5)).toBe(true)
    expect(ordersComparable(5, 4)).toBe(false)
    expect(ordersComparable(9, undefined)).toBe(false)
  })

  it('projects earned revenue, cost and margin to 30 days', () => {
    expect(monthProjection(100, 40, 2)).toEqual({
      revenue: 1500,
      cost: 600,
      margin: 900,
    })
  })

  it('sets the balance against paid use per day', () => {
    const data = { ...earned(), liability_usd: 85 }
    // ¥25 consumed less ¥8 gifted over 2 days: ¥8.5 a day.
    expect(balanceRunway(data, 2)).toBe(10)
    expect(balanceRunway({ ...data, gift_consumption_usd: 25 }, 2)).toBeNull()
    expect(balanceRunway(data, 0)).toBeNull()
  })

  it('picks the peak closed hour and the best whole day', () => {
    const rows = [hourRow(0, 5), hourRow(1, 9), hourRow(2, 40)]
    expect(peakHour(rows, hour(2) + 60)?.hour).toBe(hour(1))
    expect(peakHour([hourRow(0, 0)], hour(5))).toBeUndefined()
    const days = earned().daily
    expect(bestWholeDay(days)?.day).toBe(day(0))
    expect(bestWholeDay(days, day(0) + 1, day(2))).toBeUndefined()
  })

  it('reads the pool’s use against measured capacity', () => {
    const plan = {
      plan: 'Pro',
      tier: 'default_claude_ai',
      accounts: 2,
      measured: 2,
      week_usd: 70,
      week_low_usd: 70,
      week_high_usd: 70,
    }
    const input = {
      plans: [plan],
      officialUSD: 36,
      chargedUSD: 20,
      coveredDays: 2,
      costPerDayUSD: 4,
    }
    // $20 a day of capacity, $18 used: 90%.
    expect(poolUse(input)).toEqual({
      usedPerDay: 18,
      capacityPerDay: 20,
      utilisation: 0.9,
      breakEven: 4,
      chargedPerDay: 10,
      advice: 'more',
    })
    expect(poolUse({ ...input, officialUSD: 10 })?.advice).toBe('fewer')
    expect(poolUse({ ...input, officialUSD: 20 })?.advice).toBe('fits')
    expect(
      poolUse({ ...input, plans: [plan, { ...plan, measured: 0 }] })
    ).toBeNull()
  })

  it('flags a customer below cost, in debt or holding the window', () => {
    const row: UserSpendRow = {
      user_id: 1,
      username: 'a',
      email: '',
      requests: 1,
      quota_usd: 50,
      engine_usd: 16.5,
      topup_paid: 0,
      subscription_paid: 0,
      balance_usd: -2,
    }
    // ¥50 at ¥5 a dollar is $10, under $16.50.
    expect(spendFlags(row, 60, 5, true)).toEqual([
      'below_cost',
      'debt',
      'concentrated',
    ])
    expect(spendFlags({ ...row, balance_usd: -0.5 }, 1000, 5, false)).toEqual(
      []
    )
  })
})

describe('gross margin with upstream bills', () => {
  const end = 30 * 86400
  const data = {
    start_time: 0,
    end_time: end,
    usd_exchange_rate: 7,
    vendor_revenue: [
      {
        vendor: 'claude',
        customer_usd: 3000,
        share: 0.86,
        recognized_revenue: 3000,
      },
      {
        vendor: 'media',
        customer_usd: 500,
        share: 0.14,
        recognized_revenue: 500,
      },
    ],
    plan_accounts: [
      {
        vendor: 'claude',
        plan: 'Team',
        tier: 'team_tier_1',
        accounts: 2,
        eligible: 2,
      },
      { vendor: '', plan: 'Max', tier: '', accounts: 3, eligible: 3 },
    ],
    vendor_upstream: [
      {
        vendor: 'media',
        bill_usd: 200,
        fee_usd: 10,
        costed_revenue_usd: 500,
        uncosted_revenue_usd: 0,
        oldest_bill_at: end - 7200,
        channels: [9],
      },
    ],
    upstream_unattributed_bill_usd: 30,
    upstream_unattributed_fee_usd: 0,
  } as unknown as FinanceInsights

  it('subtracts bills one for one and fees at the rate, media in its own row', () => {
    const margins = financeMargins(data, 7)
    expect(margins.rows).toEqual([
      {
        vendor: 'claude',
        revenue: 3000,
        cost: 1750,
        margin: 1250,
        accounts: 2,
        unpriced: 0,
        accountCost: 1750,
        upstreamCost: 0,
      },
      {
        vendor: 'media',
        revenue: 500,
        cost: 270,
        margin: 230,
        accounts: 0,
        unpriced: 0,
        accountCost: 0,
        upstreamCost: 270,
      },
    ])
    expect(margins.cost).toBe(2050)
    expect(margins.margin).toBe(1450)
    expect(margins.unattributed).toBe(30)
    expect(margins.upstreamRead).toBe(true)
    expect(margins.ungroupedAccounts).toBe(3)
    expect(margins.staleBills).toEqual([{ vendor: 'media', at: end - 7200 }])
  })

  it('says only accounts are subtracted on a server without bills', () => {
    const margins = financeMargins(
      {
        ...data,
        vendor_upstream: undefined,
        upstream_unattributed_bill_usd: undefined,
      },
      7
    )
    expect(margins.upstreamRead).toBe(false)
    expect(margins.cost).toBe(1750)
  })

  it('names the bills, the free accounts and the stale read in the panel', () => {
    render(<FinanceTab data={{ ...earned(), ...data }} />)
    expect(
      screen.getByText(
        /^Earned ¥3,500 against ¥2,050 of accounts and upstream bills: gross margin ¥1,450 \(41\.4%\)\./
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '3 pool accounts have no recorded price or vendor and count as free: the margin reads high by what they cost.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^Upstream bills for Image and video were last read/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /^¥30 of upstream cost fell on channels no customer used/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^Account cost is today’s pool over all 30 days/)
    ).toBeInTheDocument()
  })
})

describe('checkouts, groups, plans and what is owed', () => {
  const funnel = (
    method: string,
    created: number,
    paid: number
  ): OrderMethodFunnel => ({
    payment_method: method,
    created,
    paid,
    failed: 0,
    expired: 0,
    pending: created - paid,
    pending_stale: 0,
    plan_orders: 0,
    paid_money: paid * 10,
    completion_rate: paid / created,
  })
  const group = {
    requests: 1,
    users: 1,
    tokens: 1,
    ratio: 0.8,
    list_usd: 0,
    revenue_estimate: 0,
  }

  it('flags a method whose completion halved over enough checkouts', () => {
    const rows = orderFunnels(
      [funnel('alipay', 10, 2), funnel('stripe', 4, 1), funnel('card', 3, 3)],
      [funnel('alipay', 10, 6), funnel('stripe', 10, 9)]
    )
    expect(
      rows.map((row) => [
        row.payment_method,
        row.fell,
        row.judged,
        row.previousRate,
      ])
    ).toEqual([
      ['alipay', true, true, 0.6],
      ['stripe', false, false, 0.9],
      ['card', false, false, null],
    ])
  })

  it('compares each group’s share with the previous period', () => {
    const [row] = groupRows(
      [{ ...group, group: 'gpt', consumption_usd: 60, share: 0.6 }],
      [{ ...group, group: 'gpt', consumption_usd: 40, share: 0.5 }]
    )
    expect(row.previousUsd).toBe(40)
    expect(row.shareChange).toBeCloseTo(0.1)
    expect(
      groupRows(
        [{ ...group, group: 'gpt', consumption_usd: 60, share: 0.6 }],
        undefined
      )[0].shareChange
    ).toBeNull()
  })

  const liability = {
    at: 0,
    deferred_value: 100,
    paid_plans: 3,
    paid_users: 3,
    unmatched: 1,
    gift_plans: 0,
    unlimited: 0,
    paid_quota_left_usd: 20,
    gift_quota_left_usd: 0,
    paid_period_left_usd: 5,
    gift_period_left_usd: 0,
  }

  it('adds running plans’ unrun share to the wallets’ deferred revenue', () => {
    expect(owedNow({ ...earned(), plan_liability: liability })).toEqual({
      wallets: 40,
      plans: 100,
      total: 140,
      planQuotaLeft: 25,
      paidPlans: 3,
      unmatched: 1,
    })
    expect(owedNow(earned())).toBeNull()
    render(<FinanceTab data={{ ...earned(), plan_liability: liability }} />)
    expect(
      screen.getByText(
        'Plans ¥100 not yet run on 3 paid plans, ¥25 of quota left · owed in all ¥140'
      )
    ).toBeInTheDocument()
  })

  const plan: PlanBookRow = {
    plan_id: 4,
    title: 'Monthly',
    price: 199,
    one_per_user: false,
    running_paid: 20,
    running_gifted: 2,
    sold: 5,
    sold_value: 995,
    renewed: 2,
    gifted: 1,
    expired: 3,
    expiring_7d: 4,
    expiring_7d_value: 796,
    deferred_value: 1990,
    finished_plans: 3,
    finished_used_share: 0.5,
  }

  it('sums the plan book and reads it in one sentence', () => {
    expect(planBookTotals([plan, plan]).deferred).toBe(3980)
    render(<FinanceTab data={{ ...earned(), plan_book: [plan] }} />)
    expect(
      screen.getByText(
        '20 paid plans running now, ¥1,990 not yet earned; 5 sold in the range for ¥995, 2 of them renewals; 4 end within 7 days (¥796).'
      )
    ).toBeInTheDocument()
  })

  it('shows the checkouts and groups panels only when the server sends them', () => {
    render(<FinanceTab data={earned()} />)
    expect(screen.queryByText('Checkouts by payment method')).toBeNull()
    expect(screen.queryByText('Use by group')).toBeNull()
    expect(screen.queryByText('Plan book')).toBeNull()
    cleanup()
    render(
      <FinanceTab
        data={{
          ...earned(),
          order_methods: [funnel('alipay', 10, 2)],
          groups: [
            { ...group, group: 'codex', consumption_usd: 60, share: 0.6 },
          ],
        }}
        previous={{
          ...earned(),
          order_methods: [funnel('alipay', 10, 6)],
          groups: [
            { ...group, group: 'codex', consumption_usd: 40, share: 0.5 },
          ],
        }}
      />
    )
    expect(screen.getByText('Checkouts by payment method')).toBeInTheDocument()
    expect(
      screen.getAllByText(
        /completed 20%, down from 60%: check the payment page\./
      )
    ).not.toHaveLength(0)
    expect(screen.getByText('+10 pt')).toBeInTheDocument()
  })
})

describe('Claude revenue earned against account cost', () => {
  it('prorates Claude’s earned revenue to the days gpt-load reported', () => {
    const data = {
      vendor_revenue: [
        {
          vendor: 'claude',
          customer_usd: 600,
          share: 1,
          recognized_revenue: 300,
        },
      ],
    } as FinanceInsights
    expect(claudeEarned(data, 2, 4)).toEqual({
      earnedYuan: 150,
      perCharge: 0.5,
    })
    expect(claudeEarned({} as FinanceInsights, 2, 4)).toBeNull()
  })
})

describe('a failed or loading read is not zero', () => {
  const failed: InsightsSources = {
    view: { status: 'error', error: 'timed out' },
    previous: { status: 'error' },
    business: { status: 'error', error: 'business timed out' },
  }

  it('says the funds view could not be read instead of none', () => {
    render(<FinanceTab data={undefined} sources={failed} />)
    expect(screen.queryByText('No customer owes money')).toBeNull()
    expect(screen.queryByText('No customer balances')).toBeNull()
    expect(screen.getAllByText('Could not be read').length).toBeGreaterThan(0)
    expect(screen.getAllByText('timed out').length).toBeGreaterThan(0)
    expect(screen.getByText('business timed out')).toBeInTheDocument()
    expect(screen.queryByText('¥0')).toBeNull()
  })

  it('shows the revenue by model loading, not empty', () => {
    render(
      <ModelMixPanel
        data={undefined as BusinessInsights | undefined}
        source={{ status: 'pending' }}
      />
    )
    expect(screen.queryByText('No consumption in this range')).toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
