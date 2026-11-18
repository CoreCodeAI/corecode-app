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
 * CoreCode fork: the currency the price board and the Claude Code estimate
 * show. Every figure starts as the yuan a customer pays (¥ per $1 of credit
 * times the credit spent) or the official price in yuan; a reader picks how
 * it is shown:
 *
 * - CNY (the default): yuan as they are, which is what a customer is charged
 *   (top-up is in yuan, ¥1 per $1 of credit).
 * - USD: yuan ÷ the site's reference rate (`usd_exchange_rate`), so the
 *   official price reads as the vendor's USD list price and every saving keeps
 *   its share.
 * - HKD: yuan × what Stripe Checkout charges in HKD for one yuan
 *   (`hkd_per_cny` in /api/pricing); offered only while the server has a rate.
 */
export const PRICE_CURRENCIES = ['usd', 'cny', 'hkd'] as const
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number]
export const DEFAULT_PRICE_CURRENCY: PriceCurrency = 'cny'

const SYMBOL: Record<PriceCurrency, string> = {
  usd: '$',
  cny: '¥',
  hkd: 'HK$',
}

export const PRICE_CURRENCY_LABEL: Record<PriceCurrency, string> = {
  usd: 'USD $',
  cny: 'CNY ¥',
  hkd: 'HKD HK$',
}

export function parsePriceCurrency(
  value: string | null | undefined
): PriceCurrency | null {
  return PRICE_CURRENCIES.find((code) => code === value) ?? null
}

// The last currency a reader picked, used when the URL names none.
const CURRENCY_KEY = 'corecode:pricing-currency'

export function readStoredPriceCurrency(): PriceCurrency | null {
  try {
    return parsePriceCurrency(localStorage.getItem(CURRENCY_KEY))
  } catch {
    return null
  }
}

export function storePriceCurrency(value: PriceCurrency): void {
  try {
    localStorage.setItem(CURRENCY_KEY, value)
  } catch {
    // Private mode: the URL still carries the choice.
  }
}

export type PriceRates = {
  /** Yuan per US dollar, the site's reference rate. */
  usdExchangeRate: number
  /** HKD charged per yuan; 0 or missing when the server has no rate. */
  hkdPerCny?: number
}

/** The currencies the rates allow; HKD needs a rate. */
export function availablePriceCurrencies(rates: PriceRates): PriceCurrency[] {
  return PRICE_CURRENCIES.filter(
    (code) => code !== 'hkd' || (rates.hkdPerCny ?? 0) > 0
  )
}

export type PriceMoney = {
  currency: PriceCurrency
  symbol: string
  /** A yuan amount in the chosen currency. */
  convert: (yuan: number) => number
  /** A yuan amount in the chosen currency, with its symbol. */
  format: (yuan: number) => string
}

/**
 * How to show yuan in `wanted`, or in the default (CNY) when the rates cannot give it.
 * At most four decimals, no trailing zeros: "$0.5588", "¥3.8", "HK$4.1382".
 */
export function priceMoney(
  wanted: PriceCurrency,
  rates: PriceRates
): PriceMoney {
  const currency = availablePriceCurrencies(rates).includes(wanted)
    ? wanted
    : DEFAULT_PRICE_CURRENCY
  const perYuanBy: Record<PriceCurrency, number> = {
    usd: 1 / Math.max(rates.usdExchangeRate, 0.001),
    cny: 1,
    hkd: rates.hkdPerCny ?? 0,
  }
  const perYuan = perYuanBy[currency]
  const convert = (yuan: number) => yuan * perYuan
  return {
    currency,
    symbol: SYMBOL[currency],
    convert,
    format: (yuan) =>
      `${SYMBOL[currency]}${Number(convert(yuan).toFixed(4)).toLocaleString(
        'en-US',
        { maximumFractionDigits: 4 }
      )}`,
  }
}

/** Yuan shown as yuan: the board's view when its caller passes no currency. */
export const CNY_MONEY = priceMoney('cny', { usdExchangeRate: 1 })
