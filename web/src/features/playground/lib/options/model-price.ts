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
import { getConfiguredGroupRatio } from '@/features/pricing/lib/model-helpers'
import { getBaseUnitPrices } from '@/features/pricing/lib/unit-prices'
import type { PricingModel } from '@/features/pricing/types'

export type ModelPriceSummary = {
  /** Yuan per million input tokens at the chosen group. */
  input: number
  /** Yuan per million output tokens at the chosen group. */
  output: number
}

/**
 * The input and output price of a token-priced model at the playground's group,
 * in the currency the pricing page shows. Null for a model the pricing data
 * lacks, and for per-request or task models, which have no per-token price.
 */
export function getModelPriceSummary(
  models: PricingModel[],
  modelName: string,
  group: string,
  groupRatio: Record<string, number>,
  priceRate: number
): ModelPriceSummary | null {
  const model = models.find((item) => item.model_name === modelName)
  const base = model ? getBaseUnitPrices(model) : null
  if (!base || !Number.isFinite(base.prices.output)) return null
  const factor = getConfiguredGroupRatio(groupRatio, group) * priceRate
  return {
    input: base.prices.input * factor,
    output: base.prices.output * factor,
  }
}
