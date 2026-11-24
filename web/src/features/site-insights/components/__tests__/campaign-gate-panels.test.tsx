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
import { describe, expect, it } from 'vitest'

import {
  campaignConversion,
  campaignMultiple,
  campaignReturn,
  campaignScale,
  funnelSteps,
  gateMistakeRate,
  gatedRequests,
  newcomerNet,
  orderedCampaigns,
} from '../../campaign-analysis'
import type { CampaignInsights, CampaignRow, GateInsights } from '../../types'
import { CampaignRoiPanel } from '../campaign-roi'
import { GateEffectPanel } from '../risk-gate-effect'

const DAY = 86400
const START = 1761408000

function row(kind: string, overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    kind,
    cost_usd: 0,
    given_usd: 0,
    used_usd: 0,
    lying_usd: 0,
    lapsed_usd: 0,
    recipients: 0,
    payers: 0,
    paid_money: 0,
    pack_money: 0,
    ...overrides,
  }
}

const campaigns: CampaignInsights = {
  rows: [
    row('raffle', { cost_usd: 5, recipients: 1 }),
    row('newcomer_plan', {
      cost_usd: 53,
      recipients: 2,
      payers: 1,
      paid_money: 50,
      pack_money: 59.8,
    }),
    row('manual_other', { cost_usd: 20, recipients: 1 }),
  ],
  total: row('total', {
    cost_usd: 58,
    recipients: 3,
    payers: 1,
    paid_money: 50,
    pack_money: 59.8,
  }),
  newcomer: {
    bought: 2,
    used_up: 1,
    repaid: 1,
    repaid_after_used_up: 1,
    pack_money: 59.8,
    repaid_money: 50,
    given_usd: 100,
    used_usd: 53,
    price_money: 29.9,
  },
}

const newcomer = campaigns.newcomer as NonNullable<CampaignInsights['newcomer']>

const gate: GateInsights = {
  days: [
    {
      day: START,
      wallet: 3,
      other_plan: 0,
      refused: 1,
      wallet_usd: 6,
      users: 3,
      exits: 0,
    },
    {
      day: START + DAY,
      wallet: 1,
      other_plan: 1,
      refused: 0,
      wallet_usd: 5,
      users: 2,
      exits: 2,
    },
  ],
  exits: [{ kind: 'crowd', requests: 1, users: 1 }],
  wallet: 4,
  other_plan: 1,
  refused: 1,
  wallet_usd: 11,
  users: 4,
  crowd: {
    accounts: 2,
    gated: 2,
    granted_usd: 100,
    used_usd: 50,
    unused_usd: 50,
  },
  exemptions: {
    accounts: 1,
    in_range: 1,
    gated: 1,
    wallet_before_usd: 3,
    refunded_usd: 4,
  },
}

describe('campaign analysis', () => {
  it('measures return as payments plus a newcomer plan’s own price, over the cost', () => {
    const plan = campaigns.rows[1]
    expect(campaignReturn(plan)).toBeCloseTo(109.8)
    expect(campaignMultiple(plan)).toBeCloseTo(109.8 / 53)
    expect(campaignConversion(plan)).toBe(0.5)
  })

  it('has no ratio without a cost or recipients, never infinity', () => {
    expect(campaignMultiple(row('x', { paid_money: 10 }))).toBeNull()
    expect(campaignConversion(row('x'))).toBeNull()
  })

  it('lists kinds in the panel’s order and leaves out a kind not sent', () => {
    expect(orderedCampaigns(campaigns).map((r) => r.kind)).toEqual([
      'newcomer_plan',
      'raffle',
      'manual_other',
    ])
    expect(orderedCampaigns(undefined)).toEqual([])
  })

  it('scales the bars to the largest figure on either side', () => {
    expect(campaignScale(campaigns.rows)).toBeCloseTo(109.8)
    expect(campaignScale([])).toBe(0)
  })

  it('steps the newcomer funnel against the buyers, empty without buyers', () => {
    expect(funnelSteps(newcomer)).toEqual([
      { key: 'bought', count: 2, share: 1 },
      { key: 'used_up', count: 1, share: 0.5 },
      { key: 'repaid', count: 1, share: 0.5 },
    ])
    expect(funnelSteps(undefined)).toEqual([])
    expect(funnelSteps({ ...newcomer, bought: 0 })).toEqual([])
    expect(newcomerNet(newcomer)).toBeCloseTo(59.8 + 50 - 53)
  })

  it('counts every gated request and the mistake rate over the accounts acted on', () => {
    expect(gatedRequests(gate)).toBe(6)
    expect(gateMistakeRate(gate)).toBe(0.25)
    expect(gateMistakeRate({ ...gate, users: 0 })).toBeNull()
  })
})

describe('CampaignRoiPanel', () => {
  it('shows the totals, each campaign’s bars and the newcomer funnel', () => {
    render(<CampaignRoiPanel data={campaigns} />)
    expect(screen.getByText('Campaign payback')).toBeInTheDocument()
    expect(
      screen.getByText(
        /reached 3 people in this range; 1 of them paid .*50.* afterwards\./
      )
    ).toBeInTheDocument()
    expect(screen.getAllByText('Newcomer plan').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Raffle prize ($5)').length).toBeGreaterThan(0)
    // Compensation is shown, and marked as outside the total.
    expect(
      screen.getAllByText('Other hand credits (compensation)').length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText(/→.*not in the total/).length).toBe(1)
    const funnel = screen.getByLabelText('Newcomer plan funnel')
    expect(within(funnel).getByText('Bought the plan')).toBeInTheDocument()
    expect(
      within(funnel).getByText('Paid again after buying')
    ).toBeInTheDocument()
  })

  it('says the figures could not be read, with no zeros, when the read failed', () => {
    render(
      <CampaignRoiPanel
        data={undefined}
        source={{ status: 'error' } as never}
      />
    )
    expect(screen.getByText('Could not be read')).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Newcomer plan funnel')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows placeholders, not zero, while loading', () => {
    const { container } = render(<CampaignRoiPanel data={undefined} />)
    expect(screen.queryByText('Could not be read')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(4)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('says no campaign reached anyone on an empty range', () => {
    render(<CampaignRoiPanel data={{ rows: [], total: row('total') }} />)
    expect(
      screen.getByText('No campaign reached anyone in this range.')
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Newcomer plan funnel')
    ).not.toBeInTheDocument()
  })
})

describe('GateEffectPanel', () => {
  it('leads with the one-line conclusion and lists the shared exits', () => {
    render(
      <GateEffectPanel
        data={gate}
        range={{ start: START, end: START + 2 * DAY, days: 2, hourly: false }}
      />
    )
    expect(screen.getByText('Newcomer plan gate')).toBeInTheDocument()
    expect(
      screen.getByText(/acted on 4 accounts in 6 requests/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/1 accounts it acted on were exempted.*\(25%\)/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Used by many accounts without the plan 1/)
    ).toBeInTheDocument()
    expect(screen.getByText('Exempted as mistakes')).toBeInTheDocument()
  })

  it('says so when no shared exit was let through', () => {
    render(<GateEffectPanel data={{ ...gate, exits: [] }} />)
    expect(
      screen.getByText('No shared exit was let through in this range.')
    ).toBeInTheDocument()
  })

  it('shows the error state, not zeros, when the read failed', () => {
    render(
      <GateEffectPanel data={undefined} source={{ status: 'error' } as never} />
    )
    expect(screen.getByText('Could not be read')).toBeInTheDocument()
    expect(
      screen.queryByText('Requests the gate acted on')
    ).not.toBeInTheDocument()
  })
})
