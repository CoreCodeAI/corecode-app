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
import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { prefetchUserLogs } from '@/features/usage-logs/lib/prefetch'
import { prefetchGet } from '@/lib/prefetch-get'

import { AFFILIATE_SELF_KEY } from '../hooks/use-affiliate'
import {
  RECENT_CREDITS_PARAMS,
  recentCreditsQueryOptions,
} from './recent-credits'

/** The query client's default staleTime (lib/query-client.ts). */
const DEFAULT_STALE_MS = 10_000

function isFresh(queryClient: QueryClient, key: QueryKey, staleMs: number) {
  const updatedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0
  return updatedAt > 0 && Date.now() - updatedAt < staleMs
}

/**
 * Start the wallet's first requests from the route's loader, so they are
 * under way while the pointer rests on a link to the page. The top-up info,
 * the plan list and the subscription record load on every mount; the queries
 * are skipped while their cached data is fresh, since the page would not ask.
 */
export function prefetchWalletPage(queryClient: QueryClient): void {
  prefetchGet('/api/user/topup/info')
  prefetchGet('/api/subscription/plans')
  // The plan card reads it on every mount; the balance card's query reads
  // the same URL and shares the response.
  prefetchGet('/api/subscription/self')
  if (
    !isFresh(
      queryClient,
      recentCreditsQueryOptions.queryKey,
      recentCreditsQueryOptions.staleTime as number
    )
  ) {
    prefetchUserLogs(RECENT_CREDITS_PARAMS)
  }
  if (!isFresh(queryClient, AFFILIATE_SELF_KEY, DEFAULT_STALE_MS)) {
    prefetchGet('/api/affiliate/self')
  }
}
