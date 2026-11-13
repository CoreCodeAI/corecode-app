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
import type { TFunction } from 'i18next'

import { PAYMENT_TYPES } from '../constants'

// Kept out of ./index: the overview imports that barrel, and the locale split
// would then ship these keys in the overview's first load.
// The PayMethods option names each button in the operator's language (支付宝,
// 微信, 银行卡). Methods the console knows by type read in the reader's
// language; any other method keeps the name the operator gave it.
const PAYMENT_METHOD_NAME_KEYS: Readonly<Record<string, string>> = {
  [PAYMENT_TYPES.ALIPAY]: 'Alipay',
  [PAYMENT_TYPES.STRIPE_ALIPAY]: 'Alipay',
  [PAYMENT_TYPES.WECHAT]: 'WeChat Pay',
  [PAYMENT_TYPES.STRIPE_WECHAT_PAY]: 'WeChat Pay',
  [PAYMENT_TYPES.STRIPE_CARD]: 'Card',
}

/** A payment method's button name in the reader's language. */
export function paymentMethodName(
  method: { type: string; name?: string } | null | undefined,
  t: TFunction
): string {
  if (!method) return ''
  const key = PAYMENT_METHOD_NAME_KEYS[method.type]
  return key ? t(key) : method.name || method.type
}
