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
import { queryOptions } from '@tanstack/react-query'

import { getUserLogs } from '@/features/usage-logs/api'
import { LOG_TYPE_ENUM } from '@/features/usage-logs/constants'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import { requireServerSuccess } from '@/lib/server-error-message'

/** How many credits the wallet's credit history card lists. */
export const VISIBLE_CREDITS = 5

/** The params of the credit history card's request. */
export const RECENT_CREDITS_PARAMS = {
  p: 1,
  page_size: VISIBLE_CREDITS,
  type: LOG_TYPE_ENUM.TOPUP,
}

/** The wallet's latest credits; its loader skips the request while fresh. */
export const recentCreditsQueryOptions = queryOptions({
  queryKey: ['wallet', 'recent-credits'],
  queryFn: async () => {
    const result = requireServerSuccess(
      await getUserLogs(RECENT_CREDITS_PARAMS)
    )
    return (result.data?.items ?? []) as UsageLog[]
  },
  staleTime: 30 * 1000,
})
