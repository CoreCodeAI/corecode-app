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

import type { ApiResponse } from './types'

// Kept apart from ../api, which the API keys page loads, so the contract bonus
// adds nothing to a core page's first load.
/** A user's contract top-up bonus: a fraction, 0 for none. */
export interface UserContractBonus {
  user_id: number
  rate: number
}

export async function getUserContractBonus(
  userId: number
): Promise<UserContractBonus> {
  const res = await api.get<ApiResponse<UserContractBonus>>(
    `/api/user/${userId}/contract-bonus`
  )
  if (!res.data.success || !res.data.data) {
    throw createServerError(res.data, 'Failed to load')
  }
  return res.data.data
}

export async function updateUserContractBonus(
  userId: number,
  rate: number
): Promise<UserContractBonus> {
  const res = await api.put<ApiResponse<UserContractBonus>>(
    `/api/user/${userId}/contract-bonus`,
    { rate }
  )
  if (!res.data.success || !res.data.data) {
    throw createServerError(res.data, 'Failed to save the contract bonus')
  }
  return res.data.data
}
