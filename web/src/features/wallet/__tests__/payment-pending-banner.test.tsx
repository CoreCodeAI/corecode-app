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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { PaymentPendingBanner } from '../components/payment-pending-banner'

afterEach(() => {
  cleanup()
})

it('renders nothing while no payment is being watched', () => {
  const { container } = render(
    <PaymentPendingBanner
      status='idle'
      onOpenBilling={vi.fn()}
      onDismiss={vi.fn()}
    />
  )

  expect(container).toBeEmptyDOMElement()
})

it('offers only a dismiss while waiting', async () => {
  const onDismiss = vi.fn()
  render(
    <PaymentPendingBanner
      status='waiting'
      onOpenBilling={vi.fn()}
      onDismiss={onDismiss}
    />
  )

  expect(
    screen.queryByRole('button', { name: 'Open Order History' })
  ).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

it('points to Order History once the wait times out', async () => {
  const onOpenBilling = vi.fn()
  render(
    <PaymentPendingBanner
      status='timeout'
      onOpenBilling={onOpenBilling}
      onDismiss={vi.fn()}
    />
  )

  await userEvent.click(
    screen.getByRole('button', { name: 'Open Order History' })
  )

  expect(onOpenBilling).toHaveBeenCalledTimes(1)
})
