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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { UserInfoDialog } from '../components/dialogs/user-info-dialog'

const QUOTA_PER_DOLLAR = 500_000

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function subscription(fields: object) {
  const now = Math.floor(Date.now() / 1000)
  return {
    subscription: {
      id: 1,
      user_id: 7,
      plan_id: 1,
      status: 'active',
      start_time: now - 86_400,
      end_time: now + 86_400,
      amount_total: 0,
      amount_used: 0,
      ...fields,
    },
  }
}

function renderDialog(
  subscriptions: object[] | Error,
  inviter = { inviter_id: 0, inviter_name: '' },
  user: object = {}
) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/user/7') {
      return {
        data: {
          success: true,
          data: { id: 7, username: 'alice', quota: 0, used_quota: 0, ...user },
        },
      }
    }
    if (url === '/api/subscription/admin/users/7/subscriptions') {
      if (subscriptions instanceof Error) throw subscriptions
      return { data: { success: true, data: subscriptions } }
    }
    if (url === '/api/affiliate/admin/users/7') {
      return { data: { success: true, data: inviter } }
    }
    throw new Error(`unexpected ${url}`)
  })
  render(<UserInfoDialog userId={7} open onOpenChange={() => {}} />)
}

async function subscriptionRemaining() {
  const label = await screen.findByText('Subscription Remaining')
  return label.nextElementSibling
}

it('sums what is left on active subscriptions only', async () => {
  const now = Math.floor(Date.now() / 1000)
  renderDialog([
    subscription({
      amount_total: 30 * QUOTA_PER_DOLLAR,
      amount_used: 10 * QUOTA_PER_DOLLAR,
    }),
    subscription({
      amount_total: 5 * QUOTA_PER_DOLLAR,
      amount_used: 0,
    }),
    subscription({
      amount_total: 100 * QUOTA_PER_DOLLAR,
      end_time: now - 60,
    }),
    subscription({
      amount_total: 100 * QUOTA_PER_DOLLAR,
      status: 'cancelled',
    }),
  ])

  expect(await subscriptionRemaining()).toHaveTextContent('$25')
})

it('reports an active subscription without a quota cap as unlimited', async () => {
  renderDialog([
    subscription({ amount_total: 30 * QUOTA_PER_DOLLAR }),
    subscription({ amount_total: 0 }),
  ])

  expect(await subscriptionRemaining()).toHaveTextContent('Unlimited')
})

it('says when the user has no active subscription', async () => {
  renderDialog([subscription({ status: 'expired' })])

  expect(await subscriptionRemaining()).toHaveTextContent(
    'No active subscription'
  )
})

it('keeps the user information when the subscription lookup fails', async () => {
  renderDialog(new Error('network'))

  expect(await subscriptionRemaining()).toHaveTextContent('-')
  expect(screen.getByText('alice')).toBeVisible()
})

it('names the inviter of an invited user', async () => {
  renderDialog([], { inviter_id: 3, inviter_name: 'bob' })

  const label = await screen.findByText('Inviter')
  expect(label.nextElementSibling).toHaveTextContent('bob')
})

it('shows a dash for a user nobody invited', async () => {
  renderDialog([])

  const label = await screen.findByText('Inviter')
  expect(label.nextElementSibling).toHaveTextContent(/^-$/)
})

it('shows the remark an admin left on the user', async () => {
  renderDialog([], undefined, { remark: 'VIP, refund once' })

  const label = await screen.findByText('Remark')
  expect(label.nextElementSibling).toHaveTextContent('VIP, refund once')
})

it('shows a dash for a user without a remark', async () => {
  renderDialog([])

  const label = await screen.findByText('Remark')
  expect(label.nextElementSibling).toHaveTextContent(/^-$/)
})
