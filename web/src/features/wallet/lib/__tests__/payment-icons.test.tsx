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
import { render, screen } from '@testing-library/react'
import { LuCreditCard } from 'react-icons/lu'
import { SiAlipay, SiWechat } from 'react-icons/si'
import { expect, test } from 'vitest'

import { PAYMENT_ICON_COLORS, PAYMENT_TYPES } from '../../constants'
import { getPaymentIcon } from '../ui'

test.each([
  [PAYMENT_TYPES.ALIPAY, 'Alipay'],
  [PAYMENT_TYPES.WECHAT, 'WeChat'],
  [PAYMENT_TYPES.STRIPE, 'Stripe'],
])(
  'the built-in %s icon preserves the requested size and payment color',
  (type, label) => {
    render(getPaymentIcon(type, 'h-6 w-6'))
    const icon = screen.getByRole('img', { name: label })
    expect(icon).toHaveClass('h-6', 'w-6')
    expect(icon).toHaveStyle({ color: PAYMENT_ICON_COLORS[type] })
  }
)

test.each([
  [PAYMENT_TYPES.ALIPAY, 'SiAlipay', SiAlipay],
  [PAYMENT_TYPES.WECHAT, 'SiWechat', SiWechat],
  ['custom1', 'LuCreditCard', LuCreditCard],
])(
  'the default PayMethods icon %s/%s renders on first paint, identical to the react-icons glyph',
  (type, name, PackIcon) => {
    const brandColor =
      PAYMENT_ICON_COLORS[type as keyof typeof PAYMENT_ICON_COLORS]
    const { container } = render(
      getPaymentIcon(type, 'h-4 w-4', name, 'Configured')
    )
    // Synchronous: no icon pack is loaded before the glyph appears.
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveClass('h-4', 'w-4')

    const { container: expected } = render(
      <PackIcon
        className='h-4 w-4'
        title='Configured'
        style={brandColor ? { color: brandColor } : undefined}
      />
    )
    expect(svg?.outerHTML).toBe(expected.querySelector('svg')?.outerHTML)
  }
)

test('the bundled Alipay glyph keeps the brand color', () => {
  render(
    getPaymentIcon(
      PAYMENT_TYPES.ALIPAY,
      'h-4 w-4',
      'SiAlipay',
      'Configured Alipay'
    )
  )
  expect(screen.getByTitle('Configured Alipay').closest('svg')).toHaveStyle({
    color: PAYMENT_ICON_COLORS[PAYMENT_TYPES.ALIPAY],
  })
})

test('an icon name outside the bundled set still resolves through the lazy icon loader', async () => {
  const { container } = render(
    getPaymentIcon(
      PAYMENT_TYPES.STRIPE,
      'h-4 w-4',
      'SiStripe',
      'Configured Stripe'
    )
  )
  expect(container.querySelector('svg')).toBeNull()
  const title = await screen.findByTitle('Configured Stripe')
  expect(title.closest('svg')).toHaveClass('h-4', 'w-4')
  expect(title.closest('svg')).toHaveStyle({
    color: PAYMENT_ICON_COLORS[PAYMENT_TYPES.STRIPE],
  })
})

test('a configured icon for a method without a brand color keeps the text color', async () => {
  render(getPaymentIcon('custom_pay', 'h-4 w-4', 'SiStripe', 'Custom'))
  const title = await screen.findByTitle('Custom')
  expect(title.closest('svg')?.getAttribute('style') ?? '').not.toContain(
    'color'
  )
})

test('a bundled icon for a method without a brand color keeps the text color', () => {
  render(getPaymentIcon('custom_pay', 'h-4 w-4', 'SiAlipay', 'Custom'))
  expect(
    screen.getByTitle('Custom').closest('svg')?.getAttribute('style') ?? ''
  ).not.toContain('color')
})
