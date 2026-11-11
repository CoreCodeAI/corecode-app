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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import type { UsageLog } from '../../data/schema'
import { DetailsDialog } from '../dialogs/details-dialog'

const queryClients: QueryClient[] = []

function makeLog(overrides: Partial<UsageLog>): UsageLog {
  return {
    id: 1,
    user_id: 1,
    created_at: 1,
    type: 2,
    content: '',
    username: 'user',
    token_name: 'token',
    model_name: 'gpt-test',
    quota: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    use_time: 0,
    is_stream: false,
    channel: 1,
    channel_name: 'channel',
    token_id: 1,
    group: 'default',
    ip: '',
    other: '{}',
    request_id: '',
    upstream_request_id: '',
    ...overrides,
  }
}

function renderDetails(log: UsageLog): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['status'], {}, { updatedAt: Date.now() + 60_000 })
  queryClients.push(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <DetailsDialog
        log={log}
        isAdmin={false}
        isRoot={false}
        open
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClients.splice(0).forEach((client) => client.clear())
})

it.each([
  ['Request ID', { request_id: 'req-20261111-abc' }, 'req-20261111-abc'],
  [
    'Upstream Request ID',
    { upstream_request_id: 'msg_01upstream' },
    'msg_01upstream',
  ],
] as const)(
  'copies the %s from its own button in the details dialog',
  async (label, overrides, value) => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    renderDetails(makeLog(overrides))
    await user.click(
      await screen.findByRole('button', { name: `Copy: ${label}` })
    )
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(value))
  }
)

it('offers no copy button for a log without request IDs', async () => {
  renderDetails(makeLog({}))
  await screen.findByRole('dialog')
  expect(
    screen.queryByRole('button', { name: /^Copy: / })
  ).not.toBeInTheDocument()
})
