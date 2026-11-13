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

import type { AffiliatePage, ApiResponse } from '../wallet/types'
import type { TopupReportFilters, TopupReportRecord, TopupStats } from './types'

async function unwrap<T>(
  request: Promise<{ data: ApiResponse<T> }>,
  fallback: string
): Promise<T> {
  const res = await request
  if (!res.data.success || res.data.data === undefined) {
    throw createServerError(res.data, fallback)
  }
  return res.data.data
}

export function getTopupRecords(
  filters: TopupReportFilters,
  page: { p: number; page_size: number }
): Promise<AffiliatePage<TopupReportRecord>> {
  return unwrap(
    api.get('/api/user/topup/records', { params: { ...filters, ...page } }),
    'Failed to load top-up records'
  )
}

export interface TopupRefundResult {
  refunded: { trade_no: string; user_id: number; money: number }[]
  already_refunded: number
}

/**
 * Mark paid orders refunded; requires an `admin.user.topup.refund` proof bound
 * to the same orders. The proof is single-use, so the request is never
 * replayed by the auth-refresh interceptor.
 */
export function refundTopups(
  tradeNos: string[],
  proofToken: string
): Promise<TopupRefundResult> {
  return unwrap(
    api.post(
      '/api/user/topup/refund',
      { trade_nos: tradeNos },
      {
        headers: { 'X-Security-Proof': proofToken },
        singleUseAuthorization: true,
      }
    ),
    'Failed to mark orders refunded'
  )
}

export function getTopupStats(
  filters: TopupReportFilters
): Promise<TopupStats> {
  return unwrap(
    api.get('/api/user/topup/stats', {
      params: {
        ...filters,
        // Minutes east of UTC, so days split at the viewer's midnight.
        tz_offset: -new Date().getTimezoneOffset(),
      },
    }),
    'Failed to load top-up summary'
  )
}
