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

import { planText } from '@/features/subscriptions/lib/plan-text'
import en from '@/i18n/locales/en.json'
import ru from '@/i18n/locales/ru.json'
import zh from '@/i18n/locales/zh.json'

import { PAYMENT_TYPES } from '../constants'
import { paymentMethodName } from './payment-names'

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({
    lng: 'ru',
    fallbackLng: 'en',
    resources: { en, ru, zhCN: zh },
  })
})

describe('operator-written names read in the reader language', () => {
  test('known payment types use the locale, not the PayMethods name', () => {
    const t = i18n.getFixedT('ru')
    expect(
      paymentMethodName({ type: PAYMENT_TYPES.STRIPE_CARD, name: '银行卡' }, t)
    ).toBe('Карта')
    expect(
      paymentMethodName(
        { type: PAYMENT_TYPES.STRIPE_ALIPAY, name: '支付宝' },
        t
      )
    ).toBe('Alipay')
    expect(
      paymentMethodName({ type: PAYMENT_TYPES.WECHAT, name: '微信' }, t)
    ).toBe('WeChat Pay')
    expect(i18n.getFixedT('zhCN')('Card')).toBe('银行卡')
  })

  test('an unknown payment type keeps the operator name', () => {
    const t = i18n.getFixedT('ru')
    expect(
      paymentMethodName(
        { type: PAYMENT_TYPES.NOWPAYMENTS, name: 'USDT / USDC' },
        t
      )
    ).toBe('USDT / USDC')
    expect(paymentMethodName({ type: 'other', name: '' }, t)).toBe('other')
    expect(paymentMethodName(null, t)).toBe('')
  })

  test('the plans on sale translate; any other plan text stays as written', () => {
    const ruT = i18n.getFixedT('ru')
    const zhT = i18n.getFixedT('zhCN')
    expect(planText('新人体验包', ruT)).toBe(
      'Пробный пакет для новых пользователей'
    )
    expect(planText('¥29.9 得 $50 额度，7 天有效，每人限购 1 次', ruT)).toBe(
      '$50 баланса за ¥29.9, действует 7 дней, не больше одного на человека'
    )
    expect(planText('新人福利包', zhT)).toBe('新人福利包')
    expect(planText('运营新建的套餐', ruT)).toBe('运营新建的套餐')
    expect(planText(undefined, ruT)).toBe('')
  })
})
