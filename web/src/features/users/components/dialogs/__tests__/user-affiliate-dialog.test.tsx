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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { formatQuota } from '@/lib/format'

import { UserAffiliateDialog } from '../user-affiliate-dialog'

const view = {
  enabled: true,
  self_serve_rate: 10,
  second_level_rate: 5,
  min_withdrawal: 100,
  affiliate: {
    id: 1,
    user_id: 9,
    rate: 10,
    channel: false,
    tier: '' as const,
    granted_by: 0,
    balance: 0,
    earned: 0,
    created_at: 1,
    updated_at: 1,
  },
  aff_code: 'XY',
  invitee_count: 2,
  balance_money: 0,
  earned_money: 0,
  max_rate: 30,
  inviter_id: 3,
  inviter_name: 'boss',
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderDialog() {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.startsWith('/api/user/search')) {
      return {
        data: {
          success: true,
          data: {
            items: [
              { id: 9, username: 'alice', email: 'alice@example.com' },
              { id: 5, username: 'carol', email: 'carol@example.com' },
            ],
            total: 2,
            page: 1,
            page_size: 6,
          },
        },
      }
    }
    if (url.endsWith('/invitees')) {
      return {
        data: {
          success: true,
          data: {
            items: [],
            total: 2,
            page: 1,
            page_size: 10,
            totals: {
              used_quota: 1_200_000,
              commission_base: 900_000,
              commission: 180_000,
            },
          },
        },
      }
    }
    if (url.endsWith('/commissions')) {
      return {
        data: {
          success: true,
          data: { items: [], total: 0, page: 1, page_size: 10 },
        },
      }
    }
    return { data: { success: true, data: view } }
  })
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UserAffiliateDialog
        open
        onOpenChange={() => {}}
        user={{ id: 9, username: 'alice' }}
      />
    </QueryClientProvider>
  )
}

it('shows the inviter and saves the new rate and channel tier', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...view,
        affiliate: {
          ...view.affiliate,
          rate: 15,
          channel: true,
          tier: 'retail' as const,
        },
      },
    },
  })
  const user = userEvent.setup()
  renderDialog()

  expect(await screen.findByText('boss #3')).toBeVisible()
  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toBeDisabled()

  const rate = screen.getByLabelText('Commission rate (%)')
  await user.clear(rate)
  await user.type(rate, '15')
  await user.click(screen.getByRole('radio', { name: /Retail channel/ }))
  await user.click(save)

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/affiliate/admin/users/9', {
      rate: 15,
      tier: 'retail',
    })
  )
})

it('shows what the invitees spent and the commission they earned', async () => {
  renderDialog()

  expect(await screen.findByText('Invitee spend')).toBeVisible()
  expect(await screen.findByText(formatQuota(1_200_000))).toBeVisible()
  expect(screen.getByText('Commission from invitees')).toBeVisible()
  expect(screen.getByText(formatQuota(180_000))).toBeVisible()
})

it('blocks a rate above the configured maximum', async () => {
  const put = vi.spyOn(api, 'put')
  const user = userEvent.setup()
  renderDialog()

  const rate = await screen.findByLabelText('Commission rate (%)')
  await user.clear(rate)
  await user.type(rate, '31')

  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(put).not.toHaveBeenCalled()
})

it('finds a new inviter by email and binds the user to them', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: { ...view, inviter_id: 5, inviter_name: 'carol' },
    },
  })
  const user = userEvent.setup()
  renderDialog()

  const setInviter = await screen.findByRole('button', { name: 'Set inviter' })
  expect(setInviter).toBeDisabled()
  await user.type(screen.getByLabelText('Change inviter'), 'carol@example')
  const carol = await screen.findByRole('button', { name: /carol/ })
  expect(screen.queryByRole('button', { name: /alice/ })).toBeNull()
  await user.click(carol)
  await user.click(setInviter)

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/affiliate/admin/users/9/inviter', {
      inviter_id: 5,
    })
  )
  expect(await screen.findByText('carol #5')).toBeVisible()
})

it('removes the inviter', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { ...view, inviter_id: 0, inviter_name: '' } },
  })
  const user = userEvent.setup()
  renderDialog()

  await user.click(
    await screen.findByRole('button', { name: 'Remove inviter' })
  )

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/affiliate/admin/users/9/inviter', {
      inviter_id: 0,
    })
  )
})

it('replaces the invite code and shows the new link', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { ...view, aff_code: 'partner-01' } },
  })
  const user = userEvent.setup()
  renderDialog()

  const code = await screen.findByLabelText('Invite code')
  expect(screen.getByLabelText('Referral link')).toHaveValue(
    `${window.location.origin}/sign-in?ref=XY`
  )
  const save = screen.getByRole('button', { name: 'Save invite code' })
  await user.clear(code)
  await user.type(code, 'a b')
  expect(save).toBeDisabled()

  await user.clear(code)
  await user.type(code, 'partner-01')
  await user.click(save)

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/affiliate/admin/users/9/code', {
      aff_code: 'partner-01',
    })
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Referral link')).toHaveValue(
      `${window.location.origin}/sign-in?ref=partner-01`
    )
  )
})
