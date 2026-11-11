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
/**
 * The tax on an order amount at a percent rate, rounded to the fen as the
 * server rounds it. The rate has at most two decimals, so the inner product
 * is a whole number once floating-point noise is rounded away.
 */
export function invoiceTaxCents(orderCents: number, rate: number): number {
  return Math.round(Math.round(orderCents * rate * 100) / 10000)
}

/** The balance a tax deducts, rounded up as the server rounds it. */
export function invoiceTaxQuota(
  taxCents: number,
  quotaPerYuan: number
): number {
  return Math.ceil(Number(((taxCents * quotaPerYuan) / 100).toFixed(6)))
}

/**
 * Formats fen as yuan with two decimals, the way an invoice states amounts.
 * The wallet's CNY formatters drop trailing zeros, which an invoice amount
 * keeps. Pass the Intl locale of the interface language.
 */
export function formatInvoiceAmount(cents: number, locale?: string): string {
  return new Intl.NumberFormat(locale ?? 'zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
