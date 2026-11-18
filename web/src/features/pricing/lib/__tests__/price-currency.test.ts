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
import { expect, it } from 'vitest'

import {
  availablePriceCurrencies,
  DEFAULT_PRICE_CURRENCY,
  parsePriceCurrency,
  priceMoney,
} from '../price-currency'

const rates = { usdExchangeRate: 6.8, hkdPerCny: 1.089 }

it('shows yuan in USD at the site rate, as yuan, and in HKD at the Checkout rate', () => {
  expect(priceMoney('usd', rates).format(13.6)).toBe('$2')
  expect(priceMoney('cny', rates).format(3.8)).toBe('¥3.8')
  expect(priceMoney('hkd', rates).format(3.8)).toBe('HK$4.1382')
  // Four decimals at most, so a cache-read price still shows.
  expect(priceMoney('usd', rates).format(0.019)).toBe('$0.0028')
})

it('offers HKD only while the server has a rate, and falls back to CNY without one', () => {
  expect(availablePriceCurrencies(rates)).toEqual(['usd', 'cny', 'hkd'])
  const noRate = { usdExchangeRate: 6.8, hkdPerCny: 0 }
  expect(availablePriceCurrencies(noRate)).toEqual(['usd', 'cny'])
  expect(priceMoney('hkd', noRate).currency).toBe('cny')
})

it('reads only the currencies it knows from a URL or storage', () => {
  expect(parsePriceCurrency('hkd')).toBe('hkd')
  expect(parsePriceCurrency('HKD')).toBeNull()
  expect(parsePriceCurrency(undefined)).toBeNull()
})

it('defaults to CNY, the yuan a customer is charged, and still shows USD when picked', () => {
  expect(DEFAULT_PRICE_CURRENCY).toBe('cny')
  expect(priceMoney(DEFAULT_PRICE_CURRENCY, rates).format(6)).toBe('¥6')
  expect(priceMoney('usd', rates).currency).toBe('usd')
})
