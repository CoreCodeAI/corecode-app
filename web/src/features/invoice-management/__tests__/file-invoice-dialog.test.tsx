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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import type { InvoiceConfig } from '@/features/invoice/types'
import { api } from '@/lib/api'

import { FileInvoiceDialog } from '../components/file-invoice-dialog'

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

function renderDialog() {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/invoice/config') {
      return { data: { success: true, data: config } }
    }
    return {
      data: {
        success: true,
        data: {
          user: { id: 3163, username: 'pathpal', email: 'f@example.com' },
          orders: [
            {
              order_type: 'topup',
              order_id: 2590,
              trade_no: 'OFFLINE-3163-a',
              amount_cents: 500000,
              paid_time: 1795255724,
              payment_method: 'offline',
            },
          ],
        },
      },
    }
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { invoice: { id: 30 } } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <FileInvoiceDialog onClose={() => undefined} />
    </QueryClientProvider>
  )
  return { post }
}

async function fileForPathPal() {
  await userEvent.type(screen.getByLabelText('User ID'), '3163')
  await userEvent.click(screen.getByRole('button', { name: 'Find' }))
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Select all' })
  )
  await userEvent.type(
    screen.getByLabelText(/Company name/),
    '示例科技有限公司'
  )
  await userEvent.type(
    screen.getByLabelText(/Taxpayer identification number/),
    '91110000MA01ABCD3X'
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('files with the tax deducted from the balance by default', async () => {
  const { post } = renderDialog()
  await fileForPathPal()
  expect(
    screen.getByText("The tax is deducted from the user's balance.")
  ).toBeVisible()

  await userEvent.click(
    screen.getByRole('button', { name: 'Submit application' })
  )

  await waitFor(() => expect(post).toHaveBeenCalled())
  expect(post.mock.calls[0][0]).toBe('/api/invoice/admin')
  expect(post.mock.calls[0][1]).toMatchObject({
    user_id: 3163,
    tax_from_balance: true,
    orders: [{ order_type: 'topup', order_id: 2590 }],
  })
})

it('records the tax as collected offline when the switch is off', async () => {
  const { post } = renderDialog()
  await userEvent.click(
    screen.getByRole('switch', {
      name: "Deduct the tax from the user's balance",
    })
  )
  await fileForPathPal()
  expect(
    screen.getByText(
      "The tax is recorded as collected offline. Nothing is deducted from the user's balance."
    )
  ).toBeVisible()

  await userEvent.click(
    screen.getByRole('button', { name: 'Submit application' })
  )

  await waitFor(() => expect(post).toHaveBeenCalled())
  expect(post.mock.calls[0][1]).toMatchObject({ tax_from_balance: false })
})
