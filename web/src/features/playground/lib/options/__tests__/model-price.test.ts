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

import type { PricingModel } from '@/features/pricing/types'

import { getModelPriceSummary } from '../model-price'

const opus: PricingModel = {
  id: 1,
  model_name: 'claude-opus-5-5',
  quota_type: 0,
  model_ratio: 2,
  completion_ratio: 5,
  enable_groups: ['Claude'],
}

const perRequest: PricingModel = {
  id: 2,
  model_name: 'image-gen',
  quota_type: 1,
  model_price: 0.04,
  model_ratio: 0,
  completion_ratio: 0,
  enable_groups: ['Claude'],
}

it('prices input and output per million tokens at the group and recharge rate', () => {
  // model_ratio 2 is $4 per 1M input; completion ratio 5 makes $20 output.
  expect(
    getModelPriceSummary(
      [opus],
      'claude-opus-5-5',
      'Claude',
      { Claude: 1.5 },
      1
    )
  ).toEqual({ input: 6, output: 30 })
  expect(
    getModelPriceSummary(
      [opus],
      'claude-opus-5-5',
      'Claude',
      { Claude: 1.5 },
      2
    )
  ).toEqual({ input: 12, output: 60 })
})

it('has no price for an unknown or per-request model', () => {
  expect(getModelPriceSummary([opus], 'nope', 'Claude', {}, 1)).toBeNull()
  expect(
    getModelPriceSummary([perRequest], 'image-gen', 'Claude', {}, 1)
  ).toBeNull()
})
