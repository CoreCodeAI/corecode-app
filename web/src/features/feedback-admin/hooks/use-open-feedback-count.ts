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
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const OPEN_POLL_MS = 60_000

// Fetched here rather than through the feedback API module so the sidebar,
// which renders on every console page, does not pull that module into the
// layout chunk. The key sits under ['feedback', 'admin'], which the review
// dialog invalidates after each save.
async function getOpenCount(): Promise<number> {
  const res = await api.get<{
    success: boolean
    message?: string
    data?: { count: number }
  }>('/api/feedback/admin/open-count', { skipErrorHandler: true })
  if (!res.data.success || res.data.data === undefined) {
    throw new Error(res.data.message || 'open feedback count unavailable')
  }
  return res.data.data.count
}

/** How many reports are pending or being processed; 0 for customers. */
export function useOpenFeedbackCount(): number {
  const isAdmin = useAuthStore(
    (state) => (state.auth.user?.role ?? ROLE.GUEST) >= ROLE.ADMIN
  )
  const query = useQuery({
    queryKey: ['feedback', 'admin', 'open-count'],
    queryFn: getOpenCount,
    enabled: isAdmin,
    refetchInterval: OPEN_POLL_MS,
    retry: false,
    meta: { errorToast: false },
  })
  return isAdmin ? (query.data ?? 0) : 0
}
