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

import type { PricingModel } from '../types'
import { getBaseUnitPrices } from './unit-prices'

/**
 * What a customer pays relative to the provider's official price, split into
 * the factors the model square explains.
 *
 * `price` is what the customer recharges, in CNY, for $1 of credit;
 * `usdExchangeRate` is the reference CNY per USD. Their quotient is the
 * exchange-rate factor. Card prices already include the group ratio and the
 * model's markup over the official price, so the combined factor is all three
 * multiplied.
 */
export type BillingDiscount = {
  exchange: number
  group: number
  markup: number
  combined: number
}

export function getBillingDiscount(input: {
  price: number
  usdExchangeRate: number
  groupRatio: number
  markup?: number
}): BillingDiscount {
  const exchange = input.price / input.usdExchangeRate
  const markup = input.markup ?? 1
  return {
    exchange,
    group: input.groupRatio,
    markup,
    combined: exchange * input.groupRatio * markup,
  }
}

/**
 * How far a model's ratios sit above the provider's official price: 1 unless
 * the operator priced it higher because it costs more to serve. Dividing a
 * ratio-derived price by it gives the official price.
 */
export function getOfficialPriceMarkup(model: PricingModel): number {
  const markup = model.official_price_markup
  return typeof markup === 'number' && Number.isFinite(markup) && markup > 0
    ? markup
    : 1
}

/** Whether a markup changes any figure at two decimals. */
export function hasMarkup(markup: number): boolean {
  return Math.round(markup * 100) !== 100
}

/**
 * CoreCode fork: the markup a group's own figure ("about N of official
 * price", the saving banner) is multiplied by. Card prices include each
 * model's markup, so a group whose every token-priced model is marked up
 * claims too large a saving without it. The floor is 1 when any of the
 * group's token-priced models has no markup (a Claude group: Fable at 1.5
 * beside Opus at 1), else the smallest markup among them, so the group never
 * claims more than its cheapest-to-us model saves. infra's render-pricing.py
 * applies the same rule.
 */
export function getGroupMarkupFloor(models: PricingModel[]): number {
  const markups = models
    .filter((model) => getBaseUnitPrices(model))
    .map(getOfficialPriceMarkup)
  if (markups.length === 0 || !markups.every(hasMarkup)) return 1
  return Math.min(...markups)
}

/**
 * How the combined factor reads against the official price: a discount
 * below 1, a markup above it, parity within rounding.
 */
export type DiscountKind = 'discount' | 'same' | 'markup'

export function getDiscountKind(combined: number): DiscountKind {
  const rounded = Math.round(combined * 100) / 100
  if (rounded < 1) return 'discount'
  if (rounded > 1) return 'markup'
  return 'same'
}
