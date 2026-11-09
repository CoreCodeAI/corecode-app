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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { AffiliateRewardsCard } from '../components/affiliate-rewards-card'
import type { AffiliateSummary, UserWalletData } from '../types'

const baseSummary: AffiliateSummary = {
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

function account(
  overrides: Partial<NonNullable<AffiliateSummary['affiliate']>>
): NonNullable<AffiliateSummary['affiliate']> {
  return {
    id: 1,
    user_id: 7,
    rate: 10,
    channel: false,
    tier: '',
    granted_by: 0,
    balance: 0,
    earned: 0,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function renderCard(
  summary: Partial<AffiliateSummary>,
  user: Partial<UserWalletData> = { aff_quota: 0 }
) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { ...baseSummary, ...summary } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AffiliateRewardsCard user={user as UserWalletData} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('hides the card when the program is off and there are no legacy rewards', async () => {
  const { container } = renderCard({ enabled: false })
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  await waitFor(() => expect(container).toBeEmptyDOMElement())
})

it('keeps the legacy transfer when the program is off but legacy rewards remain', async () => {
  renderCard({ enabled: false }, { aff_quota: 500_000 })
  expect(
    await screen.findByRole('button', { name: 'Transfer to Balance' })
  ).toBeEnabled()
})

it('offers no apply step and explains when the user has no rate', async () => {
  renderCard({ affiliate: null })
  expect(
    await screen.findByText('Invitations are not available for your account.')
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: /apply/i })).toBeNull()
  expect(screen.queryByLabelText('Referral link')).toBeNull()
})

it('shows the sign-in invite link, rate and stats for an affiliate', async () => {
  renderCard({
    affiliate: account({ rate: 12 }),
    aff_code: 'AB12',
    invitee_count: 3,
  })
  const link = (await screen.findByLabelText(
    'Referral link'
  )) as HTMLInputElement
  expect(link.value).toMatch(/\/sign-in\?ref=AB12$/)
  expect(screen.getByText('Rate 12%')).toBeVisible()
  expect(screen.queryByText('Promotion channel')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
})

it('offers withdrawal and the channel badge to promotion channels only', async () => {
  renderCard({
    affiliate: account({ channel: true, balance: 1_000_000 }),
    aff_code: 'CH01',
  })
  expect(await screen.findByText('Promotion channel')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled()
})

it('removes the invite link when the rate is 0', async () => {
  renderCard({ affiliate: account({ rate: 0 }), aff_code: '' })
  expect(
    await screen.findByText('Invitations are not available for your account.')
  ).toBeVisible()
  expect(screen.queryByLabelText('Referral link')).toBeNull()
})
