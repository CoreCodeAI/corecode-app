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
 * CoreCode fork: search and sort for the price board's rows. The `search` and
 * `sort` URL params of /pricing carry the query and the sort key, so a filtered
 * list is a shareable link.
 */
import type { PricingModel } from '../types'
import type { BaseUnitPrices } from './unit-prices'

export const BOARD_SORTS = ['input', 'output', 'savings'] as const
export type BoardSort = (typeof BOARD_SORTS)[number]

export const DEFAULT_BOARD_SORT: BoardSort = 'input'

export type BoardRow = {
  model: PricingModel
  base: BaseUnitPrices
  markup: number
}

/** A sort key from the URL, or the default for a missing or unknown one. */
export function parseBoardSort(value: string | undefined): BoardSort {
  return BOARD_SORTS.find((sort) => sort === value) ?? DEFAULT_BOARD_SORT
}

export function matchesModelSearch(
  model: PricingModel,
  query: string
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (model.model_name ?? '').toLowerCase().includes(needle)
}

function priceOrInfinity(value: number): number {
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

/** Cheapest first for a price; the biggest saving first for `savings`. */
export function sortBoardRows<Row extends BoardRow>(
  rows: Row[],
  sort: BoardSort
): Row[] {
  const byInput = (a: Row, b: Row) => a.base.prices.input - b.base.prices.input
  const compare = (a: Row, b: Row): number => {
    if (sort === 'output') {
      return (
        priceOrInfinity(a.base.prices.output) -
          priceOrInfinity(b.base.prices.output) || byInput(a, b)
      )
    }
    // The group discount is shared, so the lower markup saves more.
    if (sort === 'savings') return a.markup - b.markup || byInput(a, b)
    return byInput(a, b)
  }
  return [...rows].sort(compare)
}
