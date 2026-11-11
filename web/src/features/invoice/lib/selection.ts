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
import type { InvoiceableOrder } from '../types'
import { orderKey } from './order-key'

/**
 * The selection as the order list shows it: keys of orders that left the list
 * (claimed elsewhere, or past the invoiceable period) are dropped, so they
 * neither count toward the cap nor leave select-all half checked.
 */
export function visibleSelection(
  orders: readonly InvoiceableOrder[],
  selected: ReadonlySet<string>
): Set<string> {
  return new Set(orders.map(orderKey).filter((key) => selected.has(key)))
}

/** Ticks or unticks one order, never past maxOrders. */
export function toggleSelection(
  visible: ReadonlySet<string>,
  order: InvoiceableOrder,
  checked: boolean,
  maxOrders: number
): Set<string> {
  const next = new Set(visible)
  const key = orderKey(order)
  if (checked && next.size < maxOrders) next.add(key)
  if (!checked) next.delete(key)
  return next
}
