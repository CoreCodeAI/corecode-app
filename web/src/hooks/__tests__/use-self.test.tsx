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
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { useRefreshSelf } from '../use-self'

let client: QueryClient

function wrapper(props: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useAuthStore.getState().auth.setUser({
    id: 7,
    username: 'ada',
    role: 1,
    quota: 100,
    aff_code: 'abc',
  })
})

afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

describe('refreshing the signed-in user', () => {
  it('writes the fresh balance into the auth store without dropping other fields', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { id: 7, username: 'ada', role: 1, quota: 900 },
      },
    })
    const { result } = renderHook(() => useRefreshSelf(), { wrapper })

    await act(async () => {
      await result.current()
    })

    const user = useAuthStore.getState().auth.user
    expect(user?.quota).toBe(900)
    expect(user?.aff_code).toBe('abc')
  })

  it('leaves the store alone when the server reports a failure', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: false, message: 'nope' },
    })
    const { result } = renderHook(() => useRefreshSelf(), { wrapper })

    let fresh: unknown = 'unset'
    await act(async () => {
      fresh = await result.current()
    })

    expect(fresh).toBeNull()
    expect(useAuthStore.getState().auth.user?.quota).toBe(100)
  })

  it('ignores a payload for a different account', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { id: 8, username: 'bob', role: 1, quota: 5 },
      },
    })
    const { result } = renderHook(() => useRefreshSelf(), { wrapper })

    await act(async () => {
      await result.current()
    })

    expect(useAuthStore.getState().auth.user?.id).toBe(7)
    expect(useAuthStore.getState().auth.user?.quota).toBe(100)
  })
})
