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
import { useState, useCallback } from 'react'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import { requestWaffoPayment, isApiSuccess } from '../api'
import { getPaymentErrorTranslation, openPendingPage } from '../lib'

function getPaymentUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  if ('payment_url' in data && typeof data.payment_url === 'string') {
    return data.payment_url
  }

  return null
}

function getErrorMessage(message: string | undefined, data: unknown): string {
  if (typeof data === 'string' && data.trim()) {
    return data
  }

  return (
    (message && message !== 'success' ? message : undefined) ||
    i18next.t('Payment request failed')
  )
}

export interface WaffoPaymentHookOptions {
  /** Called with the trade number of each order the wallet opens */
  onOrderCreated?: (tradeNo: string) => void
}

/**
 * Hook for handling Waffo payment processing
 */
export function useWaffoPayment({
  onOrderCreated,
}: WaffoPaymentHookOptions = {}) {
  const [processing, setProcessing] = useState(false)

  const processWaffoPayment = useCallback(
    async (topupAmount: number, payMethodIndex?: number) => {
      // The checkout tab opens during the click, before the order request.
      const checkout = openPendingPage(
        i18next.t('Redirecting to payment page...')
      )
      let handedOff = false
      setProcessing(true)

      try {
        const response = await requestWaffoPayment({
          amount: Math.floor(topupAmount),
          pay_method_index: payMethodIndex,
        })

        if (isApiSuccess(response)) {
          const paymentUrl = getPaymentUrl(response.data)

          if (paymentUrl) {
            const orderId =
              response.data && typeof response.data === 'object'
                ? response.data.order_id
                : undefined
            if (orderId) onOrderCreated?.(orderId)
            handedOff = true
            checkout.go(paymentUrl)
            toast.success(i18next.t('Redirecting to payment page...'))
            return true
          }
        }

        handleServerError(response, undefined, {
          title:
            getPaymentErrorTranslation(response) ??
            getErrorMessage(response.message, response.data),
        })
        return false
      } catch (error) {
        handleServerError(error, i18next.t('Payment request failed'))
        return false
      } finally {
        if (!handedOff) checkout.close()
        setProcessing(false)
      }
    },
    [onOrderCreated]
  )

  return { processing, processWaffoPayment }
}
