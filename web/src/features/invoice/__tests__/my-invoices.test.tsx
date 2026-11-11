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

import { api } from '@/lib/api'

import { MyInvoices } from '../components/my-invoices'
import type { Invoice } from '../types'

function application(id: number): Invoice {
  return {
    id,
    user_id: 11,
    status: 'pending_payment',
    invoice_type: 'normal',
    title_type: 'personal',
    title: 'Alice',
    tax_no: '',
    category: '软件开发服务',
    email: 'alice@example.com',
    order_cents: 10000,
    tax_rate: 4,
    tax_cents: 400,
    tax_method: 'alipay',
    tax_trade_no: '',
    tax_quota: 0,
    tax_paid_time: 0,
    reject_reason: '',
    reviewed_by: 0,
    issued_time: 0,
    file_name: '',
    file_mime: '',
    file_size: 0,
    created_time: 1762800000,
    updated_time: 1762800000,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('goes back a page when the last page empties', async () => {
  // Eleven applications fill two pages; the one on page 2 is then
  // cancelled, leaving ten.
  let total = 11
  vi.spyOn(api, 'get').mockImplementation(async (_url, config) => {
    const params = config?.params as { p?: number } | undefined
    const page = Number(params?.p ?? 1)
    const start = (page - 1) * 10
    const ids = Array.from({ length: total }, (_, i) => i + 1).slice(
      start,
      start + 10
    )
    return {
      data: {
        success: true,
        data: { page, page_size: 10, total, items: ids.map(application) },
      },
    }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MyInvoices payMethods={['alipay']} onChanged={() => {}} />
    </QueryClientProvider>
  )

  await screen.findByText('1 / 2')
  await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByText('2 / 2')
  expect(screen.getByText('#11')).toBeInTheDocument()

  total = 10
  await client.invalidateQueries()

  await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument())
  expect(screen.queryByText('No applications yet')).not.toBeInTheDocument()
})
