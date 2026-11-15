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
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'

import {
  DISPLAYABLE_LOG_TYPES,
  LOG_TYPE_ALL_VALUE,
  TIMING_LOG_TYPES,
} from '../constants'

/**
 * The log types whose rows draw something in each common-log column. A column
 * left out draws on every type: time, user and details.
 */
const COMMON_COLUMN_LOG_TYPES: Record<string, readonly number[]> = {
  channel: DISPLAYABLE_LOG_TYPES,
  token_name: DISPLAYABLE_LOG_TYPES,
  model_name: DISPLAYABLE_LOG_TYPES,
  prompt_tokens: DISPLAYABLE_LOG_TYPES,
  quota: DISPLAYABLE_LOG_TYPES,
  is_stream: TIMING_LOG_TYPES,
  use_time: TIMING_LOG_TYPES,
}

/**
 * The log types the type filter selects, or null when it selects every type.
 * The filter lives on the time column.
 */
export function selectedLogTypes(
  columnFilters: ColumnFiltersState
): number[] | null {
  const value = columnFilters.find(
    (filter) => filter.id === 'created_at'
  )?.value
  const values = (Array.isArray(value) ? value : [value])
    .filter((item) => item != null && item !== '')
    .map(String)
  if (values.length === 0 || values.includes(LOG_TYPE_ALL_VALUE)) return null
  return values.map(Number).filter(Number.isFinite)
}

/**
 * Whether no selected type draws in the usage columns (channel, token, model,
 * tokens, cost): top-up, management, system and login logs carry only their
 * text, so the details column takes the room those columns leave.
 */
export function logTypesCarryOnlyText(types: number[] | null): boolean {
  return (
    types != null &&
    types.length > 0 &&
    !types.some((type) =>
      (DISPLAYABLE_LOG_TYPES as readonly number[]).includes(type)
    )
  )
}

/**
 * Drop the common-log columns that no selected type draws in. With top-ups
 * selected, seven of ten columns were blank and pushed the details, the only
 * column with content, past the right edge of the window.
 */
export function columnsForLogTypes<T>(
  columns: ColumnDef<T>[],
  types: number[] | null
): ColumnDef<T>[] {
  if (types == null || types.length === 0) return columns
  return columns.filter((column) => {
    const id =
      column.id ??
      ('accessorKey' in column ? String(column.accessorKey) : undefined)
    const drawnBy = id ? COMMON_COLUMN_LOG_TYPES[id] : undefined
    return !drawnBy || types.some((type) => drawnBy.includes(type))
  })
}
