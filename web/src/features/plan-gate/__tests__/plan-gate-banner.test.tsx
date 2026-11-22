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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PlanGateBanner } from '../components/plan-gate-banner'
import type { PlanGateNotice } from '../types'

let client: QueryClient

const answer = (data: PlanGateNotice | null) =>
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/subscription/self/plan-gate') {
      return { data: { success: true, data } }
    }
    throw new Error(`Unexpected request: ${url}`)
  })

const notice = (patch: Partial<PlanGateNotice> = {}): PlanGateNotice => ({
  window_seconds: 86400,
  wallet: 4,
  other_plan: 0,
  refused: 1,
  last_at: 1_700_000_000,
  subscription_ids: [5],
  ...patch,
})

async function renderBanner() {
  const router = createRouter({
    routeTree: createRootRoute({ component: PlanGateBanner }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 7, username: 'ada', role: 1, quota: 0 })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  client.clear()
  vi.restoreAllMocks()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})

describe('the newcomer plan limit banner', () => {
  it('tells a holder how many requests hit the balance and links to feedback', async () => {
    answer(notice())
    await renderBanner()

    expect(await screen.findByText('Newcomer plan paused')).toBeVisible()
    // 4 charged to the balance and 1 refused.
    expect(screen.getByText(/5 requests in the last 24 hours/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: /Go to Feedback/ })
    ).toHaveAttribute('href', '/feedback')
  })

  it('says nothing when the limit cost the customer nothing', async () => {
    const spy = answer(notice({ wallet: 0, refused: 0, other_plan: 3 }))
    await renderBanner()

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(screen.queryByText('Newcomer plan paused')).toBeNull()
  })

  it('says nothing to a customer with no guarded plan', async () => {
    const spy = answer(null)
    await renderBanner()

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(screen.queryByText('Newcomer plan paused')).toBeNull()
  })

  it('stays hidden for a day once dismissed, and asks nothing while hidden', async () => {
    const user = userEvent.setup()
    answer(notice())
    const first = await renderBanner()

    await screen.findByText('Newcomer plan paused')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Newcomer plan paused')).toBeNull()
    first.unmount()

    const spy = answer(notice())
    spy.mockClear()
    client.clear()
    await renderBanner()
    expect(screen.queryByText('Newcomer plan paused')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
