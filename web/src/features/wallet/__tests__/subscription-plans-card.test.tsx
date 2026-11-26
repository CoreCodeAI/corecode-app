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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as subscriptionApi from '@/features/subscriptions/api'
import type { PlanRecord } from '@/features/subscriptions/types'

import { SubscriptionPlansCard } from '../components/subscription-plans-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => children ?? null,
}))
vi.mock('@/features/plan-gate/hooks/use-plan-gate-notice', () => ({
  usePlanGateNotice: () => ({ data: undefined }),
}))

const plan: PlanRecord = {
  plan: {
    id: 1,
    title: 'Starter pack',
    price_amount: 9.9,
    currency: 'USD',
    duration_unit: 'day',
    duration_value: 7,
    quota_reset_period: 'never',
    enabled: true,
    sort_order: 0,
    allow_balance_pay: false,
    allow_wallet_overflow: true,
    max_purchase_per_user: 1,
    total_amount: 6000000,
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function selfSubscription(preference: string) {
  return {
    success: true,
    message: '',
    data: {
      billing_preference: preference,
      subscriptions: [],
      all_subscriptions: [],
    },
  }
}

// Opens the billing select and picks one option the way a mouse does
async function choose(select: HTMLElement, name: string) {
  fireEvent.mouseDown(select, { button: 0 })
  const option = await screen.findByRole('option', { name })
  fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(option, { button: 0 })
  fireEvent.mouseUp(option, { button: 0 })
  fireEvent.click(option)
}

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SubscriptionPlansCard topupInfo={null} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.spyOn(subscriptionApi, 'getSelfSubscriptionFull').mockResolvedValue(
    selfSubscription('subscription_first') as never
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('subscription plans card', () => {
  // A plans request that fails after a good load keeps the plans on screen;
  // Refresh asks for the plans again as well as the subscription.
  it('keeps the last good plans when a refresh fails, and Refresh refetches plans', async () => {
    const getPlans = vi
      .spyOn(subscriptionApi, 'getPublicPlans')
      .mockResolvedValueOnce({
        success: true,
        message: '',
        data: [plan],
      } as never)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        success: true,
        message: '',
        data: [plan],
      } as never)
    renderCard()

    expect(await screen.findByText('Starter pack')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(getPlans).toHaveBeenCalledTimes(2))

    expect(screen.getByText('Starter pack')).toBeVisible()
    expect(screen.queryByText('Failed to load plans')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(getPlans).toHaveBeenCalledTimes(3))
  })

  // A first load that fails shows the error with a retry, not a hidden section;
  // Retry then loads the plans.
  it('shows an error with retry after a transient failure, then loads the plans', async () => {
    const getPlans = vi
      .spyOn(subscriptionApi, 'getPublicPlans')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        success: true,
        message: '',
        data: [plan],
      } as never)
    renderCard()

    expect(await screen.findByText('Failed to load plans')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Starter pack')).toBeVisible()
    expect(getPlans).toHaveBeenCalledTimes(2)
  })

  // The earlier change fails after a later one is sent. Its failure must not
  // roll the select back; the later choice stays and the server value wins.
  it('does not let a failed earlier change roll back a newer choice', async () => {
    vi.spyOn(subscriptionApi, 'getPublicPlans').mockResolvedValue({
      success: true,
      message: '',
      data: [plan],
    } as never)
    const first = deferred<never>()
    vi.spyOn(subscriptionApi, 'updateBillingPreference')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        success: true,
        message: '',
        data: { billing_preference: 'wallet_only' },
      } as never)
    renderCard()

    await screen.findByText('Starter pack')
    const select = screen.getByRole('combobox')
    await choose(select, 'Wallet First')
    await choose(select, 'Wallet Only')
    await waitFor(() =>
      expect(screen.getByRole('combobox')).toHaveTextContent('Wallet Only')
    )

    first.reject(new Error('network down'))
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByRole('combobox')).toHaveTextContent('Wallet Only')
  })
})
