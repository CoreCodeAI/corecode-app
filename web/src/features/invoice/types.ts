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
export type InvoiceStatus =
  | 'pending_payment'
  | 'pending_review'
  | 'issued'
  | 'rejected'
  | 'cancelled'

export type InvoiceTitleType = 'company' | 'personal'

export type InvoiceOrderType = 'topup' | 'subscription'

/** How a tax is paid: from the balance, or through epay. */
export type InvoiceTaxMethod = 'balance' | 'alipay' | 'wxpay'

export type InvoiceEpayMethod = Exclude<InvoiceTaxMethod, 'balance'>

export interface InvoiceConfig {
  enabled: boolean
  /** Percent of the order amount. */
  tax_rate: number
  categories: string[]
  order_days: number
  max_orders: number
  payment_timeout_minutes: number
  /** The epay methods offered beside the balance. */
  pay_methods: InvoiceEpayMethod[]
  /** Balance quota per yuan of tax. */
  quota_per_yuan: number
}

/** A paid order that can go into an application. Amounts are in fen. */
export interface InvoiceableOrder {
  order_type: InvoiceOrderType
  order_id: number
  trade_no: string
  amount_cents: number
  paid_time: number
  payment_method: string
}

export interface Invoice {
  id: number
  user_id: number
  status: InvoiceStatus
  invoice_type: string
  title_type: InvoiceTitleType
  title: string
  tax_no: string
  category: string
  email: string
  order_cents: number
  tax_rate: number
  tax_cents: number
  tax_method: string
  tax_trade_no: string
  tax_quota: number
  tax_paid_time: number
  reject_reason: string
  reviewed_by: number
  issued_time: number
  file_name: string
  file_mime: string
  file_size: number
  created_time: number
  updated_time: number
}

export interface InvoiceItem {
  id: number
  invoice_id: number
  order_type: InvoiceOrderType
  order_id: number
  trade_no: string
  amount_cents: number
  paid_time: number
}

export interface InvoiceDetail {
  invoice: Invoice
  items: InvoiceItem[]
  /** Present for administrators. */
  user?: { id: number; username?: string; email?: string }
}

export interface InvoiceAmount {
  cents: number
  count: number
}

export interface InvoiceSummary {
  available: InvoiceAmount
  processing: InvoiceAmount
  issued: InvoiceAmount
}

export interface InvoicePage {
  items: Invoice[]
  total: number
  page: number
  page_size: number
}

export interface InvoiceSubmission {
  title_type: InvoiceTitleType
  title: string
  tax_no: string
  category: string
  email: string
  orders: Array<{ order_type: InvoiceOrderType; order_id: number }>
  payment_method: InvoiceTaxMethod
}

/**
 * The answer to a submission or a tax payment. `url` and `params` are the
 * epay form to post when the tax is paid through epay.
 */
export interface InvoicePaymentStart {
  invoice: Invoice
  url?: string
  params?: Record<string, string>
}

export interface InvoiceFilters {
  status?: string
  keyword?: string
}
