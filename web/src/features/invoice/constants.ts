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
import type { StatusBadgeProps } from '@/components/status-badge'

import type { InvoiceOrderType, InvoiceStatus, InvoiceTaxMethod } from './types'

export const INVOICE_KEY = ['invoice'] as const
export const INVOICE_ADMIN_KEY = ['invoice', 'admin'] as const

/** `labelKey` is the i18n key for each status. */
export const INVOICE_STATUS_CONFIG: Record<
  InvoiceStatus,
  { labelKey: string; variant: StatusBadgeProps['variant'] }
> = {
  pending_payment: { labelKey: 'Awaiting tax payment', variant: 'warning' },
  pending_review: { labelKey: 'Under review', variant: 'info' },
  issued: { labelKey: 'Invoice issued', variant: 'success' },
  rejected: { labelKey: 'Invoice rejected', variant: 'danger' },
  cancelled: { labelKey: 'Cancelled', variant: 'neutral' },
}

export const INVOICE_STATUSES = Object.keys(
  INVOICE_STATUS_CONFIG
) as InvoiceStatus[]

/** `labelKey` is the i18n key for each kind of order. */
export const INVOICE_ORDER_TYPE_LABEL: Record<InvoiceOrderType, string> = {
  topup: 'Top-up',
  subscription: 'Subscription',
}

/** `labelKey` is the i18n key for each way to pay the tax. */
export const INVOICE_TAX_METHOD_LABEL: Record<InvoiceTaxMethod, string> = {
  balance: 'Balance',
  alipay: 'Alipay',
  wxpay: 'WeChat Pay',
}
