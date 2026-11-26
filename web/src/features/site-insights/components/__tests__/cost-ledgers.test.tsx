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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  saveCommissionExempt,
  saveIPCosts,
  savePaymentFeeRates,
} from '../../api'
import type { FinanceInsights } from '../../types'
import {
  CommissionExemptPanel,
  IPCostsPanel,
  PaymentFeesPanel,
} from '../cost-ledgers'

vi.mock('../../api', () => ({
  saveIPCosts: vi.fn(),
  saveCommissionExempt: vi.fn(),
  savePaymentFeeRates: vi.fn(),
}))

function withQuery(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

const finance = {
  commission_usd: 11729,
  commission_exempt_usd: 10618,
  commission_exempt: [{ user_id: 306, username: 'magpie' }],
  ip_cost_cny: 149,
  ip_cost_usd: 30,
  ip_costs: [
    {
      name: 'sixtynet #3937',
      amount: 90,
      currency: 'USD',
      cycle_months: 3,
      start: 1761955200,
      end: 0,
      note: '',
    },
  ],
} as unknown as FinanceInsights

describe('IPCostsPanel', () => {
  it('lists each entry with its monthly share of the cycle price', () => {
    render(withQuery(<IPCostsPanel data={finance} />))
    expect(screen.getByText('sixtynet #3937')).toBeInTheDocument()
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells).toContain('3-month cycle')
    expect(cells.filter((text) => text?.startsWith('$'))).toEqual([
      '$90.00',
      '$30.00',
    ])
  })

  it('saves a new entry after the stored ones', async () => {
    const user = userEvent.setup()
    vi.mocked(saveIPCosts).mockResolvedValue(undefined)
    const { container } = render(withQuery(<IPCostsPanel data={finance} />))
    const [name, price, start] = [
      ...container.querySelectorAll('input'),
    ] as HTMLInputElement[]
    await user.type(name, 'aaitr #6756')
    await user.type(price, '149')
    await user.type(start, '2026-11-01')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    const saved = vi.mocked(saveIPCosts).mock.calls[0][0]
    expect(saved).toHaveLength(2)
    expect(saved[1]).toMatchObject({
      name: 'aaitr #6756',
      amount: 149,
      currency: 'CNY',
      cycle_months: 1,
      end: 0,
    })
  })

  it('cannot save over a list a server before this release did not send', () => {
    render(withQuery(<IPCostsPanel data={{} as FinanceInsights} />))
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })
})

describe('CommissionExemptPanel', () => {
  it('names the exempt accounts and adds one by user id', async () => {
    const user = userEvent.setup()
    vi.mocked(saveCommissionExempt).mockResolvedValue(undefined)
    const { container } = render(
      withQuery(<CommissionExemptPanel data={finance} />)
    )
    expect(screen.getByText(/magpie/)).toBeInTheDocument()
    const input = container.querySelector('input') as HTMLInputElement
    await user.type(input, '964')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(vi.mocked(saveCommissionExempt).mock.calls[0][0]).toEqual([306, 964])
  })
})

describe('PaymentFeesPanel', () => {
  const fees = {
    payment_fee_rates: [
      { method: 'alipay', percent: 8.11, fixed: 0 },
      { method: 'stripe_card', percent: 3.9, fixed: 2.16 },
      { method: 'offline', percent: 0, fixed: 0 },
    ],
    payment_fees: [
      {
        method: 'stripe_card',
        orders: 1,
        money: 200,
        refunded: 1,
        fee: 23.82,
        priced: true,
      },
      {
        method: 'nowpayments',
        orders: 2,
        money: 80,
        refunded: 0,
        fee: 0,
        priced: false,
      },
    ],
  } as unknown as FinanceInsights

  it('shows each method’s fee and rate, and names the unpriced ones', () => {
    render(withQuery(<PaymentFeesPanel data={fees} />))
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells).toContain('1 + 1 refunded')
    expect(cells).toContain('3.9% + ¥2.16')
    expect(cells).toContain('No rate')
    // Rates with no orders in the range are still listed, to be edited.
    expect(cells).toContain('8.11%')
    expect(screen.getByText(/No rate is recorded for/)).toBeInTheDocument()
  })

  it('replaces a method’s rate when one is saved for it', async () => {
    const user = userEvent.setup()
    vi.mocked(savePaymentFeeRates).mockResolvedValue(undefined)
    const { container } = render(withQuery(<PaymentFeesPanel data={fees} />))
    const [method, percent, fixed] = [
      ...container.querySelectorAll('input'),
    ] as HTMLInputElement[]
    await user.type(method, 'alipay')
    await user.type(percent, '6')
    await user.type(fixed, '0.5')
    await user.click(screen.getByRole('button', { name: 'Save rate' }))
    expect(vi.mocked(savePaymentFeeRates).mock.calls[0][0]).toEqual([
      { method: 'stripe_card', percent: 3.9, fixed: 2.16 },
      { method: 'offline', percent: 0, fixed: 0 },
      { method: 'alipay', percent: 6, fixed: 0.5 },
    ])
  })
})
