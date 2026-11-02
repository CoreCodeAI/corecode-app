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
// Mirrors the Go types in model/site_insights*.go and
// controller/site_insights.go.

export type NamedCount = { name: string; count: number }
export type UserRef = { user_id: number; username: string }
export type CountPoint = { at: number; count: number }

export type CapacityHour = {
  hour: number
  requests: number
  errors: number
  peak_concurrency: number
  engine_rejections: number
  upstream_rate_limits: number
}

export type EngineAccount = {
  credential_id: number
  group_id: number
  group: string
  email_mask: string
  plan: string
  tier: string
  status: string
  /** Usage in percent. */
  five_hour: number
  seven_day: number
  five_hour_reset_ms: number
  seven_day_reset_ms: number
  cooldown_until_ms: number
  eligible: boolean
  active: number
  sessions: number
  observed_at_ms: number
  observation: string
  successes: number
  failures: number
  last_used_at_ms: number
  last_failure: string
  last_failure_at_ms: number
  five_hour_remaining_usd: number | null
  seven_day_remaining_usd: number | null
  burn_usd_per_hour: number | null
}

export type EngineGroup = {
  id: number
  name: string
  /** The engine channel, such as claude or codex; Claude groups come first. */
  channel: string
  enabled: boolean
  in_flight: number
  /** 0 means no group limit. */
  effective_limit: number
  override_limit: number | null
  accounts: number
  eligible: number
  slots: number
  counts: Record<string, number> | null
  quota_budget: boolean
  five_hour_budget: number
  seven_day_budget: number
}

export type EngineHorizon = {
  remaining_usd: number
  remaining_low_usd: number
  remaining_high_usd: number
  capacity_usd: number
  counted: number
  unknown: number
}

export type EnginePool = {
  configured: boolean
  error?: string
  observed_at_ms: number
  credential_concurrency: number
  five_hour_budget: number
  seven_day_budget: number
  eligible_accounts: number
  effective_slots: number
  in_flight: number
  groups: EngineGroup[]
  accounts: EngineAccount[]
  five_hour_estimate: EngineHorizon | null
  week_estimate: EngineHorizon | null
  refills: { credential_id: number; at_ms: number; adds_usd: number }[]
  /** Absent before the server's release, null without an estimate. */
  runway?: EngineRunway | null
  estimate_error?: string
}

/** One channel's quota supply against the last 24 hours' demand. */
export type EngineRunway = {
  channel: string
  burn_usd_per_hour: number
  /** Used since each account's weekly reset, per hour: a check on burn. */
  week_to_date_usd_per_hour: number
  /** What the weekly resets bring back per hour. */
  sustainable_usd_per_hour: number
  /** The most fresh 5-hour windows serve in an hour. */
  peak_usd_per_hour: number
  week_remaining_usd: number
  week_capacity_usd: number
  /** Demand over sustainable supply; under 1 the pool keeps up. */
  week_load: number
  /** Over horizon_hours: hours with no quota, and the share served. */
  short_hours: number
  served_share: number
  horizon_hours: number
  /** The least quota left over the horizon, and when. */
  lowest_usd: number
  lowest_hours: number
  /** When the first gap starts and how long it lasts; null without one. */
  week_hours: number | null
  first_short_hours: number | null
  counted: number
  unknown: number
  /** Quota left at each whole hour from now through the horizon. */
  curve?: number[] | null
  /** Hours of use the daily shape is drawn from; 0 projects demand flat. */
  profile_hours?: number
  peak_hour_usd_per_hour?: number
  growth_per_day?: number
  /** The largest multiple of demand served for 7 days without a gap. */
  headroom_scale?: number | null
  /** Demand growing on, and the 10th and 90th percentile demand. */
  trend?: EngineRunwayScenario | null
  low?: EngineRunwayScenario | null
  high?: EngineRunwayScenario | null
  band_forecasts?: number
}

export type EngineRunwayScenario = {
  demand_scale: number
  short_hours: number
  served_share: number
  week_hours: number | null
  first_short_hours: number | null
  curve: number[] | null
}

export type CapacityInsights = {
  requests: number
  errors: number
  peak_concurrency: number
  peak_at: number
  peak_rpm: number
  peak_rpm_at: number
  error_categories: NamedCount[]
  hourly: CapacityHour[]
  user_peaks: (UserRef & { peak: number; peak_at: number; requests: number })[]
  truncated: boolean
  in_flight: number
  in_flight_users: (UserRef & {
    in_flight: number
    limit: number
    limit_source: 'user' | 'tier' | 'group'
  })[]
  user_limits: (UserRef & {
    group: string
    limit: number
    group_limit: number
    in_flight: number
  })[]
  limit_rejections: CountPoint[]
  limit_rejection_total: number
  limit_rejected_users: (UserRef & { count: number })[] | null
  concurrency_limits: Record<string, number> | null
  concurrency_tiers: { min_paid: number; limit: number }[] | null
  pool: EnginePool
}

export type BalanceUser = UserRef & { balance_usd: number }

