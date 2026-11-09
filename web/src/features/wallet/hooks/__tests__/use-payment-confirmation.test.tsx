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
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import {
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_WAIT_TIMEOUT_MS,
  usePaymentConfirmation,
} from '../use-payment-confirmation'

const QUOTA_PER_DOLLAR = 500_000
let client: QueryClient
let serverQuota = 0

function wrapper(props: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  serverQuota = 0
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'a', role: 1, quota: 0 })
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: {
      success: true,
      data: { id: 1, username: 'a', role: 1, quota: serverQuota },
    },
  }))
  vi.spyOn(toast, 'success').mockImplementation(() => 1)
})

afterEach(() => {
  vi.useRealTimers()
  client.clear()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('waiting for a payment to land', () => {
  it('toasts the added amount once and stops when the balance rises', async () => {
    const { result } = renderHook(() => usePaymentConfirmation(), { wrapper })
    act(() => result.current.start(0))
    expect(result.current.status).toBe('waiting')

    await tick(PAYMENT_POLL_INTERVAL_MS)
    expect(toast.success).not.toHaveBeenCalled()

    serverQuota = 10 * QUOTA_PER_DOLLAR
    await tick(PAYMENT_POLL_INTERVAL_MS)
    await tick(PAYMENT_POLL_INTERVAL_MS * 3)

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('$10')
    expect(result.current.status).toBe('idle')
  })

  it('polls again when the tab becomes visible', async () => {
    const { result } = renderHook(() => usePaymentConfirmation(), { wrapper })
    act(() => result.current.start(0))
    serverQuota = QUOTA_PER_DOLLAR

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('ends as pending after three minutes without credit and stops polling', async () => {
    const { result } = renderHook(() => usePaymentConfirmation(), { wrapper })
    act(() => result.current.start(0))

    await tick(PAYMENT_WAIT_TIMEOUT_MS)
    expect(result.current.status).toBe('timeout')
    const calls = vi.mocked(api.get).mock.calls.length

    await tick(PAYMENT_POLL_INTERVAL_MS * 5)
    expect(vi.mocked(api.get).mock.calls.length).toBe(calls)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('stops watching when dismissed', async () => {
    const { result } = renderHook(() => usePaymentConfirmation(), { wrapper })
    act(() => result.current.start(0))
    act(() => result.current.dismiss())
    serverQuota = QUOTA_PER_DOLLAR

    await tick(PAYMENT_POLL_INTERVAL_MS * 2)

    expect(result.current.status).toBe('idle')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('clears its timers on unmount', async () => {
    const { result, unmount } = renderHook(() => usePaymentConfirmation(), {
      wrapper,
    })
    act(() => result.current.start(0))
    unmount()
    serverQuota = QUOTA_PER_DOLLAR

    await tick(PAYMENT_POLL_INTERVAL_MS * 2)

    expect(api.get).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
