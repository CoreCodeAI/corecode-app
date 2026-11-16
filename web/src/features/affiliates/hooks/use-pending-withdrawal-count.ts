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

const WITHDRAWAL_POLL_MS = 60_000

// The sidebar renders on every console page, so the count is fetched here
// rather than through ../api: importing that module would put the affiliate
// API and its messages in the layout chunk and the core locale of every page.
// The key sits under ['affiliate'], which the withdrawals tab invalidates
// after each payout or rejection.
async function getPendingWithdrawalCount(): Promise<number> {
  const res = await api.get<{
    success: boolean
    message?: string
    data?: { count: number }
  }>('/api/affiliate/admin/withdrawal-count', { skipErrorHandler: true })
  if (!res.data.success || res.data.data === undefined) {
    throw new Error(res.data.message || 'withdrawal count unavailable')
  }
  return res.data.data.count
}

/** How many commission withdrawals wait for root; 0 for everyone else. */
export function usePendingWithdrawalCount(): number {
  const isRoot = useAuthStore(
    (state) => (state.auth.user?.role ?? ROLE.GUEST) >= ROLE.SUPER_ADMIN
  )
  const query = useQuery({
    queryKey: ['affiliate', 'admin', 'withdrawal-count'],
    queryFn: getPendingWithdrawalCount,
    enabled: isRoot,
    refetchInterval: WITHDRAWAL_POLL_MS,
    retry: false,
    meta: { errorToast: false },
  })
  return isRoot ? (query.data ?? 0) : 0
}
