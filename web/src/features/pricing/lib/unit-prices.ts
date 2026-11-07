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
 * CoreCode fork: the four Claude Code unit prices of a model, in USD per
 * million tokens before any group ratio, and what they come to in CNY.
 */
import type { PricingModel } from '../types'
import { expressionTurnCost } from './claude-code-estimate'
import { isDynamicPricingModel, isTaskUsagePricingModel } from './dynamic-price'
import { isTokenBasedModel } from './model-helpers'
import { calculateTokenPrice } from './price'

export type UnitPriceKey = 'input' | 'output' | 'cacheWrite' | 'cacheRead'

export const UNIT_PRICE_KEYS: UnitPriceKey[] = [
  'input',
  'output',
  'cacheWrite',
  'cacheRead',
]

export type BaseUnitPrices = {
  /** USD per million tokens; NaN when the model has no such price. */
  prices: Record<UnitPriceKey, number>
  /** True when the model prices by context length and these are its first tier. */
  tiered: boolean
}

const MILLION = 1_000_000

const EXPRESSION_VARIABLE = {
  input: 'p',
  output: 'c',
  cacheWrite: 'cc',
  cacheRead: 'cr',
} as const

// Longer than any context window, so it reaches an expression's last length tier.
const LONG_CONTEXT = 100 * MILLION

const TOKEN_PRICE_TYPE = {
  input: 'input',
  output: 'output',
  cacheWrite: 'create_cache',
  cacheRead: 'cache',
} as const

/**
 * Base prices of a token-priced model, or null for per-request and task
 * models. A context-priced model is evaluated at a context length of zero,
 * which is its first tier; the expression is linear in each token count.
 * It is `tiered` only when a long context costs more than that first tier.
 */
export function getBaseUnitPrices(model: PricingModel): BaseUnitPrices | null {
  if (
    isDynamicPricingModel(model) &&
    !isTaskUsagePricingModel(model) &&
    !model.billing_plugin_variants?.length
  ) {
    const prices = {} as Record<UnitPriceKey, number>
    let tiered = false
    for (const key of UNIT_PRICE_KEYS) {
      const variable = EXPRESSION_VARIABLE[key]
      const cost = expressionTurnCost(model, { [variable]: MILLION, len: 0 }, 1)
      const longCost = expressionTurnCost(
        model,
        { [variable]: MILLION, len: LONG_CONTEXT },
        1
      )
      prices[key] = cost ? cost.usd : Number.NaN
      if (cost && longCost && longCost.usd > cost.usd) tiered = true
    }
    if (!Number.isFinite(prices.input)) return null
    return { prices, tiered }
  }

  if (!isTokenBasedModel(model) || isDynamicPricingModel(model)) return null
  const prices = {} as Record<UnitPriceKey, number>
  for (const key of UNIT_PRICE_KEYS) {
    prices[key] = calculateTokenPrice(model, TOKEN_PRICE_TYPE[key], 1)
  }
  return { prices, tiered: false }
}

/** "¥27.2": yuan with at most four decimals and no trailing zeros. */
export function formatYuan(value: number): string {
  return `¥${Number(value.toFixed(4)).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  })}`
}
