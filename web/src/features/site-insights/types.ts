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

/**
 * Why a failed request failed, as the rollup files it. engine_concurrency,
 * engine_limit and engine_budget are the pool engine's own 429s (a
 * credential's concurrency; a group, global or key cap or the access key's
 * rate; a credential's request rate, quota budget or a missing quota
 * observation); upstream_rate_limit is every other 429. upstream_auth is a
 * 401, 402 or 403 the upstream returned, a channel fault. no_channel is a
 * customer request no channel of their group serves. A server may send a
 * name not listed here; it reads as its raw name.
 */
export type ErrorCategory =
  | 'engine_concurrency'
  | 'engine_limit'
  | 'engine_budget'
  | 'upstream_rate_limit'
  | 'upstream_overloaded'
  | 'upstream_auth'
  | 'upstream_error'
  | 'client_error'
  | 'no_channel'
  | 'other'

/**
 * How the async tasks (images, video) submitted in the range stand now.
 * Every user's tasks, root included. failed includes timed_out; running is
 * any task not yet succeeded or failed, stalled those of them submitted 30
 * minutes or more before now. failure_rate = failed / (succeeded + failed),
 * 0..1. finish_*_s: seconds from submission to finish, successes only.
 * reasons: the five most common failure reasons.
 */
export type TaskOutcome = {
  /** Set on a per-model row; absent on the total and channel rows. */
  model?: string
  /** Set on a per-channel row; absent on the total and model rows. */
  channel_id?: number
  submitted: number
  succeeded: number
  failed: number
  timed_out: number
  running: number
  stalled: number
  failure_rate: number
  finish_p50_s: number
  finish_p95_s: number
  reasons: NamedCount[] | null
}

/**
 * The quality view's tasks: tasks-table rows submitted in [start, end), at
 * most 50,000, earliest first (truncated when cut). The model filter does
 * not narrow it. Lists are by submitted, largest first.
 */
export type TaskOutcomes = {
  total: TaskOutcome
  models: TaskOutcome[] | null
  channels: TaskOutcome[] | null
  truncated: boolean
}

/** Tasks submitted on a channel in one day or hour, by how they stand now; absent when 0. */
export type UpstreamTaskCounts = {
  task_submitted?: number
  task_succeeded?: number
  task_failed?: number
  task_running?: number
}

/**
 * Requests turned away before any channel was tried. no_channel: customers'
 * (not root's or staff's) requests no channel of their group serves; they are
 * also in requests, errors and error_categories. risk_gate: requests the risk gate
 * blocked (observe-mode hits excluded), every user; they are not in
 * requests. risk_gate_stages: risk_gate by stage, largest first.
 */
export type QualityRefusals = {
  no_channel: number
  risk_gate: number
  risk_gate_stages: NamedCount[] | null
}

/**
 * Hourly series for ranges of 3 days or less. hour is the UTC hour start, as
 * CapacityHour.hour; each series has every hour of the range, zero-filled,
 * oldest first, except UpstreamHour (one row per hour and channel with
 * traffic or cost).
 */
export type QualityHour = {
  hour: number
  requests: number
  errors: number
  error_rate: number
  ttft_p50_ms: number
  ttft_p95_ms: number
}

/** Charges as FinanceInsights.daily's fields of the same names. */
export type FinanceHour = {
  hour: number
  topup: number
  subscription: number
  consumption_usd: number
  root_consumption_usd: number
}

export type ActivityHour = {
  hour: number
  active_users: number
  requests: number
  /** Quota dollars, which customers pay ¥1 each for, so yuan. */
  quota_usd: number
}

/** By sign-up hour, as GrowthInsights.daily. */
export type GrowthHour = {
  hour: number
  registered: number
  activated: number
  paid: number
}

export type UpstreamHour = UpstreamTaskCounts & {
  hour: number
  channel_id: number
  requests: number
  errors: number
  /** Failed attempts the client caused: 4xx but 401, 402, 403, 404 and 408 (429 never). Hours stored before the server's release read 0 until rebuilt; absent before it. */
  client_errors?: number
  revenue_usd: number
  cost_usd: number
}

export type CapacityHour = {
  hour: number
  requests: number
  errors: number
  /** The site's peak: requests in flight at once on every channel. */
  peak_concurrency: number
  /** The pool's peak: successful requests in flight at once through engine channels only. Planned for rollup version 5; not sent yet. */
  pool_peak?: number
  engine_rejections: number
  upstream_rate_limits: number
}

