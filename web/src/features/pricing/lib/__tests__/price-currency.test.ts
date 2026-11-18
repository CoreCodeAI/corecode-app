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
  defaultPriceCurrency,
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

it('defaults Simplified Chinese, and a missing language, to CNY', () => {
  for (const language of [
    'zh',
    'zhCN',
    'zh-CN',
    'zh-SG',
    'zh-Hans',
    'zh-Hans-CN',
  ]) {
    expect(defaultPriceCurrency(language, rates)).toBe('cny')
  }
  expect(defaultPriceCurrency(undefined, rates)).toBe('cny')
  expect(defaultPriceCurrency(null, rates)).toBe('cny')
  expect(defaultPriceCurrency('', rates)).toBe('cny')
})

it('defaults Traditional Chinese to HKD only while the server has a rate', () => {
  for (const language of [
    'zhTW',
    'zh-TW',
    'zh_HK',
    'zh-MO',
    'zh-Hant',
    'zh-Hant-TW',
  ]) {
    expect(defaultPriceCurrency(language, rates)).toBe('hkd')
    expect(defaultPriceCurrency(language, { hkdPerCny: 0 })).toBe('cny')
    expect(defaultPriceCurrency(language, {})).toBe('cny')
  }
})

it('defaults every other language to USD, and still shows what was picked', () => {
  for (const language of ['en', 'en-US', 'ja', 'ko', 'ru', 'fr', 'vi', 'de']) {
    expect(defaultPriceCurrency(language, rates)).toBe('usd')
  }
  expect(priceMoney(defaultPriceCurrency('cn', rates), rates).format(6.8)).toBe(
    '$1'
  )
  expect(priceMoney('cny', rates).format(6)).toBe('¥6')
})
