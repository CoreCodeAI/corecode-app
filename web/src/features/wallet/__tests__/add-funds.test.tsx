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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { RecentCreditsCard } from '../components/recent-credits-card'
import { RechargeFormCard } from '../components/recharge-form-card'
import type { TopupInfo } from '../types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderCard(topupInfo: Partial<TopupInfo>, topupLink?: string) {
  return render(
    <RechargeFormCard
      topupInfo={topupInfo as TopupInfo}
      presetAmounts={[]}
      topupAmount={1}
      paymentAmount={1}
      calculating={false}
      paymentLoading={null}
      redemptionCode=''
      redeeming={false}
      topupLink={topupLink}
      onSelectPreset={vi.fn()}
      onTopupAmountChange={vi.fn()}
      onPaymentMethodSelect={vi.fn()}
      onRedemptionCodeChange={vi.fn()}
      onRedeem={vi.fn()}
    />
  )
}

describe('add funds without online payment', () => {
  it('puts the redemption code first when codes are open', () => {
    renderCard({ enable_online_topup: false, enable_redemption: true })

    expect(
      screen.getByText(
        'Online payment is not open yet. Redeem a code to add credits.'
      )
    ).toBeVisible()
    expect(screen.getByLabelText('Have a Code?')).toBeVisible()
    expect(
      screen.queryByText(/Online topup is not enabled/)
    ).not.toBeInTheDocument()
  })

  it('explains how to get credits when neither payment nor codes are open', () => {
    renderCard(
      { enable_online_topup: false, enable_redemption: false },
      'https://example.com/contact'
    )

    expect(
      screen.getByText('Credits are added by the operator for now')
    ).toBeVisible()
    expect(screen.getByText('Contact us').closest('a')).toHaveAttribute(
      'href',
      'https://example.com/contact'
    )
    expect(screen.queryByLabelText('Have a Code?')).not.toBeInTheDocument()
  })

  it('leaves out the contact button when the operator set no link', () => {
    renderCard({ enable_online_topup: false, enable_redemption: false })

    expect(screen.queryByText('Contact us')).not.toBeInTheDocument()
  })

  it('keeps the payment description when online payment is open', () => {
    renderCard({
      enable_online_topup: true,
      enable_redemption: true,
      pay_methods: [],
      amount_options: [],
      discount: {},
    })

    expect(
      screen.getByText('Choose an amount and payment method')
    ).toBeVisible()
  })
})

async function withProviders(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('credit history', () => {
  it('lists top-up logs with their localized description', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            {
              id: 9,
              type: 1,
              created_at: Math.floor(Date.now() / 1000) - 60,
              content: 'raw',
              other: JSON.stringify({
                content_parts: [
                  {
                    key: 'Topped up {{quota}} with a redemption code, code ID {{id}}',
                    params: { quota: '$20', id: 3 },
                  },
                ],
              }),
            },
          ],
          total: 1,
        },
      },
    })
    await withProviders(<RecentCreditsCard />)

    expect(
      await screen.findByText('Topped up $20 with a redemption code, code ID 3')
    ).toBeVisible()
    expect(String(get.mock.calls[0][0])).toContain('type=1')
  })

  it('says where credits will appear before there are any', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { items: [], total: 0 } },
    })
    await withProviders(<RecentCreditsCard />)

    expect(
      await screen.findByText('Credits you add show up here.')
    ).toBeVisible()
  })
})
