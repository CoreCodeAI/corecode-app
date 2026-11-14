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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { formatPaymentMoney } from '@/features/wallet/lib'
import { api } from '@/lib/api'

import { TopupRecords } from '..'
import type { TopupReportRecord, TopupStats } from '../types'

const stats: TopupStats = {
  money: 60.3,
  count: 3,
  user_count: 2,
  daily: [
    { day: 1759248000, money: 30.3, count: 2 },
    { day: 1759334400, money: 0, count: 0 },
  ],
  methods: [{ payment_method: 'alipay', money: 60.3, count: 3 }],
  payment_methods: ['alipay', 'stripe'],
}

const pending: TopupReportRecord = {
  id: 9,
  user_id: 42,
  username: 'alice',
  amount: 10,
  money: 72,
  trade_no: 'ORD_9',
  payment_method: 'alipay',
  create_time: 1759248100,
  status: 'pending',
}

const paid: TopupReportRecord[] = [
  { ...pending, id: 10, trade_no: 'ORD_10', money: 200, status: 'success' },
  { ...pending, id: 11, trade_no: 'ORD_11', money: 100, status: 'success' },
]

function renderPage(items: TopupReportRecord[] = [pending]) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    return {
      data: {
        success: true,
        data:
          url === '/api/user/topup/stats'
            ? stats
            : { items, total: items.length, page: 1, page_size: 20 },
      },
    }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const topups = createRoute({
    getParentRoute: () => auth,
    path: '/topups/',
    component: TopupRecords,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([topups])]),
    history: createMemoryHistory({ initialEntries: ['/topups/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { get, router }
}

function lastParams(get: ReturnType<typeof renderPage>['get'], url: string) {
  const calls = get.mock.calls.filter((call) => call[0] === url)
  const last = calls.at(-1)
  if (!last) throw new Error(`no request to ${url}`)
  return (last[1] as { params: Record<string, unknown> }).params
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('summarizes the default thirty-day range and lists its records', async () => {
  const { get } = renderPage()

  const summary = (await screen.findByText('Top-up revenue')).closest(
    'dl'
  ) as HTMLElement
  await waitFor(() =>
    expect(within(summary).getByText(formatPaymentMoney(60.3))).toBeVisible()
  )
  expect(within(summary).getByText('3')).toBeVisible()
  expect(within(summary).getByText('2')).toBeVisible()
  expect(await screen.findByText('alice')).toBeVisible()

  const params = lastParams(get, '/api/user/topup/stats')
  const span = Number(params.end_time) - Number(params.start_time)
  expect(span).toBe(30 * 86400)
  expect(params.tz_offset).toBe(-new Date().getTimezoneOffset())
  expect(lastParams(get, '/api/user/topup/records')).toMatchObject({
    start_time: params.start_time,
    end_time: params.end_time,
    p: 1,
    page_size: 20,
  })
})

it('shows a day as soon as the pointer reaches any part of its column', async () => {
  renderPage()

  const chart = await screen.findByRole('list', {
    name: 'Daily top-up revenue',
  })
  // The spacing between bars is padding inside each trigger, not a list gap,
  // so the pointer never rests on a point that opens nothing.
  expect(chart.className).not.toMatch(/\bgap-/)
  const [first] = await within(chart).findAllByRole('listitem')
  // Each item is its day's trigger, so no edge of it is dead.
  const bar = first
  expect(bar).toHaveAttribute('data-slot', 'tooltip-trigger')
  expect(bar).toHaveClass('px-[0.5px]', 'sm:px-0.5')

  await userEvent.hover(bar)
  // Base UI waits 600ms by default; the chart's provider opens at once.
  const tooltip = await waitFor(
    () => {
      const popup = document.querySelector('[data-slot="tooltip-content"]')
      expect(popup).not.toBeNull()
      return popup as HTMLElement
    },
    { timeout: 200 }
  )
  expect(tooltip).toHaveTextContent(formatPaymentMoney(30.3))
  expect(tooltip).toHaveTextContent('2 orders')
})

it('shows a day on a tap, which a touch screen sends instead of a hover', async () => {
  renderPage()

  const chart = await screen.findByRole('list', {
    name: 'Daily top-up revenue',
  })
  const [first] = await within(chart).findAllByRole('listitem')
  // Each item is its day's trigger, so no edge of it is dead.
  const bar = first
  expect(bar).toHaveAttribute('data-slot', 'tooltip-trigger')

  fireEvent.pointerDown(bar, { pointerType: 'touch' })
  fireEvent.click(bar)
  const tooltip = await waitFor(() => {
    const popup = document.querySelector('[data-slot="tooltip-content"]')
    expect(popup).not.toBeNull()
    return popup as HTMLElement
  })
  expect(tooltip).toHaveTextContent(formatPaymentMoney(30.3))

  // A second tap on the same day puts it away.
  fireEvent.pointerDown(bar, { pointerType: 'touch' })
  fireEvent.click(bar)
  await waitFor(() =>
    expect(
      document.querySelector('[data-slot="tooltip-content"][data-open]')
    ).toBeNull()
  )
})

it('applies the user filter to both the records and the summary on Search', async () => {
  const { get, router } = renderPage()
  const user = userEvent.setup()
  await screen.findByText('alice')

  await user.type(screen.getByLabelText('User ID or username'), '  alice ')
  await user.click(screen.getByRole('button', { name: 'Search' }))

  await waitFor(() =>
    expect(lastParams(get, '/api/user/topup/records')).toMatchObject({
      user: 'alice',
      p: 1,
    })
  )
  expect(lastParams(get, '/api/user/topup/stats')).toMatchObject({
    user: 'alice',
  })
  expect(router.state.location.search).toMatchObject({ user: 'alice', page: 1 })
})

it('completes a pending order after confirmation and reloads the report', async () => {
  const { get } = renderPage()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, message: '' } })
  const user = userEvent.setup()
  await screen.findByText('alice')
  const before = get.mock.calls.length

  await user.click(screen.getByRole('button', { name: 'Complete Order' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'Complete Order' })
  )

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/topup/complete', {
      trade_no: 'ORD_9',
    })
  )
  await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before))
})

it('offers no control to mark a paid order refunded', async () => {
  renderPage([pending, ...paid])
  await screen.findAllByText('alice')

  // Refunds go through `POST /api/user/topup/refund`, not this page.
  expect(screen.queryByRole('button', { name: 'Mark refunded' })).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(
    screen.getAllByRole('button', { name: 'Complete Order' })
  ).toHaveLength(1)
})