export type EngineQuotaWindow = {
  id: string
  label: string
  scope: string
  /** Provider usage as a ratio; null is unknown, zero is unused. */
  utilization: number | null
  reset_at_ms: number | null
  observed_at_ms: number | null
  state: string
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
  /** Provider-reported windows; absent before the server's release. */
  quota_windows?: EngineQuotaWindow[]
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
  /** What a full week of the account serves at official prices, as the engine calibrated it; absent before the server's release. */
  seven_day_capacity_usd?: number | null
  /** Weekly quota projected unused at the reset if the last 24 hours' spend rate holds; absent or null without a projection. */
  seven_day_unused_usd?: number | null
  /** The provider organization; seats of one team share it. Absent before the server's release. */
  organization?: string
  /** Keys the renewal date an operator enters for the organization. */
  organization_uuid?: string
  /** The provider's word for the subscription, such as active. */
  subscription_status?: string
  /** confirmed when the provider reported the renewal or an operator entered it, estimated when the engine counted it. */
  subscription_state?: string
  /** When the subscription next renews; 0 or absent without a date. */
  subscription_period_end_ms?: number
  /** Usable quota reset credits, one entry per credit; absent from an engine before them. */
  reset_credits?: EngineResetCredit[]
}

/**
 * One quota reset credit. A full Claude credit also clears the overall weekly
 * limit; a partial one clears the 5-hour and a model's weekly limit only. The
 * kind is empty when the provider does not say.
 */
export type EngineResetCredit = {
  expires_at_ms?: number | null
  kind?: 'full' | 'partial' | ''
}

export type EngineResetResult = {
  status: string
  windows_reset: number
  observation_pending: boolean
  replayed: boolean
}

export type EngineGroup = {
  id: number
  name: string
  /** The engine channel, such as claude or codex; Claude groups come first. */
  channel: string
  /** The vendor new-api sells the channel under; absent before the server's release. */
  provider?: string
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
  /** Weekly quota the counted accounts will not spend before their resets; absent or null before the engine's projection. */
  week_unused?: { usd: number; counted: number } | null
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
  /** Demand against drawable quota over a window; absent before the server's release. */
  supply_windows?: EngineRunwaySupply[] | null
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
  /** The trend's demand averaged over the next week. */
  expected_usd_per_hour?: number
  /** The largest multiple of demand served for 7 days without a gap. */
  headroom_scale?: number | null
  /** Demand growing on, and the 10th and 90th percentile demand. */
  trend?: EngineRunwayScenario | null
  low?: EngineRunwayScenario | null
  high?: EngineRunwayScenario | null
  band_forecasts?: number
  /** Accounts of one plan that would close the gap; absent before the server's release. */
  addition?: EngineRunwayAddition | null
  /** Each Team tier sized the same way, Team Tier 1 first; absent before the server's release. */
  additions?: EngineRunwayAddition[] | null
}

/** One window of the projection: its demand, what it can draw on, and what
 * it leaves unserved. supply_usd is week_remaining_usd plus the quota the
 * weekly resets inside the window bring back. */
export type EngineRunwaySupply = {
  hours: number
  demand_usd: number
  refill_usd: number
  supply_usd: number
  short_usd: number
}

export type EngineRunwayScenario = {
  demand_scale: number
  short_hours: number
  served_share: number
  week_hours: number | null
  first_short_hours: number | null
  curve: number[] | null
}

/** How many accounts of one plan the Claude pool needs added. */
export type EngineRunwayAddition = {
  plan: string
  tier: string
  /** One account's weekly capacity up to its budget line. */
  week_usd: number
  budget_percent: number
  measured: number
  /**
   * Accounts for a weekly load of 100% at the expected demand (the trend
   * averaged over the next week), and at the band's ends of it. Absent from
   * servers before the expected demand.
   */
  for_expected?: number
  for_low?: number | null
  for_high?: number | null
  /** Accounts for a weekly load of 100% now, and at the trend's demand in 7 days. */
  for_load: number
  for_trend: number
  /** Accounts for no gap in the next 7 days as demand follows the trend; null when even 30 do not. */
  for_week: number | null
}

/** The vendors the pool tab switches between, Claude first. */
/** The windows the outlook reports, in hours. */
export const OUTLOOK_WINDOWS = [5, 24, 168] as const
export type OutlookWindowHours = (typeof OUTLOOK_WINDOWS)[number]

/** The demand forecasts the outlook runs the pool under. */
export const OUTLOOK_MODELS = [
  'linear_1h',
  'linear_12h',
  'linear_24h',
  'history',
  'smart',
] as const
export type OutlookModelId = (typeof OUTLOOK_MODELS)[number]

/**
 * The Claude pool's quota over the next 5 hours, 24 hours and 7 days: what
 * the accounts hold, what their resets bring back, and whether that meets
 * demand under each forecast. Dollars are the pool estimate's.
 */
