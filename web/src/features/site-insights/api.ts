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

import type { ApiResponse } from '../wallet/types'
import type {
  ActivityInsights,
  BusinessInsights,
  CapacityInsights,
  EnginePool,
  FinanceInsights,
  GrowthInsights,
  InsightsRange,
  PoolProvider,
  PoolUsage,
  QualityInsights,
  RiskInsights,
} from './types'

export type InsightsView =
  | 'capacity'
  | 'finance'
  | 'risk'
  | 'growth'
  | 'activity'
  | 'quality'
  | 'business'
  | 'pool'

export type InsightsByView = {
  capacity: CapacityInsights
  finance: FinanceInsights
  risk: RiskInsights
  growth: GrowthInsights
  activity: ActivityInsights
  quality: QualityInsights
  business: BusinessInsights
  pool: EnginePool
}

/** The longest range, in days, each view's endpoint accepts. */
export const VIEW_MAX_DAYS: Record<InsightsView, number> = {
  capacity: 92,
  finance: 366,
  risk: 92,
  growth: 366,
  activity: 366,
  quality: 92,
  business: 92,
  // The pool is live; it takes no range.
  pool: 1,
}

export async function getInsights<V extends InsightsView>(
  view: V,
  range: InsightsRange,
  models: string[] = []
): Promise<InsightsByView[V]> {
  const res = await api.get<ApiResponse<InsightsByView[V]>>(
    `/api/site-insights/${view}`,
    {
      params: {
        ...range,
        ...(models.length > 0 && { models: models.join(',') }),
        // Minutes east of UTC, so days split at the viewer's midnight.
        tz_offset: -new Date().getTimezoneOffset(),
      },
    }
  )
  if (!res.data.success || res.data.data === undefined) {
    throw createServerError(res.data, 'Failed to load site insights')
  }
  return res.data.data
}

/** One provider's use on new-api and gpt-load, with a forecast. */
export async function getPoolUsage(provider: PoolProvider): Promise<PoolUsage> {
  const res = await api.get<ApiResponse<PoolUsage>>(
    '/api/site-insights/pool-usage',
    { params: { provider } }
  )
  if (!res.data.success || res.data.data === undefined) {
    throw createServerError(res.data, 'Failed to load site insights')
  }
  return res.data.data
}

type UserSearchPage = { items: { id: number; username: string }[] }

/** Resolves a user id or an exact username to a user id. */
export async function resolveUserId(input: string): Promise<number | null> {
  const value = input.trim()
  if (/^[1-9][0-9]*$/.test(value)) return Number(value)
  const res = await api.get<ApiResponse<UserSearchPage>>('/api/user/search', {
    params: { keyword: value, p: 1, page_size: 20 },
  })
  const match = res.data.data?.items.find((user) => user.username === value)
  return match ? match.id : null
}

/**
 * Saves the whole per-user concurrency map. The server replaces the stored
 * map, so a removed user is gone after the save.
 */
export async function saveUserConcurrencyLimits(
  limits: Record<string, number>
): Promise<void> {
  const res = await api.put<ApiResponse<unknown>>('/api/option/', {
    key: 'token_setting.user_concurrency_limits',
    value: JSON.stringify(limits),
  })
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save concurrency limits')
  }
}

export async function saveConcurrencyTiers(
  tiers: { min_paid: number; limit: number }[]
): Promise<void> {
  const res = await api.put<ApiResponse<unknown>>('/api/option/', {
    key: 'token_setting.concurrency_tiers',
    value: JSON.stringify(tiers),
  })
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save concurrency tiers')
  }
}
