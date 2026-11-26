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
  CampaignInsights,
  CapacityInsights,
  ChannelCost,
  IPCost,
  PaymentFeeRate,
  ChannelInsights,
  CustomerInsights,
  EngineOutlook,
  EnginePool,
  EngineResetResult,
  ExperienceInsights,
  FinanceInsights,
  GateInsights,
  GrowthInsights,
  InsightsRange,
  KeyInsights,
  ModelBehavior,
  PoolProvider,
  PoolUsage,
  QualityInsights,
  RiskInsights,
  UpstreamInsights,
  UpstreamRunway,
  UserSpend,
  UserSpendHours,
} from './types'

export type InsightsView =
  | 'capacity'
  | 'finance'
  | 'risk'
  | 'growth'
  | 'activity'
  | 'keys'
  | 'quality'
  | 'business'
  | 'pool'
  | 'channels'
  | 'upstream'
  | 'customers'
  | 'model-behavior'
  | 'experience'
  | 'campaigns'
  | 'gate'

export type InsightsByView = {
  capacity: CapacityInsights
  finance: FinanceInsights
  risk: RiskInsights
  growth: GrowthInsights
  activity: ActivityInsights
  keys: KeyInsights
  quality: QualityInsights
  business: BusinessInsights
  pool: EnginePool
  channels: ChannelInsights
  upstream: UpstreamInsights
  customers: CustomerInsights
  'model-behavior': ModelBehavior
  experience: ExperienceInsights
  campaigns: CampaignInsights
  gate: GateInsights
}

/** The longest range, in days, each view's endpoint accepts. */
export const VIEW_MAX_DAYS: Record<InsightsView, number> = {
  capacity: 92,
  finance: 366,
  risk: 92,
  growth: 366,
  activity: 366,
  keys: 92,
  quality: 92,
  business: 92,
  // The pool is live; it takes no range.
  pool: 1,
  channels: 366,
  upstream: 92,
  customers: 366,
  'model-behavior': 92,
  // Its logs reach back 30 days at most; the range may be longer.
  experience: 92,
  campaigns: 366,
  // The gate view scans request logs for a marker.
  gate: 14,
}

export async function getInsights<V extends InsightsView>(
  view: V,
  range: InsightsRange,
  models: string[] = [],
  vendor?: string
): Promise<InsightsByView[V]> {
  const res = await api.get<ApiResponse<InsightsByView[V]>>(
    `/api/site-insights/${view}`,
    {
      params: {
        ...range,
        ...(models.length > 0 && { models: models.join(',') }),
        ...(vendor && { vendor }),
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

/** Replaces the fees paid to promotion channels with costs. */
export async function saveChannelCosts(costs: ChannelCost[]) {
  const res = await api.put<ApiResponse<null>>(
    '/api/site-insights/channel-costs',
    { costs }
  )
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save channel costs')
  }
}

/** Replaces the recorded egress IP costs with costs. */
export async function saveIPCosts(costs: IPCost[]) {
  const res = await api.put<ApiResponse<null>>('/api/site-insights/ip-costs', {
    costs,
  })
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save IP costs')
  }
}

/** Replaces the accounts whose commission is not a cost. */
export async function saveCommissionExempt(userIDs: number[]) {
  const res = await api.put<ApiResponse<null>>(
    '/api/site-insights/commission-exempt',
    { user_ids: userIDs }
  )
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save commission exemptions')
  }
}

export async function savePaymentFeeRates(rates: PaymentFeeRate[]) {
  const res = await api.put<ApiResponse<null>>(
    '/api/site-insights/payment-fee-rates',
    { rates }
  )
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save payment fee rates')
  }
}

/**
 * How long each upstream account's balance lasts at the last seven days' pace.
 * It takes no range: balances are live and the window ends now.
 */
