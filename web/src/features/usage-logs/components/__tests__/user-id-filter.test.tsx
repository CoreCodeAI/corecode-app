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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { buildApiParams } from '../../lib/utils'
import { CommonLogsFilterBar } from '../common-logs-filter-bar'
import { UsageLogsProvider } from '../usage-logs-provider'

function FilterFixture() {
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

async function renderFilter(initialEntry = '/usage-logs/common') {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/self/groups') {
      return { data: { success: true, data: {} } }
    }
    if (url === '/api/group/') {
      return { data: { success: true, data: [] } }
    }
    return { data: { success: true, data: { quota: 0, rpm: 0, tpm: 0 } } }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: FilterFixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('combobox', { name: 'Group' }).catch(() => null)
  if (window.matchMedia('(max-width: 640px)').matches) {
    await userEvent.click(
      await screen.findByRole('button', { name: /^Filter/ })
    )
  } else {
    await userEvent.click(
      await screen.findByRole('button', { name: /^Expand/ })
    )
  }
  return router
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
})

it('lets an administrator search logs by user ID, apart from the username', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  const router = await renderFilter()
  const input = screen.getByPlaceholderText('User ID')
  await userEvent.type(input, '5a46')
  expect(input).toHaveValue('546')
  expect(screen.getByPlaceholderText('Username')).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      userId: '546',
      page: 1,
    })
  )
  expect(router.state.location.search).not.toHaveProperty('username')
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/log\/stat\?.*\buser_id=546\b/)
    )
  )
})

it('shows no user ID filter in the personal view', async () => {
  await renderFilter()
  expect(screen.queryByPlaceholderText('User ID')).not.toBeInTheDocument()
})

it('sends the user ID only for administrators', () => {
  const searchParams = { userId: '546', username: '546' }
  expect(
    buildApiParams({ page: 1, pageSize: 20, searchParams, isAdmin: true })
  ).toMatchObject({ user_id: 546, username: '546' })
  const own = buildApiParams({
    page: 1,
    pageSize: 20,
    searchParams,
    isAdmin: false,
  })
  expect(own).not.toHaveProperty('user_id')
  expect(own).not.toHaveProperty('username')
  expect(
    buildApiParams({
      page: 1,
      pageSize: 20,
      searchParams: { userId: '0' },
      isAdmin: true,
    })
  ).not.toHaveProperty('user_id')
})

it('keeps a user ID typed into the page URL as a bare number', async () => {
  const { Route } = await import('@/routes/_authenticated/usage-logs/$section')
  const schema = Route.options.validateSearch as {
    parse: (value: unknown) => Record<string, unknown>
  }
  expect(schema.parse({ userId: 546 })).toMatchObject({ userId: '546' })
  expect(schema.parse({ userId: '546' })).toMatchObject({ userId: '546' })
})
