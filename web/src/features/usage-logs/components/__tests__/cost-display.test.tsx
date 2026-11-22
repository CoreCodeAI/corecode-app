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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type React from 'react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import { LogCostDisplay } from '../log-cost-display'

function renderCost(
  props: React.ComponentProps<typeof LogCostDisplay>
): ReturnType<typeof render> {
  return render(<LogCostDisplay {...props} />)
}

describe('log cost display', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      Subscription: 'Subscription',
      Wallet: 'Wallet',
      'Includes tool-call surcharge': 'Includes tool-call surcharge',
    })
  })

  beforeEach(() => {
    useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  })

  afterEach(() => {
    useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
    localStorage.clear()
  })

  test.each([
    { consumed: 12500, expected: '$0.025' },
    { consumed: 0, expected: '$0' },
    { consumed: 1, expected: '$0.000002' },
    { consumed: undefined, expected: '$0.01' },
  ])(
    'shows subscription deduction $consumed without hover, falling back only when absent',
    ({ consumed, expected }) => {
      renderCost({
        quota: 5000,
        other: {
          billing_source: 'subscription',
          subscription_consumed: consumed,
        },
        showBillingSource: true,
      })

      expect(screen.getByText(expected)).toBeVisible()
      expect(screen.getByRole('img', { name: 'Subscription' })).toBeVisible()
      expect(screen.queryByText('Subscription')).not.toBeInTheDocument()
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    }
  )

  test('shows wallet cost and source icon without using subscription metadata', () => {
    renderCost({
      quota: 5000,
      other: { billing_source: 'wallet', subscription_consumed: 12500 },
      showBillingSource: true,
    })

    expect(screen.getByText('$0.01')).toBeVisible()
    expect(screen.getByRole('img', { name: 'Wallet' })).toBeVisible()
    expect(screen.queryByText('Wallet')).not.toBeInTheDocument()
    expect(screen.queryByText('Subscription')).not.toBeInTheDocument()
  })

  test.each([
    ['wallet', 'Newcomer plan paused · charged to balance'],
    ['other_plan', 'Newcomer plan paused · charged to another plan'],
  ])('marks a request the newcomer plan limit moved (%s)', (kind, label) => {
    renderCost({
      quota: 5000,
      other: { billing_source: 'wallet', limited_plan_gate: kind },
      showBillingSource: true,
    })

    expect(screen.getByText(label)).toHaveAttribute('data-plan-gate', kind)
  })

  test('marks nothing on a wallet charge the limit did not cause', () => {
    renderCost({
      quota: 5000,
      other: { billing_source: 'wallet', limited_plan_gate: 'banana' },
      showBillingSource: true,
    })

    expect(screen.queryByText(/Newcomer plan paused/)).not.toBeInTheDocument()
  })

  test('hides the wallet icon when subscriptions are unavailable', () => {
    renderCost({
      quota: 5000,
      other: { billing_source: 'wallet' },
      showBillingSource: false,
    })

    expect(screen.getByText('$0.01')).toBeVisible()
    expect(screen.queryByText('Wallet')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('keeps the subscription icon on a subscription-billed log when billing sources are hidden', () => {
    renderCost({
      quota: 5000,
      other: { billing_source: 'subscription', subscription_consumed: 12500 },
      showBillingSource: false,
    })

    expect(screen.getByText('$0.025')).toBeVisible()
    expect(screen.getByRole('img', { name: 'Subscription' })).toBeVisible()
    expect(
      screen.queryByRole('img', { name: 'Wallet' })
    ).not.toBeInTheDocument()
  })

  test('keeps legacy cost visible without inventing a funding source', () => {
    renderCost({ quota: 5000, other: null })

    expect(screen.getByText('$0.01')).toBeVisible()
    expect(screen.queryByText('Wallet')).not.toBeInTheDocument()
    expect(screen.queryByText('Subscription')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('keeps a large amount unabridged in a single-line cost bubble', () => {
    const rendered = renderCost({
      quota: 2147483647,
      other: { billing_source: 'subscription' },
      showBillingSource: true,
    })

    const amount = screen.getByText('$4,294.9673')
    expect(amount).toBeVisible()
    expect(amount).toHaveClass('whitespace-nowrap')
    expect(amount.closest('[data-slot="status-badge"]')).toHaveClass(
      'border',
      'rounded-md',
      'tabular-nums'
    )
    expect(rendered.container.firstElementChild).toHaveClass('inline-flex')
    expect(rendered.container.firstElementChild).not.toHaveClass('flex-col')
    expect(screen.getByRole('img', { name: 'Subscription' })).toBeVisible()
  })

  test.each([
    { source: 'subscription', label: 'Subscription' },
    { source: 'wallet', label: 'Wallet' },
  ])(
    'vertically centers the $source icon within its container',
    ({ source, label }) => {
      renderCost({
        quota: 5000,
        other: { billing_source: source },
        showBillingSource: true,
      })

      // Mobile cards give inline-flex descendants a minimum height, so the
      // source container must center its smaller icon independently of the badge.
      expect(screen.getByRole('img', { name: label })).toHaveClass(
        'inline-flex',
        'items-center'
      )
    }
  )

  test.each([
    { source: 'subscription', label: 'Subscription' },
    { source: 'wallet', label: 'Wallet' },
  ])(
    'reveals the $source label on hover and keyboard focus',
    async ({ source, label }) => {
      const user = userEvent.setup()
      renderCost({
        quota: 5000,
        other: { billing_source: source },
        showBillingSource: true,
      })

      const marker = screen.getByRole('img', { name: label })
      expect(screen.queryByText(label)).not.toBeInTheDocument()

      await user.hover(marker)
      expect(await screen.findByText(label)).toBeVisible()
      await user.unhover(marker)
      await waitFor(() =>
        expect(screen.queryByText(label)).not.toBeInTheDocument()
      )
      await user.tab()
      expect(marker).toHaveFocus()
      expect(await screen.findByText(label)).toBeVisible()
    }
  )

  test('keeps the regular cost visible and adds an accessible surcharge marker', () => {
    renderCost({
      quota: 12500,
      other: {
        tool_surcharges: [{ name: 'lookup_customer', count: 1, price: 5 }],
      },
    })

    expect(screen.getByText('$0.025')).toBeVisible()
    const marker = screen.getByRole('img', {
      name: 'Includes tool-call surcharge',
    })
    expect(marker).toHaveAttribute('data-tool-surcharge-indicator', 'true')
    expect(marker).toHaveAttribute('tabindex', '0')
  })

  test('shows subscription cost and source alongside the legacy surcharge marker', () => {
    renderCost({
      quota: 5000,
      other: {
        billing_source: 'subscription',
        web_search: true,
        web_search_call_count: 1,
        web_search_price: 10,
      },
      showBillingSource: true,
    })

    expect(screen.getByText('$0.01')).toBeVisible()
    expect(screen.getByRole('img', { name: 'Subscription' })).toBeVisible()
    expect(
      screen.getByRole('img', { name: 'Includes tool-call surcharge' })
    ).toHaveAttribute('data-tool-surcharge-indicator', 'true')
  })

  test('marks a charge verified against the listed prices only when asked', () => {
    const { rerender } = renderCost({
      quota: 5000,
      other: null,
      verified: true,
    })

    expect(
      screen.getByRole('img', { name: 'Matches the listed prices' })
    ).toHaveAttribute('tabindex', '0')

    rerender(<LogCostDisplay quota={5000} other={null} />)
    expect(
      screen.queryByRole('img', { name: 'Matches the listed prices' })
    ).not.toBeInTheDocument()
  })

  test('tags a charge that had no output and explains it on hover', async () => {
    const user = userEvent.setup()
    renderCost({
      quota: 5000,
      other: null,
      zeroOutput: { kind: 'general' },
    })

    const tag = screen.getByText('No output')
    expect(tag).toBeVisible()
    await user.hover(tag)
    expect(
      await screen.findByText(/no output means no output fee/)
    ).toBeVisible()
  })

  test('names a refusal in the tag text instead of the general causes', async () => {
    const user = userEvent.setup()
    renderCost({
      quota: 5000,
      other: null,
      zeroOutput: { kind: 'refusal', category: 'cybersecurity' },
    })

    await user.hover(screen.getByText('No output'))
    const tip = await screen.findByText(/category: cybersecurity/)
    expect(tip).toBeVisible()
    expect(tip).not.toHaveTextContent('client disconnected')
  })

  test('shows the cache outcome beside the cost', () => {
    const { rerender } = renderCost({
      quota: 5000,
      other: null,
      cacheBadge: { kind: 'hit', percent: 98 },
    })
    expect(screen.getByText('Cache 98%')).toBeVisible()

    rerender(
      <LogCostDisplay quota={5000} other={null} cacheBadge={{ kind: 'miss' }} />
    )
    expect(screen.getByText('Cache miss · full price')).toBeVisible()
    expect(screen.queryByText('Cache 98%')).not.toBeInTheDocument()
  })

  test('adds no tags to an ordinary charge', () => {
    renderCost({ quota: 5000, other: null })

    expect(screen.queryByText('No output')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Cache /)).not.toBeInTheDocument()
  })
})
