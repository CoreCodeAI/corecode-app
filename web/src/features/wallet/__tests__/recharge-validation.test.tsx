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
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RechargeFormCard } from '../components/recharge-form-card'
import type { TopupInfo } from '../types'

afterEach(() => {
  cleanup()
})

const topupInfo = {
  enable_online_topup: true,
  enable_redemption: true,
  min_topup: 10,
  pay_methods: [{ name: 'Alipay', type: 'alipay', min_topup: 0 }],
  amount_options: [10, 50],
  discount: {},
} as unknown as TopupInfo

interface HarnessProps {
  initialAmount: number
  calculationFailed?: boolean
  onRedeem?: () => void
  onPaymentMethodSelect?: () => void
}

function Harness(props: HarnessProps) {
  const [amount, setAmount] = useState(props.initialAmount)
  const [code, setCode] = useState('')
  return (
    <RechargeFormCard
      topupInfo={topupInfo}
      presetAmounts={[{ value: 10 }, { value: 50 }]}
      onSelectPreset={(preset) => setAmount(preset.value)}
      topupAmount={amount}
      onTopupAmountChange={setAmount}
      paymentAmount={0}
      calculating={false}
      calculationFailed={props.calculationFailed}
      onPaymentMethodSelect={props.onPaymentMethodSelect ?? vi.fn()}
      paymentLoading={null}
      redemptionCode={code}
      onRedemptionCodeChange={setCode}
      onRedeem={props.onRedeem ?? vi.fn()}
      redeeming={false}
    />
  )
}

describe('top-up amount validation', () => {
  it('disables the payment methods and says why when the amount is below the minimum', async () => {
    render(<Harness initialAmount={10} />)
    const input = screen.getByLabelText('Custom Amount')

    await userEvent.clear(input)
    await userEvent.type(input, '3')

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Minimum topup amount: 10'
    )
    expect(screen.getByRole('button', { name: /Alipay/ })).toBeDisabled()
  })

  it('keeps the payment methods enabled at the minimum', () => {
    render(<Harness initialAmount={10} />)

    expect(screen.getByRole('button', { name: 'Alipay' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('drops a decimal fraction as it is typed instead of rounding it later', async () => {
    render(<Harness initialAmount={10} />)
    const input = screen.getByLabelText('Custom Amount')

    await userEvent.clear(input)
    await userEvent.type(input, '10.5')

    expect(input).toHaveValue('105')
  })

  it('says the amount could not be calculated when pricing failed', () => {
    render(<Harness initialAmount={10} calculationFailed />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not calculate the amount to pay'
    )
  })
})

describe('preset amounts', () => {
  it('marks the preset matching the default amount as pressed', () => {
    render(<Harness initialAmount={10} />)

    const buttons = screen.getAllByRole('button', { pressed: true })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('$10')
  })

  it('moves the pressed state when another preset is chosen', async () => {
    render(<Harness initialAmount={10} />)

    await userEvent.click(screen.getByRole('button', { name: /\$50/ }))

    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent(
      '$50'
    )
  })

  it('clears the pressed state for a custom amount', async () => {
    render(<Harness initialAmount={10} />)
    const input = screen.getByLabelText('Custom Amount')

    await userEvent.clear(input)
    await userEvent.type(input, '25')

    expect(
      screen.queryByRole('button', { pressed: true })
    ).not.toBeInTheDocument()
  })
})

describe('redeeming a code', () => {
  it('submits when Enter is pressed in the code field', async () => {
    const onRedeem = vi.fn()
    render(<Harness initialAmount={10} onRedeem={onRedeem} />)

    await userEvent.type(screen.getByLabelText('Have a Code?'), 'ABC{Enter}')

    expect(onRedeem).toHaveBeenCalledTimes(1)
  })
})
