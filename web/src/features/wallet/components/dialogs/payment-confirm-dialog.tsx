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
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatLocalCurrencyAmount } from '@/lib/currency'

import { DEFAULT_DISCOUNT_RATE } from '../../constants'
import {
  formatMethodPaymentMoney,
  getPaymentIcon,
  isBonusEligiblePayment,
  isNowPaymentsPayment,
} from '../../lib'
import type { NowPaymentsCurrency, PaymentMethod } from '../../types'

interface PaymentConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  topupAmount: number
  paymentAmount: number
  paymentMethod: PaymentMethod | undefined
  calculating: boolean
  processing: boolean
  discountRate?: number
  /** Bonus fraction for this amount; shown only for epay payment methods */
  bonusRate?: number
  usdExchangeRate?: number
  /** Networks a NOWPayments (USDT / USDC) payment can be made on */
  nowPaymentsCurrencies?: NowPaymentsCurrency[]
  /** The chosen NOWPayments ticker */
  nowPaymentsCurrency?: string | null
  onNowPaymentsCurrencyChange?: (code: string) => void
  /** CNY per US dollar, the rate a NOWPayments price is converted at */
  paymentUsdRate?: number
}

export function PaymentConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  topupAmount,
  paymentAmount,
  paymentMethod,
  calculating,
  processing,
  discountRate = DEFAULT_DISCOUNT_RATE,
  bonusRate = 0,
  usdExchangeRate = 1,
  nowPaymentsCurrencies = [],
  nowPaymentsCurrency = null,
  onNowPaymentsCurrencyChange,
  paymentUsdRate,
}: PaymentConfirmDialogProps) {
  const { t } = useTranslation()
  const isCrypto = isNowPaymentsPayment(paymentMethod?.type)
  const selectedCurrency = nowPaymentsCurrencies.find(
    (currency) => currency.code === nowPaymentsCurrency
  )
  const currencyLabel = (currency: NowPaymentsCurrency) =>
    `${currency.coin} · ${currency.network}`
  const formatMoney = (amount: number) =>
    formatMethodPaymentMoney(amount, paymentMethod?.type)
  const hasDiscount = discountRate > 0 && discountRate < 1 && paymentAmount > 0
  const originalAmount = hasDiscount ? paymentAmount / discountRate : 0
  const discountAmount = hasDiscount ? originalAmount - paymentAmount : 0
  const hasBonus = bonusRate > 0 && isBonusEligiblePayment(paymentMethod?.type)
  const displayTopup = topupAmount * usdExchangeRate
  const displayBonus = hasBonus ? displayTopup * bonusRate : 0
  const currencyOptions = {
    digitsLarge: 2,
    digitsSmall: 2,
    abbreviate: false,
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'>
        <AlertDialogHeader>
          <AlertDialogTitle className='text-xl font-semibold'>
            {t('Confirm Payment')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('Review your payment details')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className='space-y-3 py-3 sm:space-y-4 sm:py-4'>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-sm'>
              {t('Topup Amount')}
            </span>
            <span className='text-lg font-semibold'>
              {formatLocalCurrencyAmount(displayTopup, currencyOptions)}
            </span>
          </div>

          {hasBonus && (
            <>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {t('Bonus')}
                </span>
                <span className='text-sm font-semibold text-green-600'>
                  +{formatLocalCurrencyAmount(displayBonus, currencyOptions)}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {t('Total credited')}
                </span>
                <span className='text-lg font-semibold'>
                  {formatLocalCurrencyAmount(
                    displayTopup + displayBonus,
                    currencyOptions
                  )}
                </span>
              </div>
            </>
          )}

          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-sm'>
              {t('You Pay')}
            </span>
            {calculating ? (
              <Skeleton className='h-6 w-24' />
            ) : (
              <div className='flex items-baseline gap-2'>
                <span className='text-2xl font-semibold'>
                  {formatMoney(paymentAmount)}
                </span>
                {hasDiscount && (
                  <span className='text-muted-foreground text-sm line-through'>
                    {formatMoney(originalAmount)}
                  </span>
                )}
              </div>
            )}
          </div>

          {hasDiscount && !calculating && (
            <div className='bg-muted/50 rounded-lg p-3'>
              <div className='flex items-center justify-between text-sm'>
                <span className='text-muted-foreground'>{t('You save')}</span>
                <span className='font-semibold text-green-600'>
                  {formatMoney(discountAmount)}
                </span>
              </div>
            </div>
          )}

          {isCrypto && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-muted-foreground text-sm'>
                  {t('Network')}
                </span>
                <Select
                  items={nowPaymentsCurrencies.map((currency) => ({
                    value: currency.code,
                    label: currencyLabel(currency),
                  }))}
                  value={nowPaymentsCurrency}
                  onValueChange={(value) => {
                    if (typeof value === 'string') {
                      onNowPaymentsCurrencyChange?.(value)
                    }
                  }}
                  disabled={processing}
                >
                  <SelectTrigger aria-label={t('Network')} className='w-44'>
                    <SelectValue>
                      {selectedCurrency
                        ? currencyLabel(selectedCurrency)
                        : t('Choose a network')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {nowPaymentsCurrencies.map((currency) => (
                        <SelectItem key={currency.code} value={currency.code}>
                          {currencyLabel(currency)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <p className='text-muted-foreground text-xs text-pretty'>
                {paymentUsdRate
                  ? t(
                      'Priced at 1 USD = ¥{{rate}}; USDT and USDC each count as 1 USD. Send it on the network you choose here.',
                      { rate: paymentUsdRate }
                    )
                  : t(
                      'USDT and USDC each count as 1 USD. Send it on the network you choose here.'
                    )}
              </p>
            </div>
          )}

          <div className='border-t pt-4'>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Payment Method')}
              </span>
              <div className='flex items-center gap-2'>
                {getPaymentIcon(
                  paymentMethod?.type,
                  'h-4 w-4',
                  paymentMethod?.icon,
                  paymentMethod?.name
                )}
                <span className='font-medium'>{paymentMethod?.name}</span>
              </div>
            </div>
          </div>
        </div>

        <AlertDialogFooter className='grid grid-cols-2 gap-2 sm:flex'>
          <AlertDialogCancel disabled={processing}>
            {t('Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={processing || (isCrypto && !selectedCurrency)}
          >
            {processing && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('Confirm Payment')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
