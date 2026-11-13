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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaymentConfirmDialog } from '../components/dialogs/payment-confirm-dialog'
import type { PaymentMethod } from '../types'

afterEach(() => {
  cleanup()
})

function renderDialog(
  method: PaymentMethod,
  paymentAmount: number,
  hkdAmount?: number
) {
  return render(
    <PaymentConfirmDialog
      open
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
      topupAmount={paymentAmount}
      paymentAmount={paymentAmount}
      hkdAmount={hkdAmount}
      paymentMethod={method}
      calculating={false}
      processing={false}
    />
  )
}

const wechat: PaymentMethod = {
  name: 'WeChat',
  type: 'stripe_wechat_pay',
  epay_max_money: 50,
}
const card: PaymentMethod = { name: 'Card', type: 'stripe_card' }

describe('the HKD notice in the payment confirm dialog', () => {
  it('shows both amounts and the RMB guarantee for WeChat Pay', () => {
    renderDialog(wechat, 300, 351.15)

    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Charged in Hong Kong dollars (HKD)')
    expect(note).toHaveTextContent(/(CN)?¥300 ≈ HK\$351\.15/)
    expect(note).toHaveTextContent(
      'what you pay in RMB matches the purchase amount'
    )
  })

  it('treats a bank card the same way, without promising an RMB amount', () => {
    renderDialog(card, 300, 351.15)

    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Charged in Hong Kong dollars (HKD)')
    expect(note).toHaveTextContent(/(CN)?¥300 ≈ HK\$351\.15/)
    expect(note).toHaveTextContent('your bank may convert it at its own rate')
    expect(note).not.toHaveTextContent('matches the purchase amount')
  })

  it('explains the larger HKD figure when no rate was quoted', () => {
    renderDialog(wechat, 300)

    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/looks larger than (CN)?¥300/)
    expect(note).toHaveTextContent('not an extra charge')
    expect(note).not.toHaveTextContent('≈')
  })

  it('stays out of an order that epay charges in RMB', () => {
    renderDialog(wechat, 50, 58.74)

    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('covers a card at every amount, since epay has no card method', () => {
    renderDialog(card, 20, 23.5)

    expect(screen.getByRole('note')).toHaveTextContent('HK$23.50')
  })

  it('stays out of methods that do not charge through Stripe', () => {
    renderDialog({ name: 'Alipay', type: 'alipay' }, 300, 351.15)

    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})
