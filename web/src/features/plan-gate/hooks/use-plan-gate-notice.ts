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
import { queryOptions, useQuery } from '@tanstack/react-query'

import { requireServerSuccess } from '@/lib/server-error-message'

import { getPlanGateNotice } from '../api'

/**
 * The newcomer plan limit's effect on the last day's requests; null for a
 * customer with no plan it guards. The wallet and the overview share it.
 */
export const planGateNoticeQueryOptions = queryOptions({
  queryKey: ['subscription', 'plan-gate'],
  queryFn: async () =>
    requireServerSuccess(await getPlanGateNotice()).data ?? null,
  staleTime: 60 * 1000,
})

export function usePlanGateNotice(enabled = true) {
  return useQuery({ ...planGateNoticeQueryOptions, enabled })
}
