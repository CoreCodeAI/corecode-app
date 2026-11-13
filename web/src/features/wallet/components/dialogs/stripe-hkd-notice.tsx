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
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PAYMENT_TYPES } from '../../constants'

interface StripeHkdNoticeProps {
  paymentType: string | undefined
  locale?: string
  /** The CNY price, already formatted as the "You Pay" row shows it */
  cnyText: string
  /** What Stripe charges in HKD; undefined when no rate was available */
  hkdAmount?: number
}

const WALLET_TYPES = new Set<string>([
  PAYMENT_TYPES.STRIPE_WECHAT_PAY,
  PAYMENT_TYPES.STRIPE_ALIPAY,
])

/**
 * CoreCode: shown in the confirm dialog for an order that Stripe Checkout
 * charges, which is always in Hong Kong dollars. The page there leads with an
 * HKD figure the customer never saw in the wallet, so the dialog says so
 * first: the currency, both amounts when the server quoted the HKD one, and
 * otherwise why the HKD number will look larger than the CNY price.
 */
export function StripeHkdNotice({
  paymentType,
  locale,
  cnyText,
  hkdAmount,
}: StripeHkdNoticeProps) {
  const { t } = useTranslation()
  const isWallet = !!paymentType && WALLET_TYPES.has(paymentType)
  const hkdText =
    hkdAmount === undefined
      ? ''
      : new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'HKD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(hkdAmount)

  return (
    <div
      role='note'
      className='bg-muted/50 flex items-start gap-2.5 rounded-lg p-3'
    >
      <Info
        aria-hidden='true'
        className='text-muted-foreground mt-0.5 h-4 w-4 shrink-0'
      />
      <div className='min-w-0 space-y-1.5'>
        <p className='text-sm font-medium'>
          {t('Charged in Hong Kong dollars (HKD)')}
        </p>
        {hkdText && (
          <p className='text-sm font-semibold tabular-nums'>
            {cnyText} ≈ {hkdText}
          </p>
        )}
        <p className='text-muted-foreground text-xs text-pretty'>
          {hkdText
            ? t(
                "The payment page shows the HKD amount, converted at today's exchange rate."
              )
            : t(
                'The payment page shows an HKD amount that looks larger than {{cny}} because of the exchange rate. It is not an extra charge.',
                { cny: cnyText }
              )}{' '}
          {isWallet
            ? t(
                'WeChat Pay and Alipay convert it back to RMB, so what you pay in RMB matches the purchase amount.'
              )
            : t(
                'If you pay by card, your bank may convert it at its own rate.'
              )}
        </p>
      </div>
    </div>
  )
}
