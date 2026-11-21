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

import type { StatusBadgeProps } from '@/components/status-badge'
import { formatTimestampToDate } from '@/lib/format'

import type { TopupStatus } from '../types'

// ============================================================================
// Billing Utility Functions
// ============================================================================

interface StatusConfig {
  variant: StatusBadgeProps['variant']
  label: string
}

/**
 * Status badge configuration
 */
export const STATUS_CONFIG: Record<TopupStatus, StatusConfig> = {
  success: {
    variant: 'success',
    label: 'Success',
  },
  pending: {
    variant: 'warning',
    label: 'Pending',
  },
  failed: {
    variant: 'danger',
    label: 'Failed',
  },
  expired: {
    variant: 'danger',
    label: 'Expired',
  },
  // Paid, then returned to the payer; it no longer counts as paid.
  refunded: {
    variant: 'neutral',
    label: 'Refunded',
  },
}

/**
 * Get status badge configuration
 */
export function getStatusConfig(status: TopupStatus): StatusConfig {
  return STATUS_CONFIG[status] || STATUS_CONFIG.pending
}

// The name a top-up record shows for the method that paid it: the records
// table, its filter and summary, the wallet's billing history, the usage-log
// audit and the site insights all print this one name. Same-named methods of
// different gateways differ in the label, so an administrator filtering
// Alipay (Stripe) never gets Alipay's orders. The gateway shows only where a
// method name alone would be ambiguous. Plain string keys, not PAYMENT_TYPES:
// the overview reaches this file, and importing the wallet constants would
// carry them into its first load. The test checks the two stay in step.
const PAYMENT_METHOD_BRANDS: Readonly<Record<string, string>> = {
  stripe: 'Stripe',
  nowpayments: 'USDT/USDC (NOWPayments)',
  dodopayments: 'Dodo Payments',
  creem: 'Creem',
  waffo: 'Waffo',
  waffo_pancake: 'Waffo Pancake',
}

const PAYMENT_METHOD_LABEL_KEYS: Readonly<Record<string, string>> = {
  alipay: 'Alipay',
  wxpay: 'WeChat Pay',
  chain_deposit: 'On-chain deposit (USDT/USDC)',
  balance: 'Balance',
  offline: 'Offline transfer',
}

const STRIPE_METHOD_KEYS: Readonly<Record<string, string>> = {
  stripe_alipay: 'Alipay',
  stripe_wechat_pay: 'WeChat Pay',
  stripe_card: 'Card',
}

/**
 * A recorded payment method's name in the reader's language. A value the
 * console does not know (an Epay method the operator added, a gateway added
 * later) reads "Other (value)", so the raw value stays visible to an
 * administrator and is never shown bare. An empty value returns ''.
 */
export function paymentMethodLabel(
  method: string | null | undefined,
  t: TFunction
): string {
  if (!method) return ''
  if (PAYMENT_METHOD_BRANDS[method]) return PAYMENT_METHOD_BRANDS[method]
  if (PAYMENT_METHOD_LABEL_KEYS[method]) {
    return t(PAYMENT_METHOD_LABEL_KEYS[method])
  }
  if (STRIPE_METHOD_KEYS[method]) {
    return t('{{method}} (Stripe)', { method: t(STRIPE_METHOD_KEYS[method]) })
  }
  return t('Other ({{method}})', { method })
}

/**
 * Format timestamp to readable date string
 */
export function formatTimestamp(timestamp: number): string {
  return formatTimestampToDate(timestamp)
}
