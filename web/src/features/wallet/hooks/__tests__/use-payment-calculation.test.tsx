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
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { usePayment } from '../use-payment'

afterEach(() => {
  vi.restoreAllMocks()
})

it('reports a failed calculation instead of showing a free amount', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'error', data: '' },
  })
  const { result } = renderHook(() => usePayment())

  let priced: number | null = 0
  await act(async () => {
    priced = await result.current.calculatePaymentAmount(10, 'alipay')
  })

  expect(priced).toBeNull()
  expect(result.current.calculationFailed).toBe(true)
})

it('clears the failure once a later calculation succeeds', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({
      data: { success: true, message: 'success', data: '7.50' },
    })
  const { result } = renderHook(() => usePayment())

  await act(async () => {
    await result.current.calculatePaymentAmount(10, 'alipay')
  })
  expect(result.current.calculationFailed).toBe(true)

  await act(async () => {
    await result.current.calculatePaymentAmount(10, 'alipay')
  })

  expect(post).toHaveBeenCalledTimes(2)
  expect(result.current.calculationFailed).toBe(false)
  expect(result.current.amount).toBe(7.5)
})

it('keeps the HKD amount a Stripe quote carries, and drops a bad one', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: {
        success: true,
        message: 'success',
        data: '300.00',
        hkd_amount: '351.15',
      },
    })
    .mockResolvedValueOnce({
      data: {
        success: true,
        message: 'success',
        data: '300.00',
        hkd_amount: 'oops',
      },
    })
  const { result } = renderHook(() => usePayment())

  await act(async () => {
    await result.current.calculatePaymentAmount(300, 'stripe_card')
  })
  expect(result.current.amount).toBe(300)
  expect(result.current.hkdAmount).toBe(351.15)

  await act(async () => {
    await result.current.calculatePaymentAmount(300, 'stripe_card')
  })
  expect(result.current.amount).toBe(300)
  expect(result.current.hkdAmount).toBeUndefined()
  expect(post).toHaveBeenCalledTimes(2)
})
