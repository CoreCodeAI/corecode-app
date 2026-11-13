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
import { getStoredPageSize } from '@/hooks/use-table-url-state'
import { prefetchGet } from '@/lib/prefetch-get'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { logStatsUrl, logsUrl } from '../api'
import { resolveLogsViewAccess } from '../components/usage-logs-provider'
import type { GetLogsParams } from '../types'
import { buildApiParams } from './utils'

/** The phone breakpoint UsageLogsTable switches its page size at. */
const PHONE_QUERY = '(max-width: 640px)'

/**
 * Start the common logs page's list and stats requests from the route's
 * loader, so they are under way while the pointer rests on a link to the
 * page. The params are the ones UsageLogsTable and CommonLogsStats build on
 * their first render: the view scope starts at 'all', and the URL's search
 * params decide the filters (the table's column filters come from them).
 */
export function prefetchCommonLogsPage(search: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  const role = useAuthStore.getState().auth.user?.role ?? ROLE.GUEST
  const isAdmin = resolveLogsViewAccess(role, 'all') !== 'self'
  const page = typeof search.page === 'number' ? search.page : 1
  const defaultPageSize = window.matchMedia(PHONE_QUERY).matches ? 20 : 100
  const pageSize =
    typeof search.pageSize === 'number'
      ? search.pageSize
      : (getStoredPageSize() ?? defaultPageSize)
  const params = { searchParams: search, columnFilters: [], isAdmin }
  // The URLs getAllLogs/getUserLogs and getLogStats/getUserLogStats build.
  prefetchGet(
    logsUrl('/api/log', buildApiParams({ ...params, page, pageSize }), isAdmin)
  )
  prefetchGet(
    logStatsUrl(
      '/api/log',
      buildApiParams({ ...params, page: 1, pageSize: 1 }),
      isAdmin
    )
  )
}

/** Send getUserLogs(params)'s request ahead of the page that reads it. */
export function prefetchUserLogs(
  params: Omit<GetLogsParams, 'user_id' | 'username' | 'channel'>
): void {
  prefetchGet(logsUrl('/api/log', params, false))
}
