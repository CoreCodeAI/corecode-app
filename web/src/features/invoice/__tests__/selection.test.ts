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

import { toggleSelection, visibleSelection } from '../lib/selection'
import type { InvoiceableOrder } from '../types'

function order(id: number): InvoiceableOrder {
  return {
    order_type: 'topup',
    order_id: id,
    trade_no: `T${id}`,
    amount_cents: 1000,
    paid_time: 1762800000,
    payment_method: 'alipay',
  }
}

it('drops orders that left the list from the selection and the cap', () => {
  // Three orders ticked at a cap of 3, then two were claimed elsewhere.
  const selected = new Set(['topup:1', 'topup:2', 'topup:3'])
  const remaining = [order(3), order(4), order(5)]

  const visible = visibleSelection(remaining, selected)
  expect([...visible]).toEqual(['topup:3'])

  const next = toggleSelection(visible, order(4), true, 3)
  expect([...next].sort()).toEqual(['topup:3', 'topup:4'])
})

it('never ticks past the cap and always allows unticking', () => {
  const full = new Set(['topup:1', 'topup:2'])
  expect([...toggleSelection(full, order(3), true, 2)].sort()).toEqual([
    'topup:1',
    'topup:2',
  ])
  expect([...toggleSelection(full, order(1), false, 2)]).toEqual(['topup:2'])
})
