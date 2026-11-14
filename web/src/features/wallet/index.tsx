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
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { useRefreshSelf, useSelf } from '@/hooks/use-self'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'

import { AffiliateRewardsCard } from './components/affiliate-rewards-card'
import { ConcurrencyTierCard } from './components/concurrency-tier-card'
import { BillingHistoryDialog } from './components/dialogs/billing-history-dialog'
import { CreemConfirmDialog } from './components/dialogs/creem-confirm-dialog'
import { PaymentConfirmDialog } from './components/dialogs/payment-confirm-dialog'
import { PaymentPendingBanner } from './components/payment-pending-banner'
import { RecentCreditsCard } from './components/recent-credits-card'
import { RechargeFormCard } from './components/recharge-form-card'
import { SubscriptionPlansCard } from './components/subscription-plans-card'
import { WalletStatsCard } from './components/wallet-stats-card'
import { DEFAULT_DISCOUNT_RATE, PAYMENT_TYPES } from './constants'
import {
  useTopupInfo,
  usePayment,
  useRedemption,
  useCreemPayment,
  useWaffoPayment,
  useWaffoPancakePayment,
  usePaymentConfirmation,
} from './hooks'
import {
  findBonusTier,
  getDefaultPaymentType,
  getMinTopupAmount,
  dispatchSelectedPayment,
  paysThroughEpay,
} from './lib'
import type {
  UserWalletData,
  PaymentMethod,
  PresetAmount,
  CreemProduct,
  WaffoPayMethod,
} from './types'

interface WalletProps {
  initialShowHistory?: boolean
}