export type EngineOutlook = {
  configured: boolean
  error?: string
  channel: string
  observed_at_ms: number
  counted: number
  unknown: number
  week_capacity_usd: number
  five_hour_capacity_usd: number
  /** What the weekly resets bring back per hour. */
  sustainable_usd_per_hour: number
  /** The most fresh 5-hour windows serve in an hour. */
  peak_usd_per_hour: number
  /** One entry per window, shortest first. */
  remaining: EngineOutlookRemaining[]
  resets: EngineOutlookReset[]
  /** Hours from now of each curve point. */
  sample_hours: number[]
  models: EngineOutlookModel[]
  growth_per_day: number
  /** The multiple the latest hours put on the smart model's level now. */
  momentum: number
  band_forecasts: number
  history_hours: number
  /** Set when gpt-load's recent spend could not be read. */
  usage_error?: string
}

/** The most the pool can spend within a window, whatever the demand. */
export type EngineOutlookRemaining = {
  hours: number
  /** Counting no reset of a window as long as this one or longer. */
  on_hand_usd: number
  five_hour_refill_usd: number
  week_refill_usd: number
  with_resets_usd: number
}

export type EngineOutlookReset = {
  credential_id: number
  email_mask: string
  window: 'five_hour' | 'seven_day'
  at_ms: number
  /** What the reset adds if the account spends nothing more before it. */
  adds_usd: number
}

export type EngineOutlookWindow = {
  hours: number
  demand_usd: number
  served_usd: number
  short_usd: number
  short_hours: number
  first_short_hours: number | null
  /** The least the pool could spend at once in the window, and when. */
  lowest_usd: number
  lowest_hours: number
}

export type EngineOutlookBand = {
  scale: number
  windows: EngineOutlookWindow[]
  drawable: number[]
  week_left: number[]
}

export type EngineOutlookAddition = {
  plan: string
  tier: string
  week_usd: number
  five_hour_usd: number
  measured: number
  /** Accounts for a weekly load of 100% at the model's average demand. */
  keep_up: number
  /** Accounts for no unserved demand in 7 days; null above the search. */
  cover_week: number | null
}

/** One demand forecast and the pool run forward under it. */
export type EngineOutlookModel = {
  id: OutlookModelId
  /** False when the model's input could not be read. */
  available: boolean
  rate_usd_per_hour: number
  average_usd_per_hour: number
  peak_usd_per_hour: number
  week_load: number
  windows: EngineOutlookWindow[]
  /** One value per sample: spendable at once, weekly quota left, $/h. */
  drawable: number[]
  week_left: number[]
  demand: number[]
  low: EngineOutlookBand | null
  high: EngineOutlookBand | null
  additions: EngineOutlookAddition[]
}

export const POOL_PROVIDERS = ['claude', 'codex', 'grok', 'gemini'] as const
export type PoolProvider = (typeof POOL_PROVIDERS)[number]

/**
 * One provider's use on both sides. quota is new-api's charge in quota
 * dollars, which customers pay ¥1 each for, so yuan; engine_usd is
 * gpt-load's spend at official prices, the unit the pool's capacity is in.
 */
export type PoolUsage = {
  provider: PoolProvider
  observed_at: number
  usd_exchange_rate: number
  channels: string[]
  engine_configured: boolean
  engine_error?: string
  windows: {
    hours: number
    quota: number
    engine_usd: number
    engine_requests: number
    engine_unpriced: number
  }[]
  /** gpt-load dollars per new-api yuan over the last week; 0 without both. */
  official_per_quota: number
  /** The last 48 clock hours, the last one open. */
  hourly: { hour: number; quota: number; engine_usd: number }[]
  forecast: {
    next_5h_usd: number
    next_24h_usd: number
    next_24h_trend_usd: number
    next_24h_low_usd: number | null
    next_24h_high_usd: number | null
    next_5h_quota: number
    next_24h_quota: number
    profile_hours: number
    growth_per_day: number
    band_forecasts: number
  }
}

/**
 * How many of a view's stored hours are still on the rollup's earlier
 * definition, being rebuilt while their logs last. Planned with rollup
 * version 5; absent until then, and absent means none.
 */
export type StaleHours = { stale_hours?: number }

/**
 * The earliest request log the rollups read, unix seconds, on every
 * hour-based view. An hour or day that ends before it has no data, not zero.
 * 0 means there are no logs; absent before the server's release.
 */
export type LogsSince = { logs_since?: number | null }

