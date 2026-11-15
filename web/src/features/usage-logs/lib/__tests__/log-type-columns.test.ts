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
import type { ColumnDef } from '@tanstack/react-table'
import { describe, expect, it } from 'vitest'

import {
  columnsForLogTypes,
  logTypesCarryOnlyText,
  selectedLogTypes,
} from '../log-type-columns'

// The admin's common-log columns, in table order.
const COLUMNS: ColumnDef<unknown>[] = [
  { accessorKey: 'created_at' },
  { id: 'channel' },
  { id: 'user' },
  { accessorKey: 'token_name' },
  { accessorKey: 'model_name' },
  { accessorKey: 'is_stream' },
  { accessorKey: 'prompt_tokens' },
  { accessorKey: 'quota' },
  { accessorKey: 'use_time' },
  { accessorKey: 'content' },
]

function ids(types: number[] | null) {
  return columnsForLogTypes(COLUMNS, types).map(
    (column) =>
      column.id ?? ('accessorKey' in column ? column.accessorKey : undefined)
  )
}

describe('selectedLogTypes', () => {
  it('reads the type filter on the time column', () => {
    expect(selectedLogTypes([{ id: 'created_at', value: ['1', '7'] }])).toEqual(
      [1, 7]
    )
  })

  it('reads no filter, an empty one and "all" as every type', () => {
    expect(selectedLogTypes([])).toBeNull()
    expect(selectedLogTypes([{ id: 'created_at', value: [] }])).toBeNull()
    expect(selectedLogTypes([{ id: 'created_at', value: ['0'] }])).toBeNull()
    expect(
      selectedLogTypes([{ id: 'model_name', value: 'claude-opus' }])
    ).toBeNull()
  })
})

describe('columnsForLogTypes', () => {
  it('keeps every column for every type and for consumption', () => {
    expect(ids(null)).toHaveLength(COLUMNS.length)
    expect(ids([2])).toHaveLength(COLUMNS.length)
  })

  it('leaves top-ups the time, user and details columns', () => {
    expect(ids([1])).toEqual(['created_at', 'user', 'content'])
    expect(ids([1, 3, 4, 7])).toEqual(['created_at', 'user', 'content'])
  })

  it('keeps refunds their usage columns but not stream or timing', () => {
    expect(ids([6])).toEqual([
      'created_at',
      'channel',
      'user',
      'token_name',
      'model_name',
      'prompt_tokens',
      'quota',
      'content',
    ])
  })

  it('keeps a column one of several selected types draws in', () => {
    expect(ids([1, 2])).toHaveLength(COLUMNS.length)
  })
})

describe('logTypesCarryOnlyText', () => {
  it('is true only when no selected type draws usage columns', () => {
    expect(logTypesCarryOnlyText([1])).toBe(true)
    expect(logTypesCarryOnlyText([1, 7])).toBe(true)
    expect(logTypesCarryOnlyText([1, 6])).toBe(false)
    expect(logTypesCarryOnlyText(null)).toBe(false)
  })
})
