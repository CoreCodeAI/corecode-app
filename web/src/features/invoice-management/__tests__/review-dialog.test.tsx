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

import type { Invoice } from '@/features/invoice/types'
import { api } from '@/lib/api'

import { InvoiceReviewDialog } from '../components/invoice-review-dialog'

const underReview: Invoice = {
  id: 7,
  user_id: 11,
  status: 'pending_review',
  invoice_type: 'normal',
  title_type: 'company',
  title: '示例科技有限公司',
  tax_no: '91110000MA01ABCD3X',
  category: '软件开发服务',
  email: 'finance@example.com',
  order_cents: 10000,
  tax_rate: 4,
  tax_cents: 400,
  tax_method: 'balance',
  tax_trade_no: '',
  tax_quota: 2000000,
  tax_paid_time: 1762800100,
  reject_reason: '',
  reviewed_by: 0,
  issued_time: 0,
  file_name: '',
  file_mime: '',
  file_size: 0,
  created_time: 1762800000,
  updated_time: 1762800100,
}

function renderDialog(invoice: Invoice) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        invoice,
        items: [
          {
            id: 1,
            invoice_id: invoice.id,
            order_type: 'topup',
            order_id: 101,
            trade_no: 'USR11NOabc',
            amount_cents: 10000,
            paid_time: 1762790000,
          },
        ],
        user: { id: 11, username: 'user11', email: 'u11@example.com' },
      },
    },
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <InvoiceReviewDialog id={invoice.id} onClose={() => undefined} />
    </QueryClientProvider>
  )
  return { post }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('an application without a file cannot be confirmed issued', async () => {
  renderDialog(underReview)

  expect(await screen.findByText('No file uploaded yet.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Confirm issued' })).toBeDisabled()
})

it('uploads the chosen file as the invoice file', async () => {
  const { post } = renderDialog(underReview)
  await screen.findByText('No file uploaded yet.')

  const file = new File(['%PDF-1.7'], '发票.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText('Upload file'), file)

  await waitFor(() => expect(post).toHaveBeenCalled())
  const [path, body] = post.mock.calls[0]
  expect(path).toBe('/api/invoice/admin/7/file')
  expect((body as FormData).get('file')).toBe(file)
})

it('rejecting asks for a reason and sends it', async () => {
  const { post } = renderDialog(underReview)
  await userEvent.click(await screen.findByRole('button', { name: 'Reject' }))

  const confirm = screen.getByRole('button', { name: 'Reject application' })
  expect(confirm).toBeDisabled()
  await userEvent.type(
    screen.getByLabelText('Rejection reason'),
    '抬头与税号不符'
  )
  await userEvent.click(confirm)

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/invoice/admin/7/reject', {
      reason: '抬头与税号不符',
    })
  )
})

it('an issued application offers deletion, not rejection', async () => {
  renderDialog({
    ...underReview,
    status: 'issued',
    issued_time: 1762800200,
    file_name: '发票.pdf',
    file_mime: 'application/pdf',
    file_size: 8,
  })

  expect(await screen.findByRole('button', { name: 'Delete' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Confirm issued' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Replace file' })).toBeVisible()
})
