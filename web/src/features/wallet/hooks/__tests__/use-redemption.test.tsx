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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import * as walletApi from '../../api'
import { useRedemption } from '../use-redemption'

let client: QueryClient

function wrapper(props: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'a', role: 1, quota: 0 })
})

afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

it('sends the trimmed code and updates the shared balance after redeeming', async () => {
  const redeem = vi
    .spyOn(walletApi, 'redeemTopupCode')
    .mockResolvedValue({ success: true, message: '', data: 500000 } as never)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { id: 1, username: 'a', role: 1, quota: 500000 },
    },
  })
  const { result } = renderHook(() => useRedemption(), { wrapper })

  let ok = false
  await act(async () => {
    ok = await result.current.redeemCode('  ABC-123 \n')
  })

  expect(ok).toBe(true)
  expect(redeem).toHaveBeenCalledWith({ key: 'ABC-123' })
  expect(useAuthStore.getState().auth.user?.quota).toBe(500000)
})

it('refuses a code that is only whitespace without calling the server', async () => {
  const redeem = vi.spyOn(walletApi, 'redeemTopupCode')
  const { result } = renderHook(() => useRedemption(), { wrapper })

  let ok = true
  await act(async () => {
    ok = await result.current.redeemCode('   ')
  })

  expect(ok).toBe(false)
  expect(redeem).not.toHaveBeenCalled()
})
