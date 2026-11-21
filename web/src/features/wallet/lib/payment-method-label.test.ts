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
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import zh from '@/i18n/locales/zh.json'

import { PAYMENT_TYPES } from '../constants'
import { paymentMethodLabel } from './billing'

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({
    lng: 'zh',
    fallbackLng: 'en',
    resources: { en, zh, ru, ja },
    interpolation: { escapeValue: false },
  })
})

// Every payment_method value found in production top-ups on 2026-11-21, plus
// the values the server defines that no order has used yet.
const NAMES: ReadonlyArray<[string, string, string]> = [
  // value, en, zh
  ['alipay', 'Alipay', '支付宝'],
  ['wxpay', 'WeChat Pay', '微信支付'],
  ['stripe_alipay', 'Alipay (Stripe)', '支付宝（Stripe）'],
  ['stripe_wechat_pay', 'WeChat Pay (Stripe)', '微信支付（Stripe）'],
  ['stripe_card', 'Card (Stripe)', '银行卡（Stripe）'],
  ['stripe', 'Stripe', 'Stripe'],
  ['nowpayments', 'USDT/USDC (NOWPayments)', 'USDT/USDC (NOWPayments)'],
  ['chain_deposit', 'On-chain deposit (USDT/USDC)', '链上充值 (USDT/USDC)'],
  ['dodopayments', 'Dodo Payments', 'Dodo Payments'],
  ['offline', 'Offline transfer', '线下转账'],
  ['creem', 'Creem', 'Creem'],
  ['waffo', 'Waffo', 'Waffo'],
  ['waffo_pancake', 'Waffo Pancake', 'Waffo Pancake'],
  ['balance', 'Balance', '余额'],
]

describe('paymentMethodLabel', () => {
  test.each(NAMES)(
    '%s reads %s in English and %s in Chinese',
    (value, english, chinese) => {
      expect(paymentMethodLabel(value, i18n.getFixedT('en'))).toBe(english)
      expect(paymentMethodLabel(value, i18n.getFixedT('zh'))).toBe(chinese)
    }
  )

  test('no two values share a name, so a filter never mixes gateways', () => {
    for (const lng of ['en', 'zh', 'ru', 'ja']) {
      const t = i18n.getFixedT(lng)
      const labels = NAMES.map(([value]) => paymentMethodLabel(value, t))
      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  test('the server and console method types all have a name', () => {
    const t = i18n.getFixedT('en')
    for (const value of Object.values(PAYMENT_TYPES)) {
      expect(paymentMethodLabel(value, t)).not.toMatch(/^Other/)
    }
  })

  test('Stripe methods follow the reader language', () => {
    expect(paymentMethodLabel('stripe_card', i18n.getFixedT('ru'))).toBe(
      'Карта (Stripe)'
    )
    expect(paymentMethodLabel('stripe_alipay', i18n.getFixedT('ja'))).toBe(
      'Alipay（Stripe）'
    )
  })

  test('an unknown value reads as Other with the value kept visible', () => {
    expect(paymentMethodLabel('qqpay_v2', i18n.getFixedT('en'))).toBe(
      'Other (qqpay_v2)'
    )
    expect(paymentMethodLabel('qqpay_v2', i18n.getFixedT('zh'))).toBe(
      '其他（qqpay_v2）'
    )
  })

  test('an empty value stays empty so callers can show a dash', () => {
    const t = i18n.getFixedT('en')
    expect(paymentMethodLabel('', t)).toBe('')
    expect(paymentMethodLabel(undefined, t)).toBe('')
    expect(paymentMethodLabel(null, t)).toBe('')
  })
})
