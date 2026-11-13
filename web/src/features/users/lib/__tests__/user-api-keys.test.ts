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
import { describe, expect, test } from 'vitest'

import type { UserApiKey } from '../../types'
import { countKeysByGroup } from '../user-api-keys'

function key(id: number, group: string): UserApiKey {
  return {
    id,
    name: `k${id}`,
    key: 'abcd**********wxyz',
    status: 1,
    group,
    created_time: 0,
    accessed_time: 0,
    expired_time: -1,
    remain_quota: 0,
    unlimited_quota: true,
    used_quota: 0,
  }
}

describe('countKeysByGroup', () => {
  test('counts each group, largest first with ties by name, and folds blank groups into the inherited one', () => {
    const counts = countKeysByGroup([
      key(1, 'claude'),
      key(2, ''),
      key(3, 'claude'),
      key(4, ' '),
      key(5, 'auto'),
      key(6, ''),
      key(7, 'claude'),
    ])
    expect(counts).toEqual([
      { group: '', count: 3 },
      { group: 'claude', count: 3 },
      { group: 'auto', count: 1 },
    ])
  })

  test('returns nothing for a user without keys', () => {
    expect(countKeysByGroup([])).toEqual([])
  })
})
