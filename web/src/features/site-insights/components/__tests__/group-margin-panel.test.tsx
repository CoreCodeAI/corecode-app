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
import { render as renderElement, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import type {
  FinanceInsights,
  GroupAllocation,
  GroupConsumption,
} from '../../types'
import { GroupConsumptionPanel } from '../finance-insights'

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderElement(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  )
}

const groups: GroupConsumption[] = [
  {
    group: 'Claude 满血',
    requests: 10,
    users: 2,
    tokens: 100,
    consumption_usd: 300,
    share: 0.75,
    ratio: 1,
    list_usd: 300,
    revenue_estimate: 0,
  },
  {
    group: 'GPT 福利',
    requests: 5,
    users: 1,
    tokens: 50,
    consumption_usd: 100,
    share: 0.25,
    ratio: 0.5,
    list_usd: 200,
    revenue_estimate: 0,
  },
]

// Claude's pool costs 280 yuan for the range (two Pro accounts at 7 yuan a
// dollar), split 0.75 and 0.25; GPT's bill is 10 and its fee 2 dollars.
const allocations: GroupAllocation[] = [
  {
    group: 'GPT 福利',
    kind: 'group',
    recognized_revenue: 80,
    bill_usd: 10,
    fee_usd: 2,
    pool_share: { claude: 0.25 },
  },
  {
    group: 'Claude 满血',
    kind: 'group',
    recognized_revenue: 400,
    bill_usd: 0,
    fee_usd: 0,
    pool_share: { claude: 0.75 },
  },
  {
    group: '',
    kind: 'staff',
    recognized_revenue: 0,
    bill_usd: 0,
    fee_usd: 0,
    pool_share: {},
  },
  {
    group: '',
    kind: 'unattributed',
    recognized_revenue: 20,
    bill_usd: 0,
    fee_usd: 0,
    pool_share: {},
  },
]

function data(extra: Partial<FinanceInsights>): FinanceInsights {
  return {
    start_time: 0,
    end_time: 30 * 86400,
    usd_exchange_rate: 7,
    vendor_revenue: [
      { vendor: 'claude', customer_usd: 0, share: 0, recognized_revenue: 480 },
      { vendor: 'codex', customer_usd: 0, share: 0, recognized_revenue: 20 },
    ],
    plan_accounts: [
      {
        vendor: 'claude',
        plan: 'Pro',
        tier: 'default_claude_ai',
        accounts: 2,
        eligible: 2,
      },
    ],
    vendor_upstream: [
      {
        vendor: 'codex',
        bill_usd: 10,
        fee_usd: 2,
        costed_revenue_usd: 80,
        uncosted_revenue_usd: 0,
        oldest_bill_at: 0,
        channels: [3],
      },
    ],
    upstream_unattributed_bill_usd: 0,
    upstream_unattributed_fee_usd: 0,
    groups,
    ...extra,
  } as unknown as FinanceInsights
}

describe('GroupConsumptionPanel margins', () => {
  it('names the best and worst groups and shows cost, margin and rate', () => {
    render(
      <GroupConsumptionPanel data={data({ group_allocations: allocations })} />
    )
    expect(
      screen.getByText(
        'Claude 满血 has the best gross margin, 47.5%; GPT 福利 the worst, -17.5%.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /Gross margin/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /Margin rate/ })
    ).toBeInTheDocument()

    const claude = screen.getByText('Claude 满血').closest('tr') as HTMLElement
    expect(within(claude).getByText('¥210')).toBeInTheDocument()
    expect(within(claude).getByText('¥190')).toBeInTheDocument()
    expect(within(claude).getByText('47.5%')).toBeInTheDocument()
    const gpt = screen.getByText('GPT 福利').closest('tr') as HTMLElement
    expect(within(gpt).getByText('¥94')).toBeInTheDocument()
    expect(within(gpt).getByText('-17.5%')).toBeInTheDocument()
  })

  it('sorts by revenue and mutes the staff and unattributed rows at the end', () => {
    render(
      <GroupConsumptionPanel data={data({ group_allocations: allocations })} />
    )
    const rows = screen.getAllByRole('row').slice(1)
    const names = rows.map((row) => row.textContent ?? '')
    expect(names[0]).toContain('Claude 满血')
    expect(names[1]).toContain('GPT 福利')
    expect(names[2]).toContain('Staff’s own use')
    expect(names[3]).toContain('Unattributed')
    expect(rows[0]).not.toHaveClass('text-muted-foreground')
    expect(rows[2]).toHaveClass('text-muted-foreground')
    expect(rows[3]).toHaveClass('text-muted-foreground')
    expect(within(rows[2]).getAllByText('-').length).toBeGreaterThan(0)
  })

  it('keeps the usage columns and no margin on a server that sends no allocations', () => {
    render(<GroupConsumptionPanel data={data({})} />)
    expect(
      screen.queryByRole('columnheader', { name: /Gross margin/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /Revenue \(est\.\)/ })
    ).toBeInTheDocument()
  })

  it('hides the panel on a server that sends no groups', () => {
    const { container } = render(
      <GroupConsumptionPanel
        data={data({ groups: undefined, group_allocations: allocations })}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
