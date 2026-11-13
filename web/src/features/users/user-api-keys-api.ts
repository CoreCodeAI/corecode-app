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
// Kept apart from ./api.ts, which the /keys page preloads through a shared
// chunk: only the users table's API keys dialog loads this module.
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

import type { ApiResponse, UserApiKey } from './types'

/** Requests per dialog open stop here; a user past this many keys sees the newest ones. */
const USER_API_KEYS_PAGE_SIZE = 100
const USER_API_KEYS_MAX_PAGES = 10

/**
 * Lists one user's API keys, newest first, with masked keys. The server pages
 * the list, so this walks pages until it has the total or reaches the cap.
 */
export async function getUserApiKeys(
  userId: number
): Promise<{ items: UserApiKey[]; total: number }> {
  const items: UserApiKey[] = []
  let total = 0
  for (let page = 1; page <= USER_API_KEYS_MAX_PAGES; page++) {
    const res = await api.get<
      ApiResponse<{ items: UserApiKey[] | null; total: number }>
    >(`/api/admin/users/${userId}/tokens`, {
      params: { p: page, page_size: USER_API_KEYS_PAGE_SIZE },
    })
    if (!res.data.success || !res.data.data) {
      throw createServerError(res.data, 'Failed to load API keys')
    }
    const pageItems = res.data.data.items ?? []
    total = res.data.data.total
    items.push(...pageItems)
    if (pageItems.length < USER_API_KEYS_PAGE_SIZE || items.length >= total) {
      break
    }
  }
  return { items, total }
}
