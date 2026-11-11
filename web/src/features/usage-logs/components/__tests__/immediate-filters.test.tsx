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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { CommonLogsFilterBar } from '../common-logs-filter-bar'
import { UsageLogsProvider } from '../usage-logs-provider'

const captureDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'setPointerCapture'
)

function Fixture() {
  const table = useReactTable({
    data: [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <UsageLogsProvider>
      <CommonLogsFilterBar table={table} />
    </UsageLogsProvider>
  )
}

async function renderDesktopFilter(initialEntry = '/usage-logs/common') {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/user/self/groups'
          ? { default: { desc: '', ratio: 1 }, premium: { desc: '', ratio: 2 } }
          : { quota: 0, rpm: 0, tpm: 0 },
    },
  }))
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: Fixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('combobox', { name: 'Group' })
  return router
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  if (captureDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'setPointerCapture',
      captureDescriptor
    )
  } else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  cleanup()
  vi.restoreAllMocks()
})

it('applies a date preset on desktop as soon as it is picked', async () => {
  const router = await renderDesktopFilter('/usage-logs/common?page=3')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /^\d{4}-\d{2}/ }))
  await user.click(screen.getByRole('button', { name: '7 Days' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ page: 1 })
  )
  const start = new Date()
  start.setDate(start.getDate() - 6)
  start.setHours(0, 0, 0, 0)
  expect(router.state.location.search).toMatchObject({
    startTime: start.getTime(),
  })
})

it('applies a log type on desktop as soon as it is chosen', async () => {
  const router = await renderDesktopFilter()
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Type' }))
  await user.click(screen.getByRole('option', { name: 'Consume' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      type: ['2'],
      page: 1,
    })
  )
})

it('applies a group on desktop as soon as an option is picked', async () => {
  const router = await renderDesktopFilter()
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Group' }))
  await user.click(await screen.findByRole('option', { name: 'premium' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ group: 'premium' })
  )
})

it('keeps typed group text unapplied until Enter', async () => {
  const router = await renderDesktopFilter()
  const user = userEvent.setup()
  const input = screen.getByRole('combobox', { name: 'Group' })
  await user.type(input, 'prem')
  expect(router.state.location.search).not.toHaveProperty('group')
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ group: 'prem' })
  )
})

it('keeps Reset disabled on the default range and enables it once only the date changes', async () => {
  await renderDesktopFilter()
  const user = userEvent.setup()
  expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: /^\d{4}-\d{2}/ }))
  await user.click(screen.getByRole('button', { name: '30 Days' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled()
  )
})

it('keeps Reset disabled after the Today preset, which covers the default range', async () => {
  await renderDesktopFilter()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /^\d{4}-\d{2}/ }))
  await user.click(screen.getByRole('button', { name: 'Today' }))
  expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
})
