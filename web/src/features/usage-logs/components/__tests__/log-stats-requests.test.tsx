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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { logStatsSearch, spendBreakdownRange } from '../../lib/query-ranges'
import { CommonLogsStats } from '../common-logs-stats'
import { UsageLogsProvider } from '../usage-logs-provider'

function callsTo(path: string) {
  return vi
    .mocked(api.get)
    .mock.calls.filter(([url]) => String(url).startsWith(path))
}

async function renderStats() {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (String(url).startsWith('/api/data/flow/self')) {
      return {
        data: {
          success: true,
          data: [
            {
              token_name: 'laptop',
              model_name: 'claude-opus-5-5',
              use_group: 'default',
              count: 3,
              quota: 1500,
              token_used: 10,
            },
          ],
        },
      }
    }
    return { data: { success: true, data: { quota: 0, rpm: 0, tpm: 0 } } }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: () => (
      <UsageLogsProvider>
        <CommonLogsStats />
      </UsageLogsProvider>
    ),
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: ['/usage-logs/common'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('button', { name: 'Spend by key' })
  return router
}

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
})

it('paging the logs reruns neither the stats nor the spend breakdown', async () => {
  // Only Date is faked, so each page turn lands seconds later in the same hour.
  vi.useFakeTimers({ toFake: ['Date'] })
  let now = new Date(2026, 10, 11, 9, 0, 10).getTime()
  vi.setSystemTime(now)
  const router = await renderStats()
  await waitFor(() => expect(callsTo('/api/log/self/stat')).toHaveLength(1))
  await waitFor(() => expect(callsTo('/api/data/flow/self')).toHaveLength(1))

  for (const page of [2, 3, 4]) {
    now += 2_000
    vi.setSystemTime(now)
    await act(() =>
      router.navigate({
        to: '/usage-logs/$section',
        params: { section: 'common' },
        search: { page, pageSize: 50 },
      })
    )
  }

  expect(callsTo('/api/log/self/stat')).toHaveLength(1)
  expect(callsTo('/api/data/flow/self')).toHaveLength(1)
})

it('changing a filter still refreshes the stats', async () => {
  const router = await renderStats()
  await waitFor(() => expect(callsTo('/api/log/self/stat')).toHaveLength(1))
  await act(() =>
    router.navigate({
      to: '/usage-logs/$section',
      params: { section: 'common' },
      search: { model: 'claude-opus-5-5' },
    })
  )
  await waitFor(() => expect(callsTo('/api/log/self/stat')).toHaveLength(2))
  expect(callsTo('/api/log/self/stat')[1][0]).toContain(
    'model_name=claude-opus-5-5'
  )
})

it('the spend breakdown loaded with the page is the one the popover shows', async () => {
  await renderStats()
  await waitFor(() => expect(callsTo('/api/data/flow/self')).toHaveLength(1))

  await userEvent.click(screen.getByRole('button', { name: 'Spend by key' }))
  expect(
    await screen.findByRole('button', { name: 'Show logs for laptop' })
  ).toBeInTheDocument()
  expect(callsTo('/api/data/flow/self')).toHaveLength(1)
})

it('the default spend range ends at the next hour and holds within the hour', () => {
  const hour = Date.UTC(2026, 10, 11, 9) // 09:00:00 UTC
  const early = spendBreakdownRange({}, hour + 1_000)
  const late = spendBreakdownRange({}, hour + 3_599_000)
  expect(early.end).toBe(hour / 1000 + 3600)
  expect(late).toEqual(early)
  expect(spendBreakdownRange({}, hour).end).toBe(hour / 1000)
})

it('an end time in the URL is used as given', () => {
  expect(
    spendBreakdownRange({ startTime: 1_000_000, endTime: 5_000_500 }, 0)
  ).toEqual({ start: 1000, end: 5000 })
})

it('the stats key ignores paging but keeps every filter', () => {
  expect(
    logStatsSearch({ page: 3, pageSize: 50, model: 'm', token: 'k', type: [2] })
  ).toEqual({ model: 'm', token: 'k', type: [2] })
})