export type CapacityInsights = StaleHours & {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
  /** Customers' requests (root and staff left out). */
  requests: number
  errors: number
  /** The site's peak: requests in flight at once on every channel. */
  peak_concurrency: number
  peak_at: number
  /** The pool's peak: successful requests in flight at once through engine channels only, unix seconds for its time. Planned for rollup version 5; not sent yet. */
  pool_peak?: number
  pool_peak_at?: number
  /** Every try, a retry on another channel included, and the tries that failed. Planned for rollup version 5; not sent yet. */
  attempts?: number
  attempt_errors?: number
  peak_rpm: number
  peak_rpm_at: number
  /** Names are ErrorCategory values. */
  error_categories: NamedCount[]
  hourly: CapacityHour[]
  user_peaks: (UserRef & {
    peak: number
    peak_at: number
    requests: number
  })[]
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

/**
 * What running plans owe now: plans with status active and start <= now <
 * end, root's and staff's left out. A point in time: never compare it with the previous
 * period. at: unix seconds (now). deferred_value, in the payment currency
 * (yuan): each paid (order or balance) plan's matched price times the share
 * of its time not yet run; a balance plan is valued at the wallet price as
 * of the range's end. unmatched: running paid plans with no order found
 * (they add 0). *_quota_left_usd: quota dollars left on never-resetting
 * plans with a total; *_period_left_usd: this period's remainder on
 * resetting plans.
 */
export type PlanLiability = {
  at: number
  deferred_value: number
  paid_plans: number
  paid_users: number
  unmatched: number
  gift_plans: number
  unlimited: number
  paid_quota_left_usd: number
  gift_quota_left_usd: number
  paid_period_left_usd: number
  gift_period_left_usd: number
}

/**
 * One plan's movement, running plans first. As of now: running_*,
 * expiring_7d*, deferred_value. Over the range: sold (paid plans started in
 * it), renewed (part of sold whose buyer held the same plan ending no more
 * than 7 days before), gifted (admin or affiliate gift plans started in it),
 * expired (paid plans that ended in it, cancelled included).
 * finished_used_share (0..1): quota used over quota granted by the paid,
 * never-resetting plans with a total that ended in the range (finished_plans
 * of them; 0 with none). price, sold_value, expiring_7d_value and
 * deferred_value are in the payment currency (yuan).
 */
export type PlanBookRow = {
  plan_id: number
  title: string
  price: number
  one_per_user: boolean
  running_paid: number
  running_gifted: number
  sold: number
  sold_value: number
  renewed: number
  gifted: number
  expired: number
  expiring_7d: number
  expiring_7d_value: number
  deferred_value: number
  finished_plans: number
  finished_used_share: number
}

/**
 * Checkouts opened in the range with one payment method, by created desc:
 * top-ups and plan orders (a plan order's top-up twin skipped), wallet-paid
 * ones left out. completion_rate = paid / created, 0..1. pending_stale:
 * pending and opened more than an hour before now. paid_money is in the
 * payment currency (yuan).
 */
export type OrderMethodFunnel = {
  payment_method: string
  created: number
  paid: number
  failed: number
  expired: number
  pending: number
  pending_stale: number
  plan_orders: number
  paid_money: number
  completion_rate: number
}

/**
 * What the billed upstream channels serving one vendor cost over the range,
 * sorted by bill plus fee, largest first. bill_usd: the upstreams' bills in
 * each upstream's quota dollars, compared with revenue one for one. fee_usd:
 * monthly fees over the range, real US dollars. costed_revenue_usd /
 * uncosted_revenue_usd: customers' charge (quota dollars) on channels with
 * a bill or fee / with neither, such as the pool's. oldest_bill_at: unix
 * seconds of the oldest newest bill among its channels, 0 with none:
 * revenue after it is not costed yet. channels: the costed channel ids.
 */
export type VendorUpstreamCost = {
  vendor: string
  bill_usd: number
  fee_usd: number
  costed_revenue_usd: number
  uncosted_revenue_usd: number
  oldest_bill_at: number
  channels: number[] | null
}

/**
 * Customers' use in one billing group (root and staff left out), by consumption
 * desc. group "" means not recorded. tokens: used plus cache read and write.
 * consumption_usd: quota dollars after the group's ratio; list_usd the same
 * over today's ratio (0 with no ratio); ratio: today's group ratio (0 with
 * none). share: 0..1 of consumption. revenue_estimate: recognized revenue
 * times share, in the payment currency (yuan).
 */
export type GroupConsumption = {
  group: string
  requests: number
  users: number
  tokens: number
  consumption_usd: number
  share: number
  ratio: number
  list_usd: number
  revenue_estimate: number
}

export type FinanceInsights = StaleHours & {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
  /** An hour of the range was cut by its row cap, so its revenue and consumption may be short; absent before the server's release. */
  truncated?: boolean
  /** Money paid in the range, yuan. revenue, the top-up and plan parts, methods, daily and hourly count an order when it was paid (its create time on servers that did not record that). */
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
  /** Whether any quota adjustment log exists in the range; absent before the server's release. */
  adjustment_logs_found?: boolean
  /** Every manual adjustment in the range, listed or not; adjustments_truncated when the list above is cut to the newest 500. Absent before the server's release. */
  adjustments_total?: number
  adjustments_truncated?: boolean
  /** Customers' consumption that was not gifted credit over the range, quota dollars, and that over range_days. Absent before the server's release. */
  paid_use_usd?: number
  range_days?: number
  paid_use_per_day_usd?: number
  /** Paid plans' quota left now, quota dollars; with paid_use_per_day_usd and the paid balances, the runway. Absent before the server's release. */
  paid_plan_quota_left_usd?: number
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
  /** Revenue earned by vendor, root and staff left out; absent before the server's release. */
  vendor_revenue?: {
    vendor: string
    customer_usd: number
    share: number
    recognized_revenue: number
  }[]
  start_time?: number
  end_time?: number
  /** Where the days the engine reported begin within the range. */
  matched_since?: number
  /** Yuan per US dollar; new-api's charges are in yuan (useChargeFormat). */
  usd_exchange_rate?: number
  bonus_usd: number
  topup_credit_usd: number
  /** Ranges of 3 days or less; absent before the server's release. */
  hourly?: FinanceHour[] | null
  /** When the plan_accounts pool snapshot was taken, unix ms; 0 without an engine report. No pool history exists. Absent before the server's release. */
  plan_accounts_observed_at_ms?: number
  /** Credit check-ins awarded in the range, quota dollars (exact). Absent before the server's release. */
  checkin_credit_usd?: number
  /** Sign-up and invitee bonuses logged in the range, counts. Absent before the server's release. */
  signup_bonuses?: number
  invitee_bonuses?: number
  /** Those counts times today's QuotaForNewUser / QuotaForInvitee, quota dollars: estimates. Absent before the server's release. */
  signup_credit_estimate_usd?: number
  invitee_credit_estimate_usd?: number
  /** Absent before the server's release. */
  plan_liability?: PlanLiability | null
  plan_book?: PlanBookRow[] | null
  order_methods?: OrderMethodFunnel[] | null
  vendor_upstream?: VendorUpstreamCost[] | null
  /** Cost on billed channels with no customer revenue in the range: bills in upstream quota dollars, fees in real US dollars. Absent before the server's release. */
  upstream_unattributed_bill_usd?: number
  upstream_unattributed_fee_usd?: number
  groups?: GroupConsumption[] | null
}

/** A sign-up of the range that consumed and never paid (no successful top-up with money > 0 off the wallet, ever). Quota dollars. */
export type UnpaidSpender = UserRef & {
  /** Consumption in the range. */
  consumption_usd: number
  /** The part given plans covered. */
  gift_plan_usd: number
  /** The rest of consumption, by source: credit an administrator granted by hand, redemption codes used, and the sign-up and invite gifts left. Absent before the server's release; with gift_plan_usd they sum to consumption_usd. */
  granted_usd?: number
  redeemed_usd?: number
  signup_gift_usd?: number
  /** Check-in rewards used: wallet credit that is no gift of an inviter's. Absent before the server's release, where it is inside signup_gift_usd. */
  checkin_usd?: number
  signup_method: string
  /** user_id 0 without an inviter. */
  inviter: UserRef
  created_at: number
}

/** A shared address; shared_exit says whether it is an exit (listed in shared_exit_top). */
export type SharedIP = {
  ip: string
  /** Requests from consume and error logs only; sign-ins, sessions and orders add 0. */
  requests: number
  /** Members who bought a one-per-user plan (order or balance) within 30 days of the range's end; older servers counted any plan ever bought. */
  subscription_buyers: number
  /** Members created in the range; absent before the server's release. */
  new_members?: number
  /** A shared exit at min(end, now), by the purchase check's rule: 20+ requesters in 7 days or 5+ members in 30 days who bought no one-per-user plan. Absent before the server's release. */
  shared_exit?: boolean
  users: (UserRef & {
    requests: number
    /** A real top-up (money > 0 and amount > 0); a plan order's mirror row no longer counts. */
    paid: boolean
    subscription: boolean
    /** Counts in subscription_buyers; absent before the server's release. */
    limited_plan?: boolean
    created_at: number
    balance_usd: number
  })[]
}

export type RiskInsights = StaleHours & {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
  /** Sign-ups in the range, root and staff left out, soft-deleted accounts included (older servers: deleted left out, root counted). */
  signups: number
  signup_series: CountPoint[]
  series_unit: 'hour' | 'day'
  peak_signups: CountPoint
  signup_methods: NamedCount[]
  email_domains:
    | { domain: string; count: number; whitelisted: boolean }[]
    | null
  /** Sign-ups whose canonical inbox (lower case, no +tag, Gmail dots dropped) another account of any time also has. Older servers counted the address pattern instead (now alias_pattern_emails). */
  alias_emails: number
  /** Email sign-ups off the allowlist; 0 while the restriction is off or the list empty. */
  off_whitelist: number
  /** Sign-ups with no successful request. */
  zero_use_accounts: number
  /** Review addresses only (not exits), ranked before the cut to 50: then subscription_buyers, new_members, members, requests, ip. */
  shared_ips: SharedIP[]
  /** All time and now, not the range. */
  debtors: BalanceUser[]
  /** Sign-ups created at least 6 hours before the range's end; absent before the server's release. */
  signups_mature?: number
  /** Those of signups_mature with no request; absent before the server's release. */
  zero_use_mature?: number
  /** Fields below are absent before the server's release. Sign-ups in the range deleted since. */
  deleted_signups?: number
  /** Sign-ups whose address has a +tag or a dotted Gmail local part (the old alias_emails). */
  alias_pattern_emails?: number
  /** Groups of 2+ accounts sharing a canonical inbox, one at least signed up in the range; by size, then canonical; at most 20. */
  alias_clusters?: { canonical: string; users: UserRef[] }[] | null
  /** The EmailDomainRestrictionEnabled setting now. */
  email_restriction?: boolean
  /** Shared addresses before the cut to 50, and how many of them are shared exits. */
  shared_ip_total?: number
  shared_exits?: number
  /** zero_use_accounts with one or more error logs in the range; _mature: of signups_mature. */
  zero_use_failed?: number
  zero_use_failed_mature?: number
  /** Sign-ups that consumed in the range, from the user-hour rollup. */
  signup_spenders?: number
  /** Of signup_spenders, those that never paid, and their consumption in quota dollars. */
  unpaid_spenders?: number
  unpaid_spend_usd?: number
  /** unpaid_spend_usd by source: hand-granted credit, redemption codes, gift plans and the sign-up and invite gifts. They sum to unpaid_spend_usd. Absent before the server's release. */
  unpaid_granted_usd?: number
  unpaid_redeemed_usd?: number
  unpaid_gift_plan_usd?: number
  unpaid_signup_gift_usd?: number
  /** The check-in rewards in unpaid_spend_usd; with the four parts above it sums to unpaid_spend_usd. */
  unpaid_checkin_usd?: number
  /** Unpaid spenders whose hand-granted part is over half their consumption. */
  unpaid_hand_funded?: number
  /** The largest 10 by consumption. */
  unpaid_spender_top?: UnpaidSpender[] | null
  /** The shared exits, ranked as the clusters are, at most 20; shared_exits counts all of them. Absent before the server's release; read this for exits, not shared_ips. */
  shared_exit_top?: SharedIP[] | null
  /** Top 10 inviters of unpaid spenders, by gift_usd: the gift plan and sign-up gift parts of their invitees' consumption (quota dollars). Absent before the server's release, where the list is by accounts then consumption. */
  unpaid_inviters?:
    | (UserRef & {
        accounts: number
        /** Invitees with gift credit (a gift plan or sign-up gift), of accounts; absent on servers before gift_accounts, where accounts stands in. */
        gift_accounts?: number | null
        consumption_usd: number
        gift_usd?: number
      })[]
    | null
  /** Invite sign-up gift rows created in the range by status (gifted, ip_used, cap_reached, email_blocked, email_signup...), count desc. */
  signup_gifts?: NamedCount[] | null
  /** Top 10 inviters by blocked (ip_used, cap_reached, email_blocked; email_signup is not a block), then gifted. */
  gift_block_inviters?: (UserRef & { blocked: number; gifted: number })[] | null
}

export type FunnelRow = {
  segment: string
  registered: number
  activated: number
  paid: number
  repeat: number
}

export type PaymentTiming = {
  payers: number
  /** The median time from sign-up to first payment, in hours. */
  median_hours: number
  /** Shares of payers, 0..1: paid within a day, and within a week. */
  within_day: number
  within_week: number
  same_day: number
  days_1_3: number
  days_4_7: number
  later: number
}

/** Accounts that paid before the range's end: active used quota in the range's last 14 days, lapsed used it in the 14 days before and none since. */
export type PayerActivity = {
  payers: number
  active: number
  lapsed: number
  top: (UserRef & { quota_usd: number })[] | null
}

export type GrowthInsights = {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
  funnel: FunnelRow
  by_source: FunnelRow[] | null
  by_invite: FunnelRow[]
  daily: { day: number; registered: number; activated: number; paid: number }[]
  subscription_buyers: number
  subscription_to_topup: number
  /** Ranges of 3 days or less; absent before the server's release. */
  hourly?: GrowthHour[] | null
  /** The cohort's payers' time from sign-up to first payment; absent before the server's release. */
  first_payment?: PaymentTiming | null
  /** Accounts that paid before the range's end, by recent use; absent before the server's release. */
  payer_activity?: PayerActivity | null
}

/** A fee paid to a promotion channel: monthly_usd every 30 days from start until end, or until now when end is 0. Unix seconds. */
export type ChannelCost = {
  user_id: number
  monthly_usd: number
  start: number
  end: number
  note: string
}

/**
 * One acquisition source over the range. The funnel follows accounts created
 * in the range; the money covers every account the source ever brought.
 * Revenue is in yuan; the *_usd figures are quota dollars, which customers
 * buy at ¥1 each, except fee_usd, which is real US dollars.
 */
export type ChannelRow = {
  segment: 'channel' | 'invited' | 'organic'
  channel: UserRef
  tier: string
  accounts: number
  registered: number
  activated: number
  paid: number
  repeat: number
  revenue: number
  payers: number
  new_payers: number
  consumption_usd: number
  /** The unpaid wallet share taken per hour, from credits received before that hour's end. */
  gift_consumption_usd: number
  /** Credits only: given plans created in the range plus administrators' balance increases; never negative. */
  granted_usd: number
  /** Given credit not yet spent, now, on enabled accounts. */
  gift_outstanding_usd: number
  /** Commission paid by the row's accounts (source_user_id), whoever earned it, both levels. */
  commission_usd: number
  /** Fee entries no longer add up where they overlap: an entry ends where the next starts. */
  fee_usd: number
  /** The part of revenue paid by accounts created in the range; absent before the server's release. */
  revenue_new_accounts?: number
  /** Fields below are absent before the server's release. The part of revenue paid in the range by accounts created on or after fee_start, yuan; 0 without a fee. */
  revenue_since_fee?: number
  /** The earliest start among the channel's fee entries, unix seconds; 0 without one. */
  fee_start?: number
  /** GiftQuota of the row's accounts holding an affiliate gift plan and no admin plan: a lower bound on what invite gift plans covered. */
  invite_gift_usd?: number
  /** Administrators' balance decreases in the range, positive. */
  clawed_back_usd?: number
  /** Unspent given plans and unpaid wallet share, now, on disabled (not deleted) accounts. */
  gift_dormant_usd?: number
  /** Channel rows only: all commission the channel's own account earned in the range, both levels. */
  commission_earned_usd?: number
  /** The part of commission_earned_usd earned while a fee entry was active. Above 0, commission is still being credited to a fee channel; net does not subtract it. */
  commission_accruing?: number
  /** The channel's stored fee entries overlapped; the later replaced the earlier from its own start. */
  fee_overlap?: boolean
}

export type ChannelInsights = StaleHours & {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
  channels: ChannelRow[]
  costs: ChannelCost[]
  usd_exchange_rate: number
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
  /** The vendor the account's group serves; absent before the server's release. */
  vendor?: string
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
  /** Requests the engine had no price for; absent before the server's release. */
  unpriced_requests?: number
  daily: { day: number; cost_usd: number; requests: number }[]
}

/**
 * Root's rows are left out of every figure (older servers included them in
 * all but none). A user is active only on a row with a charge or tokens;
 * requests counts every row's count.
 */
export type ActivityInsights = {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
  active_users: number
  /** new-api's charge: quota dollars that customers pay ¥1 each for, so yuan. */
  quota_usd: number
  /** Fields below are absent before the server's release, in quota dollars (yuan). The part of quota_usd charged for Claude models. */
  claude_quota_usd?: number
  /** Root's own charge in the range. */
  root_quota_usd?: number
  requests: number
  /** Claude's models at official prices. */
  engine_cost: EngineDailyCost
  /** Every model gpt-load serves; absent before the server's release. */
  engine_total?: EngineDailyCost
  /** Yuan per US dollar; absent before the server's release. */
  usd_exchange_rate?: number
  daily: {
    day: number
    dau: number
    wau: number
    requests: number
    quota_usd: number
    /** The day's Claude charge, quota dollars; absent before the server's release. */
    claude_quota_usd?: number
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
  /** Ranges of 3 days or less; absent before the server's release. */
  hourly?: ActivityHour[] | null
}

export type VendorQuality = {
  vendor: string
  models: string[] | null
  requests: number
  errors: number
  error_rate: number
  ttft_p50_ms: number
  ttft_p95_ms: number
}

export type QualityInsights = StaleHours & {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
  requests: number
  errors: number
  error_rate: number
  ttft_p50_ms: number
  ttft_p95_ms: number
  cache_share: number
  /** Customers only; the staff's requests and failed requests on the selected models are staff_requests and staff_errors. Absent before the server's release. */
  staff_requests?: number
  staff_errors?: number
  /** Every model in the range, whatever the filter selects. */
  models:
    | {
        model: string
        vendor: string
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
  /** Each vendor's figures over every model, whatever the filter selects. */
  vendors?: VendorQuality[] | null
  /** Every model's figures, whatever the filter selects. */
  all_models?: VendorQuality
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
  /** Failed tries whose reason is not in error_reasons, which keeps the most frequent; absent before the server's release. */
  error_reasons_other?: number
  /** Customers' failed tries over every model: the sums of status_codes and error_reasons. Absent before the server's release, and withheld, with vendor_failures, while stale_hours is above zero. */
  failed_tries?: number | null
  /** Each vendor's failed tries by reason and by status code, largest vendor first; absent before the server's release. */
  vendor_failures?: VendorFailure[] | null
  truncated: boolean
  /** Ranges of 3 days or less, following the model filter as daily does; absent before the server's release. */
  hourly?: QualityHour[] | null
  /** Customers only, as the capacity view's categories (ErrorCategory names, no_channel included); absent before the server's release. */
  error_categories?: NamedCount[] | null
  /** On every successful response from the server's release; absent before it. */
  tasks?: TaskOutcomes | null
  refusals?: QualityRefusals | null
}

/**
 * One vendor's failed tries. reasons and status_codes hold its top ten; the
 * other_ fields count the rest, so each list and its rest add up to
 * failed_tries.
 */
export type VendorFailure = {
  vendor: string
  failed_tries: number
  reasons: NamedCount[] | null
  other_reasons: number
  status_codes: NamedCount[] | null
  other_status_codes: number
}

/** revenue counts orders by when they were paid, as FinanceInsights.revenue. */
export type BusinessInsights = StaleHours & {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
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

/** The spans the funds view's user table reads, in hours. */
export type UserSpendHours = 1 | 5 | 12 | 24 | 168

/**
 * One customer's use over the window: new-api's charge (quota dollars, paid
 * ¥1 each) and gpt-load's official-price cost (US$) shared out to them, with
 * their balance and everything they have ever paid, in yuan.
 */
export type UserSpendRow = UserRef & {
  email: string
  requests: number
  quota_usd: number
  engine_usd: number
  topup_paid: number
  subscription_paid: number
  balance_usd: number
}

export type UserSpend = {
  hours: UserSpendHours
  start_time: number
  end_time: number
  usd_exchange_rate: number
  engine_configured: boolean
  engine_error?: string
  customers: number
  quota_usd: number
  root_quota_usd: number
  engine_usd: number
  customer_engine_usd: number
  root_engine_usd: number
  unattributed_engine_usd: number
  users: UserSpendRow[]
}

/** Where a channel's cost comes from: the upstream's bill, a monthly fee, or nowhere. */
export type UpstreamCostSource = 'upstream' | 'fee' | 'none'

/**
 * One channel over the range. requests and errors count attempts, root's
 * included. failure_rate = (errors - client_errors) / (requests + errors) on
 * servers that send client_errors, errors / attempts before. An auto-disabled
 * channel (status 3) is listed without traffic, and a channel with tasks in
 * the range whatever its status.
 */
export type UpstreamChannel = {
  id: number
  name: string
  status: number
  /** Fields to tasks are absent before the server's release. Why and when the channel was disabled, or on an enabled multi-key channel its latest still-disabled key; unix seconds. Absent when unknown. */
  status_reason?: string
  status_time?: number
  /** Keys the channel holds (1 for a single-key channel) and how many are disabled. */
  key_count?: number
  disabled_keys?: number
  priority: number
  host: string
  requests: number
  /** Served requests without root's and staff's. */
  customer_requests?: number
  errors: number
  /** Failed attempts the client caused: 4xx but 401, 402, 403, 404 and 408 (429 never). */
  client_errors?: number
  failure_rate: number
  rescued: number
  /** The part of cost_usd no model row takes, in the upstream's quota dollars. */
  unmatched_cost_usd?: number
  /** Tasks submitted on the channel in the range; absent with none. */
  tasks?: TaskOutcome | null
  revenue_usd: number
  cost_usd: number
  cost_source: UpstreamCostSource
  monthly_fee_usd: number
  latest_cost_at: number
  upstream_group: string
  upstream_group_ratio: number
  ttft_p50_ms: number
  ttft_p95_ms: number
  latency_p50_s: number
  prompt_tokens: number
  cache_read_tokens: number
  completion_tokens: number
  reasons: NamedCount[]
}

/** cost_usd includes bills under the name the channel's model mapping sent upstream, split by served requests when several names map to one. */
export type UpstreamModel = {
  model: string
  channel_id: number
  requests: number
  /** Absent before the server's release, as on UpstreamChannel. */
  customer_requests?: number
  errors: number
  client_errors?: number
  failure_rate: number
  rescued: number
  ttft_p50_ms: number
  latency_p50_s: number
  revenue_usd: number
  cost_usd: number
}

/** A row can exist for tasks alone. */
export type UpstreamDay = UpstreamTaskCounts & {
  day: number
  channel_id: number
  requests: number
  errors: number
  /** As on UpstreamHour; absent before the server's release. */
  client_errors?: number
  revenue_usd: number
  cost_usd: number
}

export type UpstreamRescue = { from: number; to: number; count: number }

export type UpstreamInsights = StaleHours & {
  /** Where the logs begin, unix seconds; see LogsSince. */
  logs_since?: number | null
  channels: UpstreamChannel[]
  models: UpstreamModel[]
  daily: UpstreamDay[]
  rescues: UpstreamRescue[]
  truncated: boolean
  /** Ranges of 3 days or less; absent before the server's release. */
  hourly?: UpstreamHour[] | null
}
