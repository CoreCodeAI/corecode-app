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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as subscriptionApi from '../api'
import { UserSubscriptionsDialog } from '../components/dialogs/user-subscriptions-dialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockApi(exempt: boolean) {
  vi.spyOn(subscriptionApi, 'getAdminPlans').mockResolvedValue({
    success: true,
    data: [],
  })
  vi.spyOn(subscriptionApi, 'getUserSubscriptions').mockResolvedValue({
    success: true,
    data: [],
  })
  vi.spyOn(subscriptionApi, 'getUserAddressExemption').mockResolvedValue({
    success: true,
    data: { exempt },
  })
  return vi
    .spyOn(subscriptionApi, 'setUserAddressExemption')
    .mockImplementation(async (_userId, value) => ({
      success: true,
      data: { exempt: value },
    }))
}

describe('shared network purchase exemption', () => {
  it('shows the saved state and saves a change for the user', async () => {
    const save = mockApi(false)
    render(
      <UserSubscriptionsDialog
        open
        onOpenChange={vi.fn()}
        user={{ id: 2582, username: 'customer' }}
      />
    )

    const toggle = await screen.findByRole('switch', {
      name: 'Allow purchase from a shared network',
    })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)

    await waitFor(() => expect(save).toHaveBeenCalledWith(2582, true))
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('reads an existing exemption as on', async () => {
    mockApi(true)
    render(
      <UserSubscriptionsDialog
        open
        onOpenChange={vi.fn()}
        user={{ id: 7, username: 'customer' }}
      />
    )

    const toggle = await screen.findByRole('switch', {
      name: 'Allow purchase from a shared network',
    })
    await waitFor(() => expect(toggle).toBeChecked())
  })
})
