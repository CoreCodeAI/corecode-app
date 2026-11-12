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

import { clientFamilies, vendorMargins } from '../../lib'
import type { BusinessInsights, FinanceInsights } from '../../types'
import { ReferralPanel, VendorMarginPanel } from '../business-panels'

// Thirty days at ¥7 a dollar: a $125 Team Tier 1 seat costs ¥875, and the
// $200 Codex account ¥1,400.
function finance(overrides: Partial<FinanceInsights> = {}): FinanceInsights {
  return {
    start_time: 0,
    end_time: 30 * 86400,
    usd_exchange_rate: 7,
    vendor_revenue: [
      {
        vendor: 'claude',
        customer_usd: 3000,
        share: 0.75,
        recognized_revenue: 3000,
      },
      {
        vendor: 'codex',
        customer_usd: 1000,
        share: 0.25,
        recognized_revenue: 1000,
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
      { vendor: 'codex', plan: '', tier: '', accounts: 1, eligible: 1 },
      { vendor: 'grok', plan: '', tier: '', accounts: 1, eligible: 1 },
    ],
    ...overrides,
  } as FinanceInsights
}

describe('vendor margins', () => {
  it('sets each vendor’s revenue against its accounts’ cost', () => {
    expect(vendorMargins(finance(), 7)).toEqual([
      {
        vendor: 'claude',
        revenue: 3000,
        cost: 1750,
        margin: 1250,
        accounts: 2,
        unpriced: 0,
      },
      {
        vendor: 'codex',
        revenue: 1000,
        cost: 1400,
        margin: -400,
        accounts: 1,
        unpriced: 0,
      },
      {
        vendor: 'grok',
        revenue: 0,
        cost: 0,
        margin: 0,
        accounts: 1,
        unpriced: 1,
      },
    ])
  })

  it('says where the money is made and lost', () => {
    render(<VendorMarginPanel data={finance()} />)
    expect(
      screen.getByText(
        'Earned ¥4,000 against ¥3,150 of accounts: gross margin ¥850 (21.3%). GPT loses ¥400. No price is recorded for the Grok accounts; they count as free.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('1 accounts, 1 unpriced')).toBeInTheDocument()
  })

  it('projects a range other than a month to 30 days', () => {
    // Seven days: ¥4,000 earned against ¥735 of accounts.
    render(<VendorMarginPanel data={finance({ end_time: 7 * 86400 })} />)
    expect(
      screen.getByText(
        /At this pace a 30-day month earns ¥17,142\.86 against ¥3,150 of accounts, margin ¥13,992\.86 \(projected from 7 days\)\./
      )
    ).toBeInTheDocument()
  })
})

describe('referrals', () => {
  it('returns invitees’ payments over the commission paid for them', () => {
    render(
      <ReferralPanel
        data={
          {
            inviters: 3,
            invitees: 12,
            invitee_spend_usd: 400,
            invitee_payments: 600,
            commission_usd: 200,
            commission_to_spend: 0.5,
            revenue: 6000,
            top_inviters: [],
            models: null,
            groups: [],
            clients: [],
            clients_truncated: false,
          } satisfies BusinessInsights
        }
      />
    )
    expect(
      screen.getByText(
        'Invitees paid ¥600, 10% of revenue. Commission of $200.00 returned 3×.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('3×')).toBeInTheDocument()
    expect(screen.getByText('50% of invitee consumption')).toBeInTheDocument()
  })
})

describe('client families', () => {
  it('counts requests by client across its versions', () => {
    expect(
      clientFamilies([
        { name: 'claude-cli/2.1.3', count: 5 },
        { name: 'codex_cli_rs/0.9', count: 4 },
        { name: 'claude-cli/2.1.2', count: 2 },
        { name: 'unknown', count: 1 },
      ])
    ).toEqual([
      { name: 'claude-cli', count: 7 },
      { name: 'codex_cli_rs', count: 4 },
      { name: 'unknown', count: 1 },
    ])
  })
})
