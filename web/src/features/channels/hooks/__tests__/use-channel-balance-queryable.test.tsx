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
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getTaskPluginOptions } from '../../api'
import { CHANNEL_TYPE_TASK_PLUGIN } from '../../constants'
import { useChannelBalanceQueryable } from '../use-task-plugin-option'

vi.mock('../../api', () => ({ getTaskPluginOptions: vi.fn() }))

const pluginChannel = {
  type: CHANNEL_TYPE_TASK_PLUGIN,
  setting: JSON.stringify({ task_plugin_key: 'seedance-wan' }),
}

function renderQueryable(settings: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => useChannelBalanceQueryable({ ...pluginChannel, settings }),
    { wrapper }
  )
}

describe('useChannelBalanceQueryable', () => {
  beforeEach(() => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      role: ROLE.SUPER_ADMIN,
    } as never)
    vi.mocked(getTaskPluginOptions).mockResolvedValue([
      { key: 'seedance-wan', balance: false },
    ] as never)
  })

  it('hides the balance action of a plugin without balance hooks', async () => {
    const { result } = renderQueryable('{}')
    await waitFor(() => expect(getTaskPluginOptions).toHaveBeenCalled())
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('keeps it when the channel names a balance source', async () => {
    const { result } = renderQueryable('{"balance_source":"sub2api"}')
    await waitFor(() => expect(getTaskPluginOptions).toHaveBeenCalled())
    expect(result.current).toBe(true)
  })
})
