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
import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import {
  calculateAmount,
  calculateNowPaymentsAmount,
  calculateStripeAmount,
  calculateWaffoAmount,
  calculateWaffoPancakeAmount,
  requestPayment,
  requestStripePayment,
  requestNowPaymentsPayment,
  isApiSuccess,
} from '../api'
import {
  isNowPaymentsPayment,
  isStripePayment,
  isWaffoPayment,
  isWaffoPancakePayment,
  openPaymentPage,
  submitPaymentForm,
} from '../lib'
import type { AmountRequest, AmountResponse } from '../types'

// ============================================================================
// Payment Hook
// ============================================================================

type AmountCalculator = (request: AmountRequest) => Promise<AmountResponse>

export interface PaymentAmountCalculators {
  regular: AmountCalculator
  stripe: AmountCalculator
  waffo: AmountCalculator
  waffoPancake: AmountCalculator
  nowPayments: AmountCalculator
}

const defaultPaymentAmountCalculators: PaymentAmountCalculators = {
  regular: calculateAmount,
  stripe: calculateStripeAmount,
  waffo: calculateWaffoAmount,
  waffoPancake: calculateWaffoPancakeAmount,
  nowPayments: calculateNowPaymentsAmount,
}

export async function requestPaymentAmount(
  topupAmount: number,
  paymentType: string,
  calculators: PaymentAmountCalculators = defaultPaymentAmountCalculators
): Promise<number> {
  let calculator = calculators.regular
  if (isStripePayment(paymentType)) {
    calculator = calculators.stripe
  } else if (isWaffoPayment(paymentType)) {
    calculator = calculators.waffo
  } else if (isWaffoPancakePayment(paymentType)) {
    calculator = calculators.waffoPancake
  } else if (isNowPaymentsPayment(paymentType)) {
    calculator = calculators.nowPayments
  }

  const response = await calculator({ amount: topupAmount })
  if (!isApiSuccess(response) || !response.data) {
    throw new Error(response.message || 'Failed to calculate payment amount')
  }

  const amount = Number.parseFloat(response.data)
  if (!Number.isFinite(amount)) {
    throw new Error('Failed to calculate payment amount')
  }
  return amount
}

export function usePayment() {
  const [amount, setAmount] = useState<number>(0)
  const [calculating, setCalculating] = useState(false)
  const [calculationFailed, setCalculationFailed] = useState(false)
  const [processing, setProcessing] = useState(false)

  // A slower earlier answer must not overwrite the latest one.
  const latestRequestRef = useRef(0)

  // Calculate payment amount. Resolves to null when it could not be priced;
  // calculationFailed then says so, so the amount never reads as a free 0.
  const calculatePaymentAmount = useCallback(
    async (topupAmount: number, paymentType: string) => {
      const requestId = ++latestRequestRef.current
      try {
        setCalculating(true)
        const calculatedAmount = await requestPaymentAmount(
          topupAmount,
          paymentType
        )
        if (requestId !== latestRequestRef.current) return null
        setAmount(calculatedAmount)
        setCalculationFailed(false)
        return calculatedAmount
      } catch {
        if (requestId !== latestRequestRef.current) return null
        setAmount(0)
        setCalculationFailed(true)
        return null
      } finally {
        if (requestId === latestRequestRef.current) setCalculating(false)
      }
    },
    []
  )

  // Drop the shown price, for an amount that is not worth pricing.
  const resetCalculation = useCallback(() => {
    latestRequestRef.current += 1
    setAmount(0)
    setCalculating(false)
    setCalculationFailed(false)
  }, [])

  // Process payment. throughEpay sends a Stripe method's small order to
  // epay under the same method name (paysThroughEpay).
  const processPayment = useCallback(
    async (topupAmount: number, paymentType: string, throughEpay = false) => {
      try {
        setProcessing(true)

        const isStripe = isStripePayment(paymentType) && !throughEpay
        const amount = Math.floor(topupAmount)

        const response = isStripe
          ? await requestStripePayment({
              amount,
              payment_method: paymentType,
            })
          : await requestPayment({
              amount,
              payment_method: paymentType,
            })

        if (!isApiSuccess(response)) {
          handleServerError(response, i18next.t('Payment request failed'))
          return false
        }

        // Handle Stripe payment
        if (isStripe && response.data?.pay_link) {
          openPaymentPage(response.data.pay_link as string)
          toast.success(i18next.t('Redirecting to payment page...'))
          return true
        }

        // Handle non-Stripe payment
        if (!isStripe && response.data) {
          const url = (response as unknown as { url?: string }).url
          if (url) {
            submitPaymentForm(url, response.data)
            toast.success(i18next.t('Redirecting to payment page...'))
            return true
          }
        }

        return false
      } catch (error) {
        handleServerError(error, i18next.t('Payment request failed'))
        return false
      } finally {
        setProcessing(false)
      }
    },
    []
  )

  // Open a NOWPayments invoice in this tab; the invoice returns the customer
  // to the console once paid or cancelled.
  const processNowPaymentsPayment = useCallback(
    async (topupAmount: number, payCurrency: string) => {
      try {
        setProcessing(true)
        const response = await requestNowPaymentsPayment({
          amount: Math.floor(topupAmount),
          pay_currency: payCurrency,
        })
        if (!isApiSuccess(response) || !response.data?.pay_link) {
          handleServerError(response, i18next.t('Payment request failed'))
          return false
        }
        toast.success(i18next.t('Redirecting to payment page...'))
        window.location.assign(response.data.pay_link)
        return true
      } catch (error) {
        handleServerError(error, i18next.t('Payment request failed'))
        return false
      } finally {
        setProcessing(false)
      }
    },
    []
  )

  return {
    amount,
    calculating,
    processing,
    calculationFailed,
    calculatePaymentAmount,
    resetCalculation,
    processPayment,
    processNowPaymentsPayment,
    setAmount,
  }
}
