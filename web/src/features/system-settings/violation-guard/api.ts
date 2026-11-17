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
import type { ApiResponse } from '@/features/profile/types'
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

export type ViolationAction =
  | 'merged'
  | 'warn'
  | 'client_check'
  | 'model_refusal'
  | 'strike'
  | 'suspend'
  | 'ban'
export type ViolationMode = 'observe' | 'enforce' | 'exempt'

export type ViolationRecord = {
  id: number
  user_id: number
  username: string
  created_at: number
  token_id: number
  channel_id: number
  model_name: string
  request_id: string
  category: string
  excerpt: string
  action: ViolationAction
  mode: ViolationMode
  suspended_until: number
}

export type ViolationListParams = {
  p: number
  page_size: number
  user_id?: number
}

type ViolationPage = {
  page: number
  page_size: number
  total: number
  items: ViolationRecord[]
}

export async function getViolations(
  params: ViolationListParams
): Promise<ViolationPage> {
  const res = await api.get<ApiResponse<ViolationPage>>(
    '/api/user/violations',
    {
      params,
    }
  )
  if (!res.data.success || !res.data.data) {
    throw createServerError(res.data, 'Failed to load violation records')
  }
  return res.data.data
}

export async function liftViolations(userId: number): Promise<void> {
  const res = await api.post<ApiResponse<unknown>>(
    `/api/user/${userId}/violations/lift`
  )
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to lift the restrictions')
  }
}
