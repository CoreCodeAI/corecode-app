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
import { beforeAll, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { paymentMethodHint } from '../../lib/payment-names'
import { parsePaymentMethods } from '../use-topup-info'

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({ lng: 'zh', fallbackLng: 'en', resources: { en, zh } })
})

test('the on-chain bonus the server sends reaches the button hint', () => {
  // As GET /api/user/topup/info sends it: every value a string.
  const [method] = parsePaymentMethods(
    [
      {
        name: 'On-chain deposit (USDT/USDC)',
        type: 'chain_deposit',
        color: '#26A17B',
        min_topup: '0',
        bonus_rate: '0.01',
      },
    ],
    0
  )
  expect(method.bonus_rate).toBe('0.01')
  expect(paymentMethodHint(method, i18n.t, true)).toBe(
    '额外赠送 1%，约 1 分钟到账'
  )
})
