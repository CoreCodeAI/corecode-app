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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { InvoiceForm } from '../components/invoice-form'
import type { InvoiceConfig, InvoiceableOrder } from '../types'

const config: InvoiceConfig = {
  enabled: true,
  tax_rate: 4,
  categories: ['软件开发服务'],
  order_days: 365,
  max_orders: 50,
  payment_timeout_minutes: 30,
  pay_methods: ['alipay', 'wxpay'],
  quota_per_yuan: 500000,
}

const orders: InvoiceableOrder[] = [
  {
    order_type: 'topup',
    order_id: 101,
    trade_no: 'USR11NOabc',
    amount_cents: 10000,
    paid_time: 1762800000,
    payment_method: 'alipay',
  },
  {
    order_type: 'subscription',
    order_id: 201,
    trade_no: 'SUB201',
    amount_cents: 990,
    paid_time: 1762800000,
    payment_method: 'wxpay',
  },
]

function renderForm(props: { balance: number; selected?: InvoiceableOrder[] }) {
  const onSubmitted = vi.fn()
  render(
    <InvoiceForm
      config={config}
      orders={props.selected ?? orders}
      defaultEmail='finance@example.com'
      balance={props.balance}
      onSubmitted={onSubmitted}
    />
  )
  return { onSubmitted }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('shows the invoice amount and the 4% tax on the selected orders', () => {
  renderForm({ balance: 5000000 })

  // English marks the yuan as CN¥, where a bare ¥ would read as yen.
  expect(screen.getByText('CN¥109.90')).toBeVisible()
  // The tax and the amount to pay are both ¥4.40 (439.6 fen rounded).
  expect(screen.getAllByText('CN¥4.40')).toHaveLength(2)
  expect(screen.getByText(/Deducts/)).toBeVisible()
})

it('a company title without a tax number is refused before it is sent', async () => {
  const post = vi.spyOn(api, 'post')
  renderForm({ balance: 5000000 })

  await userEvent.type(
    screen.getByLabelText(/Company name/),
    '示例科技有限公司'
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Submit and pay tax' })
  )

  expect(
    await screen.findByText('Enter a valid taxpayer identification number')
  ).toBeVisible()
  expect(post).not.toHaveBeenCalled()
})

it('submits the orders and the title with a balance-paid tax', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { invoice: { id: 7 } } },
  })
  const { onSubmitted } = renderForm({ balance: 5000000 })

  await userEvent.type(
    screen.getByLabelText(/Company name/),
    '示例科技有限公司'
  )
  await userEvent.type(
    screen.getByLabelText(/Taxpayer identification number/),
    '91110000MA01ABCD3X'
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Submit and pay tax' })
  )

  await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
  expect(post).toHaveBeenCalledWith('/api/invoice', {
    title_type: 'company',
    title: '示例科技有限公司',
    tax_no: '91110000MA01ABCD3X',
    category: '软件开发服务',
    email: 'finance@example.com',
    payment_method: 'balance',
    orders: [
      { order_type: 'topup', order_id: 101 },
      { order_type: 'subscription', order_id: 201 },
    ],
  })
})

it('an individual title has no tax number field and sends none', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { invoice: { id: 8 } } },
  })
  renderForm({ balance: 5000000 })

  await userEvent.click(screen.getByRole('button', { name: 'Individual' }))
  expect(screen.queryByLabelText(/Taxpayer identification number/)).toBeNull()
  await userEvent.type(screen.getByLabelText(/Individual name/), '张三')
  await userEvent.click(
    screen.getByRole('button', { name: 'Submit and pay tax' })
  )

  await waitFor(() => expect(post).toHaveBeenCalled())
  expect(post.mock.calls[0][1]).toMatchObject({
    title_type: 'personal',
    title: '张三',
    tax_no: '',
  })
})

it('a balance short of the tax disables submitting and says so', async () => {
  renderForm({ balance: 1000000 })

  expect(screen.getByText(/Insufficient balance/)).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Submit and pay tax' })
  ).toBeDisabled()

  // Paying through epay instead lifts the block.
  await userEvent.click(screen.getByRole('button', { name: 'Alipay' }))
  expect(
    screen.getByRole('button', { name: 'Submit and pay tax' })
  ).toBeEnabled()
})

it('an epay tax opens the payment form the server returns', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        invoice: { id: 9 },
        url: 'https://pay.example.com/submit.php',
        params: { out_trade_no: 'INV9Nabc', money: '4.40' },
      },
    },
  })
  const submit = vi
    .spyOn(HTMLFormElement.prototype, 'submit')
    .mockImplementation(() => undefined)
  renderForm({ balance: 0 })

  await userEvent.click(screen.getByRole('button', { name: 'WeChat Pay' }))
  await userEvent.type(
    screen.getByLabelText(/Company name/),
    '示例科技有限公司'
  )
  await userEvent.type(
    screen.getByLabelText(/Taxpayer identification number/),
    '91110000MA01ABCD3X'
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Submit and pay tax' })
  )

  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  const form = submit.mock.contexts[0] as HTMLFormElement
  expect(form.action).toBe('https://pay.example.com/submit.php')
  expect(
    (form.elements.namedItem('out_trade_no') as HTMLInputElement).value
  ).toBe('INV9Nabc')
})

it('submitting is disabled until an order is selected', () => {
  renderForm({ balance: 5000000, selected: [] })

  expect(screen.getByText('0 orders selected')).toBeVisible()
  // With nothing selected there is no tax to pay.
  expect(
    screen.getByRole('button', { name: 'Submit application' })
  ).toBeDisabled()
})
