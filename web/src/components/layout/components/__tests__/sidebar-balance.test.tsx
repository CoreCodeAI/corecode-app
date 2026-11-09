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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { SidebarBalance } from '../sidebar-balance'

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

async function renderSidebarBalance(usage: {
  used_quota: number
  request_count: number
}) {
  const user = { id: 7, username: 'ada', role: 1, quota: 0, ...usage }
  useAuthStore.getState().auth.setUser(user)
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.startsWith('/api/user/self')) {
      return { data: { success: true, data: user } }
    }
    return { data: { success: true, data: [] } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={client}>
          <SidebarProvider>
            <SidebarBalance />
          </SidebarProvider>
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
}

test('a never-used empty account reads as not topped up, without the alarm colour', async () => {
  await renderSidebarBalance({ used_quota: 0, request_count: 0 })

  const label = await screen.findByText('Not topped up yet')
  expect(label).not.toHaveClass('text-destructive')
  expect(screen.queryByText('Balance depleted')).not.toBeInTheDocument()
})

test('an empty account that has spent reads as depleted in the alarm colour', async () => {
  await renderSidebarBalance({ used_quota: 2_500_000, request_count: 9 })

  expect(await screen.findByText('Balance depleted')).toHaveClass(
    'text-destructive'
  )
})
