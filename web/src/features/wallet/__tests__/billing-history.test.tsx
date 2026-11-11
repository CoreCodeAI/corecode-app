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
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { BillingHistoryDialog } from '@/features/wallet/components/dialogs/billing-history-dialog'
import { api } from '@/lib/api'

function page(tradeNos: string[], total = tradeNos.length) {
  return {
    data: {
      success: true,
      data: {
        total,
        items: tradeNos.map((tradeNo, id) => ({
          id,
          status: 'pending',
          amount: 10,
          money: 10,
          trade_no: tradeNo,
          payment_method: 'stripe',
          create_time: 1,
        })),
      },
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

it('does not load billing history while the dialog is closed', () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(page([]))

  render(<BillingHistoryDialog open={false} onOpenChange={vi.fn()} />)

  expect(get).not.toHaveBeenCalled()
})

it('lists an order placed after the wallet loaded when the dialog opens', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce(page(['order-before']))
    .mockResolvedValue(page(['order-after', 'order-before']))
  const view = render(
    <BillingHistoryDialog open={false} onOpenChange={vi.fn()} />
  )

  // The wallet mounts, then the customer pays and opens the history.
  view.rerender(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  await screen.findByText('order-before')
  view.rerender(<BillingHistoryDialog open={false} onOpenChange={vi.fn()} />)
  view.rerender(<BillingHistoryDialog open onOpenChange={vi.fn()} />)

  expect(await screen.findByText('order-after')).toBeVisible()
  expect(get).toHaveBeenCalledTimes(2)
})

it('keeps the current page on screen while the next page loads', async () => {
  const user = userEvent.setup()
  let resolveNext: (value: unknown) => void = () => {}
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce(page(['order-page-1'], 20))
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNext = resolve
      })
    )
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  await screen.findByText('order-page-1')

  const pagination = screen.getByText(/^Showing/).parentElement as HTMLElement
  const [, next] = within(pagination).getAllByRole('button')
  await user.click(next)

  expect(screen.getByText('order-page-1')).toBeVisible()
  resolveNext(page(['order-page-2'], 20))
  expect(await screen.findByText('order-page-2')).toBeVisible()
})
