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
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import type { UsageLog } from '../../data/schema'
import type { LogOtherData } from '../../types'
import { DetailsDialog } from '../dialogs/details-dialog'

function makeLog(other: LogOtherData, type: number): UsageLog {
  return {
    id: 1,
    user_id: 1,
    created_at: 1,
    type,
    content: '',
    username: 'user',
    token_name: 'token',
    model_name: 'claude-sonnet-5-5',
    quota: 1000,
    prompt_tokens: 10,
    completion_tokens: 10,
    use_time: 1,
    is_stream: false,
    channel: 0,
    channel_name: '',
    token_id: 1,
    group: 'default',
    ip: '',
    other: JSON.stringify(other),
    request_id: 'req-1',
    upstream_request_id: '',
  }
}

async function renderDetails(other: LogOtherData, type = 2) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['status'], {}, { updatedAt: Date.now() + 60_000 })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <DetailsDialog
          log={makeLog(other, type)}
          isAdmin={false}
          isRoot={false}
          open
          onOpenChange={() => undefined}
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return screen.findByRole('dialog')
}

afterEach(cleanup)

describe('the newcomer plan limit in a log detail', () => {
  test.each([
    [
      'wallet',
      'Billed to balance (newcomer plan network limit)',
      /charged to your balance/,
    ],
    [
      'other_plan',
      'Billed to another plan (newcomer plan network limit)',
      /charged to your other plan/,
    ],
    ['refused', 'Refused (newcomer plan network limit)', /so it was refused/],
  ] as const)(
    'explains a %s request and points to feedback',
    async (kind, billing, explanation) => {
      const dialog = await renderDetails(
        { limited_plan_gate: kind },
        kind === 'refused' ? 5 : 2
      )

      expect(within(dialog).getByText('Newcomer Plan Limit')).toBeVisible()
      expect(within(dialog).getByText(billing)).toBeVisible()
      expect(within(dialog).getByText(explanation)).toBeVisible()
      expect(
        within(dialog).getByRole('link', { name: 'Go to Feedback' })
      ).toHaveAttribute('href', '/feedback')
    }
  )

  test('shows nothing for a log the limit did not touch', async () => {
    const dialog = await renderDetails({ billing_source: 'wallet' })

    expect(within(dialog).queryByText('Newcomer Plan Limit')).toBeNull()
    expect(
      within(dialog).queryByRole('link', { name: 'Go to Feedback' })
    ).toBeNull()
  })
})
