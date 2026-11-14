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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { BillingHistoryDialog } from '@/features/wallet/components/dialogs/billing-history-dialog'
import { api } from '@/lib/api'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: (props: { to: string; className?: string; children: ReactNode }) => (
    <a href={props.to} className={props.className}>
      {props.children}
    </a>
  ),
}))

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

// Paid and refunded Stripe orders have a receipt; a pending Stripe order
// and an epay order do not.
const STRIPE_ORDERS = {
  data: {
    success: true,
    data: {
      total: 4,
      items: [
        ['ref-paid', 'success', 'stripe'],
        ['ref-refunded', 'refunded', 'stripe'],
        ['ref-open', 'pending', 'stripe'],
        ['ref-epay', 'success', 'epay'],
      ].map(([tradeNo, status, provider], id) => ({
        id,
        status,
        amount: 10,
        money: 10,
        trade_no: tradeNo,
        payment_method: provider === 'stripe' ? 'stripe_card' : 'alipay',
        payment_provider: provider,
        create_time: 1,
      })),
    },
  },
}

function waitingTab() {
  return {
    opener: {} as unknown,
    closed: false,
    close: vi.fn(),
    location: { href: '' },
    document: { title: '', body: { style: { cssText: '' }, textContent: '' } },
  }
}

it('opens a Stripe receipt in the tab the click opened', async () => {
  const user = userEvent.setup()
  const tab = waitingTab()
  const open = vi
    .spyOn(window, 'open')
    .mockReturnValue(tab as unknown as Window)
  let resolveReceipt: (value: unknown) => void = () => {}
  const get = vi.spyOn(api, 'get').mockImplementation((url: string) =>
    url === '/api/user/topup/receipt'
      ? new Promise((resolve) => {
          resolveReceipt = resolve
        })
      : Promise.resolve(STRIPE_ORDERS)
  )
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  await screen.findByText('ref-paid')

  const receipts = screen.getAllByRole('button', { name: /Receipt/ })
  expect(receipts).toHaveLength(2)
  await user.click(receipts[0])

  // The tab opens on the click, before the link is known.
  expect(open).toHaveBeenCalledWith('', '_blank')
  expect(tab.opener).toBeNull()
  expect(tab.document.body.textContent).toBe('Opening the Stripe receipt…')
  expect(get).toHaveBeenCalledWith('/api/user/topup/receipt', {
    params: { trade_no: 'ref-paid' },
  })
  expect(receipts[0]).toBeDisabled()
  expect(receipts[0]).toHaveAttribute('aria-busy', 'true')

  resolveReceipt({
    data: { success: true, data: { url: 'https://pay.stripe.com/receipts/x' } },
  })
  await waitFor(() =>
    expect(tab.location.href).toBe('https://pay.stripe.com/receipts/x')
  )
  expect(receipts[0]).toBeEnabled()
  expect(tab.close).not.toHaveBeenCalled()
})

it('closes the waiting tab when Stripe has no receipt', async () => {
  const user = userEvent.setup()
  const tab = waitingTab()
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  vi.spyOn(api, 'get').mockImplementation((url: string) =>
    Promise.resolve(
      url === '/api/user/topup/receipt'
        ? {
            data: {
              success: false,
              message: 'This order has no Stripe receipt',
            },
          }
        : STRIPE_ORDERS
    )
  )
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  await screen.findByText('ref-paid')

  await user.click(screen.getAllByRole('button', { name: /Receipt/ })[1])

  await waitFor(() => expect(tab.close).toHaveBeenCalled())
  expect(tab.location.href).toBe('')
})

it('points a customer with Stripe receipts to the invoice center', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(STRIPE_ORDERS)
  const view = render(
    <BillingHistoryDialog open onOpenChange={vi.fn()} invoiceEnabled />
  )
  await screen.findByText('ref-paid')

  expect(
    screen.getByRole('link', {
      name: 'Request an invoice in the invoice center',
    })
  ).toHaveAttribute('href', '/invoice')

  view.rerender(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
