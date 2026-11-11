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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { apiKeySchema } from '../../types'
import { ApiKeysDialogs } from '../api-keys-dialogs'
import { ApiKeysProvider, useApiKeys } from '../api-keys-provider'

const key = apiKeySchema.parse({
  id: 7,
  name: 'production',
  key: 'demo********1234',
  status: 1,
  remain_quota: 0,
  used_quota: 0,
  unlimited_quota: true,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  group: 'gpt',
  model_limits_enabled: false,
})

let openSetup: () => void = () => {}

function SetupOpener() {
  const { setCurrentRow, setOpen } = useApiKeys()
  openSetup = () => {
    setCurrentRow(key)
    setOpen('setup')
  }
  return null
}

function modelRequests() {
  return vi
    .mocked(api.get)
    .mock.calls.filter(([url]) => String(url).startsWith('/api/user/models'))
}

function renderDialogs() {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (String(url).startsWith('/api/user/models')) {
      return { data: { success: true, data: ['gpt-5.5', 'gpt-5.5-mini'] } }
    }
    if (String(url).startsWith('/api/user/self/groups')) {
      return { data: { success: true, data: { gpt: { desc: 'GPT' } } } }
    }
    return { data: { success: true, data: [] } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ApiKeysProvider>
        <SetupOpener />
        <ApiKeysDialogs />
      </ApiKeysProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('the closed setup dialog requests no models', async () => {
  renderDialogs()
  await act(async () => {})
  expect(modelRequests()).toHaveLength(0)
})

it('opening the setup dialog loads the models of the key group', async () => {
  renderDialogs()
  act(() => openSetup())
  expect(
    await screen.findByRole('heading', { name: 'Connect Codex' })
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(modelRequests()).toContainEqual([
      '/api/user/models',
      { params: { group: 'gpt' } },
    ])
  )
})
