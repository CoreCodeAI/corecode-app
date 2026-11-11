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

import { CommonLogsFilterBar } from '../common-logs-filter-bar'
import { UsageLogsProvider } from '../usage-logs-provider'

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

const keyNames = ['claude-code', 'codex', 'claude-code']
const models = ['claude-opus-4-1', 'gpt-5-codex']

async function renderFilter() {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.startsWith('/api/token/')) {
      return {
        data: {
          success: true,
          data: {
            items: keyNames.map((name, index) => ({ id: index + 1, name })),
            total: keyNames.length,
          },
        },
      }
    }
    if (url === '/api/user/models') {
      return { data: { success: true, data: models } }
    }
    if (url === '/api/group/') return { data: { success: true, data: [] } }
    return { data: { success: true, data: {} } }
  })
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
    history: createMemoryHistory({ initialEntries: ['/usage-logs/common'] }),
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
  await screen.findByRole('combobox', { name: 'Model Name' })
  await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
  return router
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
})

it('offers each of the user key names once and applies the picked name', async () => {
  const router = await renderFilter()
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Token Name' }))
  expect(
    await screen.findAllByRole('option', { name: 'claude-code' })
  ).toHaveLength(1)
  await user.click(screen.getByRole('option', { name: 'codex' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ token: 'codex' })
  )
})

it('still accepts a token name typed by hand', async () => {
  const router = await renderFilter()
  const user = userEvent.setup()
  await user.type(
    screen.getByRole('combobox', { name: 'Token Name' }),
    'retired-key{Enter}'
  )
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      token: 'retired-key',
    })
  )
})

it('offers the user models and applies the picked model', async () => {
  const router = await renderFilter()
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Model Name' }))
  await user.click(
    await screen.findByRole('option', { name: 'claude-opus-4-1' })
  )
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      model: 'claude-opus-4-1',
    })
  )
})

it('keeps a typed % wildcard as the model filter', async () => {
  const router = await renderFilter()
  const user = userEvent.setup()
  const input = screen.getByRole('combobox', { name: 'Model Name' })
  await user.type(input, '%opus%')
  expect(router.state.location.search).not.toHaveProperty('model')
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ model: '%opus%' })
  )
})

it('masks the token names in the dropdown while sensitive values are hidden', async () => {
  await renderFilter()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /^Hide$/ }))
  await user.click(screen.getByRole('combobox', { name: 'Token Name' }))
  const option = await screen.findByRole('option', { name: 'codex' })
  expect(option.closest('.\\[-webkit-text-security\\:disc\\]')).not.toBeNull()
})

it('does not offer the administrator own key names for logs of all users', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  await renderFilter()
  await screen.findByRole('combobox', { name: 'Token Name' })
  expect(
    vi.mocked(api.get).mock.calls.some(([url]) => url.startsWith('/api/token/'))
  ).toBe(false)
})
