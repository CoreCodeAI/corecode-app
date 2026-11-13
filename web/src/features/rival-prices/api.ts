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
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

import type { ApiResponse } from '../wallet/types'
import type { RivalBoard, RivalPriceChange, RivalSite } from './types'

async function unwrap<T>(
  request: Promise<{ data: ApiResponse<T> }>,
  fallback: string
): Promise<T> {
  const res = await request
  if (!res.data.success) throw createServerError(res.data, fallback)
  return res.data.data as T
}

export function getRivalBoard(model?: string) {
  return unwrap(
    api.get<ApiResponse<RivalBoard>>('/api/rival-prices', {
      params: model ? { model } : {},
    }),
    'Failed to load rival prices'
  )
}

export function getRivalSites() {
  return unwrap(
    api.get<ApiResponse<RivalSite[]>>('/api/rival-prices/sites'),
    'Failed to load rival prices'
  )
}

export function getRivalChanges(model?: string) {
  return unwrap(
    api.get<ApiResponse<RivalPriceChange[]>>('/api/rival-prices/changes', {
      params: model ? { model } : {},
    }),
    'Failed to load rival prices'
  )
}

export function addRivalSite(name: string, url: string) {
  return unwrap(
    api.post<ApiResponse<RivalSite>>('/api/rival-prices/sites', { name, url }),
    'Failed to save'
  )
}

export function updateRivalSite(
  id: number,
  update: { enabled?: boolean; api_base?: string }
) {
  return unwrap(
    api.put<ApiResponse<RivalSite>>(`/api/rival-prices/sites/${id}`, update),
    'Failed to save'
  )
}

export function checkRivalSite(id: number) {
  return unwrap(
    api.post<ApiResponse<null>>(`/api/rival-prices/sites/${id}/check`),
    'Failed to save'
  )
}

export function setRivalOption(
  key: 'rival_price_setting.enabled' | 'rival_price_setting.proxy',
  value: boolean | string
) {
  return unwrap(
    api.put<ApiResponse<null>>('/api/option/', { key, value }),
    'Failed to save'
  )
}