export async function getUpstreamRunway(): Promise<UpstreamRunway> {
  const res = await api.get<ApiResponse<UpstreamRunway>>(
    '/api/site-insights/upstream-runway'
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

/**
 * The Claude pool's quota over the next 5 hours, 24 hours and 7 days against
 * each demand forecast. The server shares one computation for 5 seconds.
 */
export async function getPoolOutlook(): Promise<EngineOutlook> {
  const res = await api.get<ApiResponse<EngineOutlook>>(
    '/api/site-insights/pool-outlook'
  )
  if (!res.data.success || res.data.data === undefined) {
    throw createServerError(res.data, 'Failed to load site insights')
  }
  return res.data.data
}

/**
 * Each customer's use over the last `hours`: new-api's charge and gpt-load's
 * cost shared out to them. The server shares one read a minute.
 */
export async function getUserSpend(hours: UserSpendHours): Promise<UserSpend> {
  const res = await api.get<ApiResponse<UserSpend>>(
    '/api/site-insights/user-spend',
    { params: { hours } }
  )
  if (!res.data.success || res.data.data === undefined) {
    throw createServerError(res.data, 'Failed to load site insights')
  }
  return res.data.data
}

/**
 * How a typical day's requests spread over its UTC hours: hours[h] is the
 * share that arrives in hour h. Empty when the server has no recent requests.
 */
export type DayProfile = { hours: number[]; days: number }

export async function getDayProfile(): Promise<DayProfile> {
  const res = await api.get<ApiResponse<DayProfile>>(
    '/api/site-insights/day-profile'
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

/**
 * Records in corecode-engine the billing date an operator read for one
 * provider organization, as YYYY-MM-DD; an empty date removes it.
 */
export async function saveSubscriptionRenewal(params: {
  organizationUUID: string
  renewsOn: string
  organizationName: string
}): Promise<void> {
  const res = await api.put<ApiResponse<unknown>>(
    `/api/site-insights/pool/subscription-renewals/${encodeURIComponent(params.organizationUUID)}`,
    { renews_on: params.renewsOn, organization_name: params.organizationName }
  )
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save the renewal date')
  }
}

/**
 * Sets an engine account's manual weight, 1 to 100, or clears it with null
 * so the account returns to the default of 50.
 */
export async function saveCredentialWeight(params: {
  groupId: number
  credentialId: number
  weight: number | null
}): Promise<void> {
  const res = await api.put<ApiResponse<unknown>>(
    `/api/site-insights/pool/groups/${params.groupId}/credentials/${params.credentialId}/weight`,
    { weight: params.weight }
  )
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save the schedule weight')
  }
}

/**
 * Redeems one quota reset credit of an engine account: of the kind given, or
 * the one the provider picks without a kind. A retry after an unknown outcome
 * must reuse the idempotency key so the engine answers for the same redemption.
 */
export async function consumeResetCredit(params: {
  groupId: number
  credentialId: number
  kind: 'full' | 'partial' | ''
  idempotencyKey: string
}): Promise<EngineResetResult> {
  const res = await api.post<ApiResponse<EngineResetResult>>(
    `/api/site-insights/pool/groups/${params.groupId}/credentials/${params.credentialId}/reset-credits`,
    { kind: params.kind, idempotency_key: params.idempotencyKey }
  )
  if (!res.data.success || res.data.data === undefined) {
    throw createServerError(res.data, 'The reset failed.')
  }
  return res.data.data
}

/**
 * Replaces the monthly fees of channels whose upstream bill is not read, by
 * channel id, in US dollars; a zero fee clears one.
 */
export async function saveUpstreamFees(fees: Record<number, number>) {
  const res = await api.put<ApiResponse<null>>(
    '/api/site-insights/upstream-fees',
    { fees }
  )
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to save upstream fees')
  }
}

/** The daily Feishu digest's settings as saved; the signing secret is never sent back. */
export type DigestSettings = { enabled: boolean; hour: string; webhook: string }

const DIGEST_OPTION = {
  enabled: 'site_insights_digest_setting.enabled',
  hour: 'site_insights_digest_setting.hour',
  webhook: 'site_insights_digest_setting.feishu_webhook',
  secret: 'site_insights_digest_setting.feishu_secret',
} as const

/** Reads the digest's settings from the options; off at 9 o'clock without any. */
export async function getDigestSettings(): Promise<DigestSettings> {
  const res =
    await api.get<ApiResponse<{ key: string; value: string }[]>>('/api/option/')
  if (!res.data.success || !res.data.data) {
    throw createServerError(res.data, 'Failed to load site insights')
  }
  const value = (key: string) =>
    res.data.data?.find((option) => option.key === key)?.value
  return {
    enabled: value(DIGEST_OPTION.enabled) === 'true',
    hour: value(DIGEST_OPTION.hour) || '9',
    webhook: value(DIGEST_OPTION.webhook) ?? '',
  }
}

/**
 * Saves the digest settings given, one option each, and stops at the first
 * the server refuses. A setting left out is not written.
 */
export async function saveDigestSettings(
  changes: Partial<DigestSettings & { secret: string }>
): Promise<void> {
  for (const name of ['webhook', 'secret', 'hour', 'enabled'] as const) {
    const value = changes[name]
    if (value === undefined) continue
    const res = await api.put<ApiResponse<unknown>>('/api/option/', {
      key: DIGEST_OPTION[name],
      value,
    })
    if (!res.data.success) {
      throw createServerError(res.data, 'Failed to update settings')
    }
  }
}

/** Sends yesterday's digest to the saved webhook now; it does not use up the day's send. */
export async function sendTestDigest(): Promise<void> {
  const res = await api.post<ApiResponse<unknown>>(
    '/api/option/site-insights-digest/feishu-test'
  )
  if (!res.data.success) {
    throw createServerError(res.data, 'Failed to send the test message')
  }
}
