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
import {
  accountsToAdd,
  coverage,
  pickModel,
  windowOf,
  type Coverage,
} from './components/outlook'
import type { EngineOutlook } from './types'

/** The window the gauge reads: the week ahead. */
export const SUPPLY_WINDOW_HOURS = 168

export type WeekSupply = {
  /** What the week ahead is forecast to ask of the pool, in dollars. */
  demand: number
  /** The most the pool can spend in the week, resets included. */
  supply: number
  /** Demand over supply: above 1 the pool cannot serve it all. */
  ratio: number
  coverage: Coverage
  /** Hours from now of the first hour the pool runs short; null when it never does. */
  firstShortHours: number | null
  /** The fewest accounts of one plan that leave no gap in the week; null when none does. */
  add: { count: number; plan: string; tier: string } | null
}

/**
 * The week ahead's demand against the supply, read from the smart forecast
 * of the Claude pool's outlook. Undefined when the outlook has no usable
 * forecast, or no supply to divide by.
 */
export function weekSupply(
  outlook: EngineOutlook | undefined
): WeekSupply | undefined {
  if (!outlook || outlook.error) return undefined
  const model = pickModel(outlook, 'smart')
  if (!model) return undefined
  const window = windowOf(model.windows, SUPPLY_WINDOW_HOURS)
  const supply = windowOf(outlook.remaining, SUPPLY_WINDOW_HOURS)
  if (!window || !supply || supply.with_resets_usd <= 0) return undefined
  let add: WeekSupply['add'] = null
  for (const addition of model.additions) {
    const count = accountsToAdd(addition)
    if (count == null || count <= 0) continue
    if (!add || count < add.count) {
      add = { count, plan: addition.plan, tier: addition.tier }
    }
  }
  return {
    demand: window.demand_usd,
    supply: supply.with_resets_usd,
    ratio: window.demand_usd / supply.with_resets_usd,
    coverage: coverage(window, supply),
    firstShortHours: window.short_usd > 0 ? window.first_short_hours : null,
    add,
  }
}
