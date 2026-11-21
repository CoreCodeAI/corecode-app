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
import i18next from 'i18next'
import { beforeAll, describe, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { PAYMENT_TYPES } from '../constants'
import { paymentMethodHint } from './payment-names'

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({ lng: 'zh', fallbackLng: 'en', resources: { en, zh } })
})

describe('the line under a payment method', () => {
  test('Alipay and WeChat Pay are called instant and recommended', () => {
    for (const type of [
      PAYMENT_TYPES.ALIPAY,
      PAYMENT_TYPES.WECHAT,
      PAYMENT_TYPES.STRIPE_ALIPAY,
      PAYMENT_TYPES.STRIPE_WECHAT_PAY,
    ]) {
      expect(paymentMethodHint({ type }, i18n.t, true)).toBe('即时到账，推荐')
    }
  })

  test('a card warns that some banks decline and points to Alipay', () => {
    expect(
      paymentMethodHint({ type: PAYMENT_TYPES.STRIPE_CARD }, i18n.t, true)
    ).toBe('国际卡，部分发卡行会拒；失败请改用支付宝或微信')
  })

  test('USDT and USDC say how long a transfer takes', () => {
    expect(
      paymentMethodHint({ type: PAYMENT_TYPES.NOWPAYMENTS }, i18n.t, true)
    ).toBe('链上 USDT/USDC，通常约 5 分钟到账')
  })

  test('the on-chain deposit names its extra bonus', () => {
    expect(
      paymentMethodHint(
        { type: PAYMENT_TYPES.CHAIN_DEPOSIT, bonus_rate: '0.01' },
        i18n.t,
        true
      )
    ).toBe('额外赠送 1%，约 1 分钟到账')
    expect(
      paymentMethodHint(
        { type: PAYMENT_TYPES.CHAIN_DEPOSIT, bonus_rate: '0' },
        i18n.t,
        true
      )
    ).toBeNull()
  })

  test('a method that earns no bonus says so, one that does stays quiet', () => {
    expect(
      paymentMethodHint({ type: PAYMENT_TYPES.CREEM }, i18n.t, false)
    ).toBe('此方式不送赠金')
    expect(paymentMethodHint({ type: 'custom' }, i18n.t, true)).toBeNull()
  })
})