export type FinanceInsights = {
  revenue: number
  topup_revenue: number
  subscription_revenue: number
  orders: number
  paying_users: number
  methods: { payment_method: string; money: number; count: number }[] | null
  daily: {
    day: number
    topup: number
    subscription: number
    consumption_usd: number
    recognized_revenue?: number
    claude_usd: number
    /** Root's own consumption; absent before the server's release. */
    root_consumption_usd?: number
    /** The day's charge by vendor; absent before the server's release. */
    vendor_usd?: Record<string, number>
  }[]
  /** Customers only; root's own requests are root_consumption_usd. */
  consumption_usd: number
  root_consumption_usd?: number
  gift_consumption_usd?: number
  claude_usd: number
  revenue_per_usd: number
  recognized_revenue?: number
  recognized_wallet_revenue?: number
  recognized_subscription_revenue?: number
  recognized_per_usd?: number
  liability_usd: number
  liability_paid_value?: number
  liability_users: number
  debt_usd: number
  debtors: BalanceUser[]
  top_balances: BalanceUser[]
  adjustments: {
    created_at: number
    operator: string
    target: UserRef
    mode: string
    request_usd: number
    before_usd: number
    after_usd: number
    delta_usd: number
    success: boolean
    has_snapshot: boolean
  }[]
  adjustment_net_usd: number
  commission_usd: number
  redemption_usd: number
  engine_cost: EngineDailyCost
  /** Both sides over the days the engine reported. */
  matched_official_usd: number
  matched_claude_usd: number
  /** Official-price cost of one dollar new-api charged for Claude. */
  official_per_usd: number
  plans: EnginePlanValue[]
  plans_error?: string
  /** Every pool account by plan; absent before the server's release. */
  plan_accounts?: EnginePlanCount[]
  /** new-api's charge by model, root included, largest first. */
  vendor_models?: VendorModel[]
  start_time?: number
  end_time?: number
  /** Where the days the engine reported begin within the range. */
  matched_since?: number
  /** Yuan per US dollar; new-api's charges are in yuan (useChargeFormat). */
  usd_exchange_rate?: number
  bonus_usd: number
  topup_credit_usd: number
}

export type RiskInsights = {
  signups: number
  signup_series: CountPoint[]
  series_unit: 'hour' | 'day'
  peak_signups: CountPoint
  signup_methods: NamedCount[]
  email_domains:
    | { domain: string; count: number; whitelisted: boolean }[]
    | null
  alias_emails: number
  off_whitelist: number
  zero_use_accounts: number
  shared_ips: {
    ip: string
    requests: number
    subscription_buyers: number
    users: (UserRef & {
      requests: number
      paid: boolean
      subscription: boolean
      created_at: number
      balance_usd: number
    })[]
  }[]
  debtors: BalanceUser[]
}

export type FunnelRow = {
  segment: string
  registered: number
  activated: number
  paid: number
  repeat: number
}

export type GrowthInsights = {
  funnel: FunnelRow
  by_source: FunnelRow[] | null
  by_invite: FunnelRow[]
  daily: { day: number; registered: number; activated: number; paid: number }[]
  subscription_buyers: number
  subscription_to_topup: number
}

/** What one plan's accounts serve in a full week at official prices. */
export type EnginePlanValue = {
  plan: string
  tier: string
  accounts: number
  measured: number
  week_usd: number
  week_low_usd: number
  week_high_usd: number
}

/** What new-api charged for one model over the range. */
export type VendorModel = {
  vendor: string
  model: string
  usd: number
  requests: number
}

/** How many pool accounts hold one plan and tier, whatever their status. */
export type EnginePlanCount = {
  plan: string
  tier: string
  accounts: number
  eligible: number
}

/** Claude's cost at official prices, as corecode-engine recorded it. */
export type EngineDailyCost = {
  configured: boolean
  error?: string
  cost_usd: number
  requests: number
  daily: { day: number; cost_usd: number; requests: number }[]
}

export type ActivityInsights = {
  active_users: number
  quota_usd: number
  requests: number
  engine_cost: EngineDailyCost
  daily: {
    day: number
    dau: number
    wau: number
    requests: number
    quota_usd: number
  }[]
  retention: { day: number; size: number; days: number[] | null }[]
  top_users: (UserRef & {
    quota_usd: number
    requests: number
    share: number
  })[]
  top1_share: number
  top3_share: number
  top10_share: number
}

export type QualityInsights = {
  requests: number
  errors: number
  error_rate: number
  ttft_p50_ms: number
  ttft_p95_ms: number
  cache_share: number
  models:
    | {
        model: string
        requests: number
        errors: number
        error_rate: number
        ttft_p50_ms: number
        ttft_p95_ms: number
        latency_p50_s: number
        latency_p95_s: number
        cache_share: number
      }[]
    | null
  daily: {
    day: number
    read: number
    write: number
    uncached: number
    read_share: number
    ttft_p50_ms: number
    error_rate: number
    requests: number
    errors: number
  }[]
  stream_ends: NamedCount[]
  status_codes: NamedCount[]
  error_reasons: NamedCount[]
  truncated: boolean
}

export type BusinessInsights = {
  inviters: number
  invitees: number
  invitee_spend_usd: number
  invitee_payments: number
  commission_usd: number
  commission_to_spend: number
  top_inviters: (UserRef & {
    invitees: number
    active_invitees: number
    spend_usd: number
    payments: number
    commission_usd: number
  })[]
  models:
    | {
        model: string
        quota_usd: number
        share: number
        requests: number
        users: number
        per_request_usd: number
        revenue_estimate: number
        cache_share: number
      }[]
    | null
  revenue: number
  groups: NamedCount[]
  clients: NamedCount[]
  clients_truncated: boolean
}

export type InsightsRange = { start_time: number; end_time: number }
