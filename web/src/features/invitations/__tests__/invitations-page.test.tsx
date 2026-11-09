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
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { formatQuota } from '@/lib/format'

import { Invitations } from '..'
import type { InviteePage } from '../types'

const QUOTA = 500_000

const summary = {
  enabled: true,
  self_serve_rate: 10,
  second_level_rate: 5,
  min_withdrawal: 100,
  affiliate: null,
  aff_code: '',
  invitee_count: 0,
  balance_money: 0,
  earned_money: 0,
}

function renderPage(
  page: InviteePage,
  affiliate: Partial<typeof summary> = {}
) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => ({
    data: {
      success: true,
      data:
        url === '/api/affiliate/self/invitees'
          ? page
          : { ...summary, ...affiliate },
    },
  }))
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const invitations = createRoute({
    getParentRoute: () => auth,
    path: '/invitations/',
    component: Invitations,
  })
  const wallet = createRoute({ getParentRoute: () => auth, path: '/wallet' })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([invitations, wallet])]),
    history: createMemoryHistory({ initialEntries: ['/invitations/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return get
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('lists each invitee with their spend and commission, and totals over all invitees', async () => {
  const get = renderPage(
    {
      items: [
        {
          id: 3,
          name: 'alice',
          email: 'alice@example.com',
          created_at: 1,
          used_quota: 12 * QUOTA,
          commission_base: 10 * QUOTA,
          commission: QUOTA,
          gift_plan: '',
        },
        {
          id: 2,
          name: 'bob',
          email: '',
          created_at: 2,
          used_quota: 0,
          commission_base: 0,
          commission: 0,
          gift_plan: '',
        },
      ],
      total: 12,
      page: 1,
      page_size: 20,
      totals: {
        used_quota: 100 * QUOTA,
        commission_base: 300 * QUOTA,
        commission: 30 * QUOTA,
      },
      second_level: {
        invitee_count: 1,
        commission_base: 0,
        commission: 0,
        source_count: 1,
        sources: [],
      },
      gift_plan_title: '',
    },
    {
      affiliate: {
        id: 1,
        user_id: 7,
        rate: 10,
        channel: false,
        granted_by: 0,
        balance: 5 * QUOTA,
        earned: 30 * QUOTA,
        created_at: 1,
        updated_at: 1,
      } as never,
      aff_code: 'AB12',
    }
  )

  const row = (await screen.findByText('alice')).closest('tr')
  expect(row).not.toBeNull()
  expect(
    within(row as HTMLElement).getByText('alice@example.com')
  ).toBeVisible()
  expect(
    within(row as HTMLElement).getByText(formatQuota(12 * QUOTA))
  ).toBeVisible()
  expect(
    within(row as HTMLElement).getByText(formatQuota(10 * QUOTA))
  ).toBeVisible()
  expect(within(row as HTMLElement).getByText(formatQuota(QUOTA))).toBeVisible()
  expect(screen.getByText('bob')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Gift' })).toBeNull()

  const stats = screen.getByText('Invites').closest('dl') as HTMLElement
  expect(within(stats).getByText('12')).toBeVisible()
  expect(within(stats).getByText(formatQuota(100 * QUOTA))).toBeVisible()
  expect(within(stats).getByText(formatQuota(30 * QUOTA))).toBeVisible()
  expect(within(stats).getByText(formatQuota(5 * QUOTA))).toBeVisible()

  const link = (await screen.findByLabelText(
    'Referral link'
  )) as HTMLInputElement
  expect(link.value).toMatch(/ref=AB12$/)
  expect(screen.getByText('Rate 10%')).toBeVisible()
  expect(screen.queryByText('Promotion channel')).toBeNull()
  expect(within(stats).getByText('Commission from invitees')).toBeVisible()
  expect(
    screen.queryByText('Second-level commission'),
    'a user who is not a distributor and earned nothing there sees no second level'
  ).toBeNull()
  expect(get).toHaveBeenCalledWith('/api/affiliate/self/invitees', {
    params: { p: 1, page_size: 20 },
  })
})

it('says invitations are unavailable when the user has no rate and shows the empty state', async () => {
  renderPage({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
    totals: { used_quota: 0, commission_base: 0, commission: 0 },
    gift_plan_title: '',
  })

  expect(await screen.findByText('No invitees yet')).toBeVisible()
  expect(
    screen.getByText('Invitations are not available for your account.')
  ).toBeVisible()
  expect(screen.queryByLabelText('Referral link')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull()
  expect(screen.queryByText(/^Rate /)).toBeNull()
})

it('marks a promotion channel next to its rate', async () => {
  renderPage(
    {
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
      totals: { used_quota: 0, commission_base: 0, commission: 0 },
      gift_plan_title: '',
    },
    {
      affiliate: {
        id: 1,
        user_id: 7,
        rate: 30,
        channel: true,
        granted_by: 1,
        balance: 0,
        earned: 0,
        created_at: 1,
        updated_at: 1,
      } as never,
      aff_code: 'CH01',
    }
  )

  expect(await screen.findByText('Rate 30%')).toBeVisible()
  expect(screen.getByText('Promotion channel')).toBeVisible()
})

it('shows a distributor the second level, how it adds up, and who brought it in', async () => {
  renderPage(
    {
      items: [],
      total: 5,
      page: 1,
      page_size: 20,
      totals: {
        used_quota: 0,
        commission_base: 10 * QUOTA,
        commission: 3 * QUOTA,
      },
      second_level: {
        invitee_count: 4,
        commission_base: 20 * QUOTA,
        commission: QUOTA,
        source_count: 3,
        sources: [
          {
            id: 181,
            name: 'james',
            invitee_count: 1,
            commission_base: 20 * QUOTA,
            commission: QUOTA,
          },
        ],
      },
      gift_plan_title: '',
    },
    {
      affiliate: {
        id: 1,
        user_id: 9,
        rate: 30,
        channel: true,
        tier: 'distributor',
        granted_by: 1,
        balance: 2 * QUOTA,
        earned: 4 * QUOTA,
        created_at: 1,
        updated_at: 1,
      } as never,
      aff_code: 'Tttb',
    }
  )

  const card = (await screen.findByText('Second-level commission')).closest(
    '[data-slot="card"]'
  ) as HTMLElement
  expect(
    within(card).getByText(
      'When users you invited invite others, you also earn 5% of what those users pay to use.'
    )
  ).toBeVisible()
  expect(within(card).getByText('Second level 5%')).toBeVisible()
  expect(
    within(card).getByText('You earn 30% of their paid spend')
  ).toBeVisible()
  expect(
    within(card).getByText('You earn 5% of their paid spend')
  ).toBeVisible()

  const split = within(card)
    .getByText('Where your commission comes from')
    .closest('section') as HTMLElement
  const share = (label: string) =>
    within(split).getByText(label, { selector: 'dt' }).nextElementSibling
  expect(share('Direct invitees')).toHaveTextContent(formatQuota(3 * QUOTA))
  expect(share('Direct invitees')).toHaveTextContent('75%')
  expect(share('Second level')).toHaveTextContent(formatQuota(QUOTA))
  expect(share('Second level')).toHaveTextContent('25%')
  expect(share('Earned in total')).toHaveTextContent(formatQuota(4 * QUOTA))

  const row = within(card)
    .getByText('james', { selector: 'td' })
    .closest('tr') as HTMLElement
  expect(within(row).getByText(formatQuota(20 * QUOTA))).toBeVisible()
  expect(within(row).getByText(formatQuota(QUOTA))).toBeVisible()
  expect(
    within(card).getByText('Showing the 1 invitees who earned you the most.')
  ).toBeVisible()

  const stats = screen.getByText('Invites').closest('dl') as HTMLElement
  expect(
    within(stats).getByText('Direct commission'),
    'next to a second level, the overview names its figure as direct'
  ).toBeVisible()
})

it('reports which invitees received the plan at sign-up, with nothing to click', async () => {
  const invitee = (
    id: number,
    name: string,
    gift_plan: '' | 'gifted' | 'owned'
  ) => ({
    id,
    name,
    email: '',
    created_at: id,
    used_quota: 0,
    commission_base: 0,
    commission: 0,
    gift_plan,
  })
  renderPage({
    items: [
      invitee(3, 'carol', ''),
      invitee(2, 'bob', 'gifted'),
      invitee(1, 'alice', 'owned'),
    ],
    total: 3,
    page: 1,
    page_size: 20,
    totals: { used_quota: 0, commission_base: 0, commission: 0 },
    gift_plan_title: 'Trial pack',
  })

  expect(await screen.findByText('carol')).toBeVisible()
  expect(screen.getByText('Trial pack')).toBeVisible()
  expect(screen.getByText('Gifted')).toBeVisible()
  expect(screen.getByText('Already has it')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Gift' })).toBeNull()
})

it('lets an inviter replace the code in their link', async () => {
  const account = {
    id: 1,
    user_id: 7,
    rate: 10,
    channel: false,
    granted_by: 0,
    balance: 0,
    earned: 0,
    created_at: 1,
    updated_at: 1,
  } as never
  renderPage(
    {
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
      totals: { used_quota: 0, commission_base: 0, commission: 0 },
      gift_plan_title: '',
    },
    { affiliate: account, aff_code: 'AB12' }
  )
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: { ...summary, affiliate: account, aff_code: 'alice-ai' },
    },
  })
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'Customize' }))
  const input = screen.getByLabelText('Invite code')
  expect(input).toHaveValue('AB12')
  const save = screen.getByRole('button', { name: 'Save invite code' })
  expect(save).toBeDisabled()

  await user.clear(input)
  await user.type(input, 'a b')
  expect(save).toBeDisabled()
  await user.clear(input)
  await user.type(input, ' alice-ai ')
  await user.click(save)

  expect(put).toHaveBeenCalledWith('/api/affiliate/self/code', {
    aff_code: 'alice-ai',
  })
  const link = (await screen.findByLabelText(
    'Referral link'
  )) as HTMLInputElement
  await vi.waitFor(() => expect(link.value).toMatch(/ref=alice-ai$/))
})