export function Wallet(props: WalletProps) {
  const { t } = useTranslation()
  const [topupAmount, setTopupAmount] = useState(0)
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>()
  const [selectedWaffoMethodIndex, setSelectedWaffoMethodIndex] = useState<
    number | null
  >(null)
  const [nowPaymentsCurrency, setNowPaymentsCurrency] = useState<string | null>(
    null
  )
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [billingDialogOpen, setBillingDialogOpen] = useState(false)
  const [redemptionCode, setRedemptionCode] = useState('')
  const [creemDialogOpen, setCreemDialogOpen] = useState(false)
  const [selectedCreemProduct, setSelectedCreemProduct] =
    useState<CreemProduct | null>(null)
  const [showSubscriptionPanel, setShowSubscriptionPanel] = useState(true)

  const { status } = useStatus()
  const { currency } = useSystemConfig()
  const { topupInfo, presetAmounts, loading: topupLoading } = useTopupInfo()

  // Calculate effective exchange rate - when display type is USD, use rate of 1
  const effectiveUsdExchangeRate = useMemo(() => {
    return currency?.quotaDisplayType === 'USD'
      ? 1
      : currency?.usdExchangeRate || 1
  }, [currency?.quotaDisplayType, currency?.usdExchangeRate])
  const {
    amount: paymentAmount,
    hkdAmount,
    calculating,
    calculationFailed,
    processing,
    calculatePaymentAmount,
    resetCalculation,
    processPayment,
    processNowPaymentsPayment,
  } = usePayment()
  const { redeeming, redeemCode } = useRedemption()
  const { processing: creemProcessing, processCreemPayment } = useCreemPayment()
  const { processing: waffoProcessing, processWaffoPayment } = useWaffoPayment()
  const { processing: pancakeProcessing, processWaffoPancakePayment } =
    useWaffoPancakePayment()

  // The live account; the sidebar and overview read the same data.
  const selfQuery = useSelf()
  const user = (selfQuery.data as UserWalletData | undefined) ?? null
  const userLoading = selfQuery.isPending
  const refreshSelf = useRefreshSelf()
  const paymentWait = usePaymentConfirmation()

  const refreshBalance = useCallback(async () => {
    await refreshSelf()
  }, [refreshSelf])

  // The payment was opened in another tab; watch for it to land. The balance
  // is read fresh first so credit that arrived earlier is not mistaken for it.
  const awaitPayment = useCallback(async () => {
    const fresh = await refreshSelf()
    paymentWait.start(Number(fresh?.quota ?? user?.quota ?? 0))
  }, [refreshSelf, paymentWait, user?.quota])

  useEffect(() => {
    if (props.initialShowHistory) {
      setBillingDialogOpen(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [props.initialShowHistory])

  // Initialize topup amount when topup info is loaded
  const topupAmountInitializedRef = useRef(false)
  useEffect(() => {
    if (topupInfo && !topupAmountInitializedRef.current) {
      topupAmountInitializedRef.current = true
      const minTopup = getMinTopupAmount(topupInfo)
      setTopupAmount(minTopup)

      // Calculate initial payment amount with default payment type
      const defaultPaymentType = getDefaultPaymentType(topupInfo)
      calculatePaymentAmount(minTopup, defaultPaymentType)
    }
  }, [topupInfo, calculatePaymentAmount])

  // Get current payment type (selected or default)
  const getCurrentPaymentType = useCallback(() => {
    return selectedPaymentMethod?.type || getDefaultPaymentType(topupInfo)
  }, [selectedPaymentMethod, topupInfo])

  // An amount under the minimum is not priced: the form says why instead.
  const priceAmount = (amount: number) => {
    if (amount < getMinTopupAmount(topupInfo)) {
      resetCalculation()
      return
    }
    calculatePaymentAmount(amount, getCurrentPaymentType())
  }

  // Handle preset selection
  const handleSelectPreset = (preset: PresetAmount) => {
    setTopupAmount(preset.value)
    priceAmount(preset.value)
  }

  // Handle topup amount change
  const handleTopupAmountChange = (amount: number) => {
    setTopupAmount(amount)
    priceAmount(amount)
  }

  // Handle payment method selection
  const handlePaymentMethodSelect = async (method: PaymentMethod) => {
    setSelectedPaymentMethod(method)
    setSelectedWaffoMethodIndex(null)
    // Keep the network chosen last time while it is still offered.
    const currencies = topupInfo?.nowpayments_currencies ?? []
    setNowPaymentsCurrency((current) =>
      currencies.some((currency) => currency.code === current)
        ? current
        : (currencies[0]?.code ?? null)
    )
    // The buttons are disabled below the minimum; this guards a stale click.
    if (topupAmount < getMinTopupAmount(topupInfo)) return
    setPaymentLoading(method.type)

    try {
      // Price it, and only confirm an amount that could be priced
      const priced = await calculatePaymentAmount(topupAmount, method.type)
      if (priced === null) return
      setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  // Handle payment confirmation
  const handlePaymentConfirm = async () => {
    if (!selectedPaymentMethod) return

    const success = await dispatchSelectedPayment(
      selectedPaymentMethod,
      topupAmount,
      selectedWaffoMethodIndex,
      {
        regular: (amount, type) =>
          processPayment(
            amount,
            type,
            paysThroughEpay(selectedPaymentMethod, paymentAmount)
          ),
        waffo: processWaffoPayment,
        waffoPancake: processWaffoPancakePayment,
        nowPayments: processNowPaymentsPayment,
      },
      nowPaymentsCurrency
    )

    if (success) {
      setConfirmDialogOpen(false)
      await awaitPayment()
    }
  }

  // Handle redemption
  const handleRedeem = async () => {
    const success = await redeemCode(redemptionCode)
    if (success) {
      setRedemptionCode('')
    }
  }

  // Handle Creem product selection
  const handleCreemProductSelect = (product: CreemProduct) => {
    setSelectedCreemProduct(product)
    setCreemDialogOpen(true)
  }

  // Handle Creem payment confirmation
  const handleCreemConfirm = async () => {
    if (!selectedCreemProduct) return

    const success = await processCreemPayment(selectedCreemProduct.productId)
    if (success) {
      setCreemDialogOpen(false)
      setSelectedCreemProduct(null)
      await awaitPayment()
    }
  }

  const handleWaffoMethodSelect = async (
    method: WaffoPayMethod,
    index: number
  ) => {
    const loadingKey = `waffo-${index}`
    setSelectedPaymentMethod({
      name: method.name,
      type: PAYMENT_TYPES.WAFFO,
      icon: method.icon,
    })
    setSelectedWaffoMethodIndex(index)
    setPaymentLoading(loadingKey)

    try {
      const priced = await calculatePaymentAmount(
        topupAmount,
        PAYMENT_TYPES.WAFFO
      )
      if (priced === null) return
      setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  // Get discount rate for current topup amount
  const getDiscountRate = useCallback(() => {
    return topupInfo?.discount?.[topupAmount] || DEFAULT_DISCOUNT_RATE
  }, [topupInfo, topupAmount])

  // Bonus tier rate for the current topup amount; the dialog only applies it
  // to epay payment methods.
  const getBonusRate = useCallback(() => {
    return findBonusTier(topupInfo?.bonus, topupAmount)?.rate ?? 0
  }, [topupInfo, topupAmount])

  const handleSubscriptionAvailabilityChange = useCallback(
    (available: boolean) => {
      setShowSubscriptionPanel(available)
    },
    []
  )

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Wallet')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
            <WalletStatsCard user={user} loading={userLoading} />
            <PaymentPendingBanner
              status={paymentWait.status}
              onOpenBilling={() => setBillingDialogOpen(true)}
              onDismiss={paymentWait.dismiss}
            />
            <ConcurrencyTierCard info={topupInfo?.concurrency} />

            <div
              className={
                showSubscriptionPanel
                  ? 'grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] xl:items-start'
                  : 'grid gap-4'
              }
            >
              <div id='wallet-add-funds' className='scroll-mt-4'>
                <RechargeFormCard
                  topupInfo={topupInfo}
                  presetAmounts={presetAmounts}
                  onSelectPreset={handleSelectPreset}
                  topupAmount={topupAmount}
                  onTopupAmountChange={handleTopupAmountChange}
                  paymentAmount={paymentAmount}
                  paymentAmountType={getCurrentPaymentType()}
                  calculating={calculating}
                  calculationFailed={calculationFailed}
                  onPaymentMethodSelect={handlePaymentMethodSelect}
                  paymentLoading={paymentLoading}
                  redemptionCode={redemptionCode}
                  onRedemptionCodeChange={setRedemptionCode}
                  onRedeem={handleRedeem}
                  redeeming={redeeming}
                  topupLink={topupInfo?.topup_link}
                  loading={topupLoading}
                  priceRatio={(status?.price as number) || 1}
                  usdExchangeRate={effectiveUsdExchangeRate}
                  onOpenBilling={() => setBillingDialogOpen(true)}
                  creemProducts={topupInfo?.creem_products}
                  enableCreemTopup={topupInfo?.enable_creem_topup}
                  onCreemProductSelect={handleCreemProductSelect}
                  enableWaffoTopup={topupInfo?.enable_waffo_topup}
                  waffoPayMethods={topupInfo?.waffo_pay_methods}
                  waffoMinTopup={topupInfo?.waffo_min_topup}
                  onWaffoMethodSelect={handleWaffoMethodSelect}
                  enableWaffoPancakeTopup={
                    topupInfo?.enable_waffo_pancake_topup
                  }
                />
              </div>

              <SubscriptionPlansCard
                topupInfo={topupInfo}
                onAvailabilityChange={handleSubscriptionAvailabilityChange}
                userQuota={user?.quota}
                onPurchaseSuccess={refreshBalance}
              />
            </div>

            <RecentCreditsCard />

            <AffiliateRewardsCard
              user={user}
              complianceConfirmed={
                topupInfo?.payment_compliance_confirmed !== false
              }
              onBalanceChange={refreshBalance}
            />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <PaymentConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        onConfirm={handlePaymentConfirm}
        topupAmount={topupAmount}
        paymentAmount={paymentAmount}
        hkdAmount={hkdAmount}
        paymentMethod={selectedPaymentMethod}
        calculating={calculating}
        processing={processing || waffoProcessing || pancakeProcessing}
        discountRate={getDiscountRate()}
        bonusRate={getBonusRate()}
        usdExchangeRate={effectiveUsdExchangeRate}
        nowPaymentsCurrencies={topupInfo?.nowpayments_currencies}
        nowPaymentsCurrency={nowPaymentsCurrency}
        onNowPaymentsCurrencyChange={setNowPaymentsCurrency}
        paymentUsdRate={currency?.usdExchangeRate}
        priceRatio={(status?.price as number) || 1}
      />

      <BillingHistoryDialog
        open={billingDialogOpen}
        onOpenChange={setBillingDialogOpen}
        invoiceEnabled={status?.invoice_enabled === true}
      />

      <CreemConfirmDialog
        open={creemDialogOpen}
        onOpenChange={setCreemDialogOpen}
        onConfirm={handleCreemConfirm}
        product={selectedCreemProduct}
        processing={creemProcessing}
      />
    </>
  )
}
