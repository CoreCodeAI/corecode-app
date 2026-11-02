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
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaymentConfirmDialog } from '../components/dialogs/payment-confirm-dialog'
import { RechargeFormCard } from '../components/recharge-form-card'
import type { TopupInfo } from '../types'

afterEach(() => {
  cleanup()
})

const bonus = { 300: 0.05, 1000: 0.1 }

function topupInfo(methodType: string, overrides: Partial<TopupInfo> = {}) {
  return {
    enable_online_topup: true,
    enable_redemption: false,
    pay_methods: [{ name: 'Pay', type: methodType, min_topup: 0 }],
    min_topup: 1,
    amount_options: [300, 1000],
    discount: {},
    bonus,
    ...overrides,
  } as TopupInfo
}

function renderForm(info: TopupInfo, topupAmount: number) {
  return render(
    <RechargeFormCard
      topupInfo={info}
      presetAmounts={[{ value: 300 }, { value: 1000 }, { value: 100 }]}
      selectedPreset={null}
      topupAmount={topupAmount}
      paymentAmount={topupAmount}
      calculating={false}
      paymentLoading={null}
      redemptionCode=''
      redeeming={false}
      onSelectPreset={vi.fn()}
      onTopupAmountChange={vi.fn()}
      onPaymentMethodSelect={vi.fn()}
      onRedemptionCodeChange={vi.fn()}
      onRedeem={vi.fn()}
    />
  )
}

describe('bonus on the recharge form', () => {
  it('labels qualifying presets when an epay method is available', () => {
    renderForm(topupInfo('alipay'), 1000)

    const preset1000 = screen.getByRole('button', { name: /1,000/ })
    expect(within(preset1000).getByText('+10% bonus')).toBeVisible()
    expect(preset1000).toHaveTextContent('Bonus $100')
    const preset300 = screen.getByRole('button', { name: /^\$300/ })
    expect(within(preset300).getByText('+5% bonus')).toBeVisible()
    expect(preset300).toHaveTextContent('Bonus $15')
    // 100 is below the lowest tier
    const preset100 = screen.getByRole('button', { name: /^\$100/ })
    expect(preset100).not.toHaveTextContent('bonus')
  })

  it('shows the bonus the typed amount earns and the next tier', () => {
    renderForm(topupInfo('alipay'), 1200)

    // 1200 falls in the 1000 tier, so 120 is earned; no tier above it
    expect(screen.getByText('Bonus $120 (+10% bonus)')).toBeVisible()
    expect(screen.queryByText(/more to get/)).not.toBeInTheDocument()
  })

  it('hints at the next tier below the top one', () => {
    renderForm(topupInfo('alipay'), 500)

    expect(screen.getByText('Top up $500 more to get 10% bonus')).toBeVisible()
    expect(screen.getByText('Bonus $25 (+5% bonus)')).toBeVisible()
  })

  it('shows no bonus when only non-epay methods can be used', () => {
    renderForm(topupInfo('stripe', { enable_stripe_topup: true }), 1000)

    expect(screen.queryByText(/bonus/i)).not.toBeInTheDocument()
  })

  it('shows no bonus when no tiers are configured', () => {
    renderForm(topupInfo('alipay', { bonus: {} }), 1000)

    expect(screen.queryByText(/bonus/i)).not.toBeInTheDocument()
  })
})

function renderDialog(methodType: string, bonusRate: number) {
  return render(
    <PaymentConfirmDialog
      open
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
      topupAmount={1000}
      paymentAmount={1000}
      paymentMethod={{ name: 'Pay', type: methodType }}
      calculating={false}
      processing={false}
      bonusRate={bonusRate}
    />
  )
}

describe('bonus in the payment confirmation', () => {
  it('lists the bonus and the total credited for an epay method', () => {
    renderDialog('alipay', 0.1)

    expect(screen.getByText('Bonus')).toBeVisible()
    expect(screen.getByText('Total credited')).toBeVisible()
    expect(screen.getByText(/\+.*100/)).toBeVisible()
    expect(screen.getByText(/1,100/)).toBeVisible()
  })

  it.each(['stripe', 'creem', 'waffo', 'waffo_pancake'])(
    'says nothing about bonus for %s',
    (type) => {
      renderDialog(type, 0.1)

      expect(screen.queryByText('Bonus')).not.toBeInTheDocument()
      expect(screen.queryByText('Total credited')).not.toBeInTheDocument()
    }
  )

  it('omits the rows when no tier applies', () => {
    renderDialog('alipay', 0)

    expect(screen.queryByText('Bonus')).not.toBeInTheDocument()
  })
})
