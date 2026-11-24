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

import { ModelMarginPanel } from '../components/finance-model-margin'
import { UpstreamRunwayCards } from '../components/upstream-runway-cards'
import type {
  FinanceInsights,
  ModelAllocation,
  UpstreamAccount,
  UpstreamRunway,
} from '../types'

function alloc(over: Partial<ModelAllocation>): ModelAllocation {
  return {
    model: 'm',
    kind: 'model',
    vendor: 'claude',
    requests: 10,
    revenue_usd: 100,
    costed_revenue_usd: 100,
    bill_usd: 20,
    fee_usd: 0,
    pool_share: null,
    ...over,
  }
}

function finance(allocations: ModelAllocation[] | null | undefined) {
  return {
    start_time: 0,
    end_time: 30 * 86400,
    usd_exchange_rate: 7,
    vendor_revenue: [],
    plan_accounts: [],
    vendor_upstream: [],
    upstream_unattributed_bill_usd: 0,
    upstream_unattributed_fee_usd: 0,
    model_allocations: allocations,
  } as unknown as FinanceInsights
}

describe('ModelMarginPanel', () => {
  it('draws the scatter, the contribution bars and a table row per model', () => {
    render(
      <ModelMarginPanel
        data={finance([
          alloc({ model: 'gpt-6', vendor: 'codex', requests: 900 }),
          alloc({ model: 'claude-opus', revenue_usd: 400, bill_usd: 40 }),
          alloc({
            model: 'loser',
            revenue_usd: 10,
            costed_revenue_usd: 10,
            bill_usd: 30,
          }),
        ])}
      />
    )
    expect(screen.getByText('Model margin')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Charge against margin rate by model' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Margin by model' })
    ).toBeInTheDocument()
    expect(screen.getAllByText('gpt-6').length).toBeGreaterThan(0)
    expect(screen.getAllByText('claude-opus').length).toBeGreaterThan(0)
    expect(screen.getByText(/Losing money: loser/)).toBeInTheDocument()
  })

  it('marks a model with no cost as cost unknown and states the coverage', () => {
    render(
      <ModelMarginPanel
        data={finance([
          alloc({ model: 'known', revenue_usd: 90, costed_revenue_usd: 90 }),
          alloc({
            model: 'blind',
            revenue_usd: 10,
            costed_revenue_usd: 0,
            bill_usd: 0,
          }),
        ])}
      />
    )
    expect(screen.getAllByText('Cost unknown').length).toBeGreaterThan(0)
    expect(screen.getByText(/with a known cost \(/)).toBeInTheDocument()
    expect(
      screen.getByText(/charged on models with no known cost is left out/)
    ).toBeInTheDocument()
  })

  it('shows nothing on a server without the allocation, and skeletons while loading', () => {
    const { container, rerender } = render(
      <ModelMarginPanel data={finance(undefined)} />
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<ModelMarginPanel data={undefined} />)
    expect(screen.getByText('Model margin')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('names a failed read instead of loading forever', () => {
    render(
      <ModelMarginPanel
        data={undefined}
        source={{ status: 'error', error: 'boom' }}
      />
    )
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('says no model was charged for an empty allocation', () => {
    render(<ModelMarginPanel data={finance([])} />)
    expect(screen.getByText('Model margin')).toBeInTheDocument()
  })
})

function account(over: Partial<UpstreamAccount>): UpstreamAccount {
  return {
    host: 'usdj.example',
    channels: [7, 13],
    names: ['GPT a', 'GPT b'],
    balance: 208.59,
    balance_updated_at: 1700000000,
    balance_channel: 13,
    basis: 'request',
    spent_usd: 854,
    daily_usd: 122,
    daily: [100, 120, 90, 291, 80, 90, 83],
    days_left: 1.7,
    ...over,
  }
}

function runway(
  accounts: UpstreamAccount[],
  pools: UpstreamRunway['pools'] = []
): UpstreamRunway {
  return { days: 7, at: 1700000100, accounts, pools }
}

// The spend bars are list items too: take the account cards only.
const cardsOf = () => [
  ...screen
    .getByRole('list', { name: 'Upstream accounts' })
    .querySelectorAll(':scope > li'),
]

describe('UpstreamRunwayCards', () => {
  it('shows one card per account, the red one first, and lists the pool without days', () => {
    render(
      <UpstreamRunwayCards
        data={runway(
          [
            account({ host: 'sub.example', days_left: 17.9, daily_usd: 25 }),
            account({}),
          ],
          [
            {
              channel: 1,
              name: 'Claude pool',
              balance: 3200,
              balance_updated_at: 1700000000,
            },
          ]
        )}
      />
    )
    const cards = cardsOf()
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('usdj.example'),
      expect.stringContaining('sub.example'),
      expect.stringContaining('Claude pool'),
    ])
    expect(cards[0]).toHaveTextContent('1.7')
    expect(cards[0].className).toContain('border-destructive')
    expect(cards[1]).toHaveTextContent('18')
    expect(cards[1].className).not.toContain('border-destructive')
    expect(cards[2]).not.toHaveTextContent('days left')
  })

  it('marks under seven days yellow', () => {
    render(<UpstreamRunwayCards data={runway([account({ days_left: 5 })])} />)
    expect(cardsOf()[0].className).toContain('border-amber-500')
  })

  it('shows an account with no bill without days', () => {
    render(
      <UpstreamRunwayCards
        data={runway([
          account({ basis: 'none', days_left: null, daily: [], daily_usd: 0 }),
        ])}
      />
    )
    const card = cardsOf()[0]
    expect(card).not.toHaveTextContent('days left')
    expect(card.className).not.toContain('border-destructive')
  })

  it('names a failed read, and renders nothing for an empty runway', () => {
    const { container, rerender } = render(
      <UpstreamRunwayCards
        data={undefined}
        source={{ status: 'error', error: 'nope' }}
      />
    )
    expect(screen.getByText('nope')).toBeInTheDocument()
    rerender(<UpstreamRunwayCards data={runway([])} />)
    expect(container).toBeEmptyDOMElement()
  })
})
