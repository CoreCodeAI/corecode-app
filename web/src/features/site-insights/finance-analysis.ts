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
// The funds view's pure analysis. new-api's charges (consumption_usd,
// vendor_models[].usd, quota_usd, balances) are quota dollars that customers
// pay ¥1 each for, so yuan; engine cost and account prices are US dollars.

import {
  beforeLogs,
  closedHours,
  contributions,
  dominant,
  runRate,
  type Contribution,
} from './analysis'
import {
  CONCENTRATION_SHARE,
  COST_STALE_SECONDS,
  DEBT_ALERT_USD,
  GIFT_SHARE_WARN,
  HOURLY_MAX_DAYS,
  loggedDays,
  MARGIN_VENDORS,
  MIN_CHECKOUTS,
  MIN_ORDERS,
  vendorMargins,
  type InsightsRangeInfo,
  type VendorMarginRow,
} from './lib'
import type {
  EnginePlanValue,
  FinanceHour,
  FinanceInsights,
  GroupConsumption,
  OrderMethodFunnel,
  PlanBookRow,
  UserSpendRow,
} from './types'

const HOUR = 3600
const DAY = 86400

/**
 * Whether the hour or the day that starts at start lies before the logs
 * begin: a bucket with no data, drawn as a gap rather than a zero.
 */
export function bucketBeforeLogs(
  start: number,
  span: 'hour' | 'day',
  logsSince: number | null | undefined
): boolean {
  return beforeLogs(start, span === 'hour' ? HOUR : DAY, logsSince)
}

/** Unpaid credit issued past this share of paid credit needs a look. */
export const UNPAID_CREDIT_WARN = 0.5

/** Customers' balance covering more days of their paid use than this is a refund exposure. */
export const RUNWAY_WARN_DAYS = 60

/** Below this share of measured capacity, the pool has accounts to spare. */
export const POOL_UNDER_USED = 0.4

/** Past this share of measured capacity, the pool is close to full. */
export const POOL_OVER_USED = 0.85
/** Days of matched data before the pool's use may advise on the account count. */
export const POOL_MIN_DAYS = 7

/**
 * Under this much customer consumption, in yuan, a gifted share is a few
 * test requests, not a leak.
 */
export const GIFT_MIN_YUAN = 100

/**
 * The range the data covers: the page's when given, else the response's own
 * start and end. A range of HOURLY_MAX_DAYS or fewer reads by the hour.
 */
export function financeRange(
  data: Pick<FinanceInsights, 'start_time' | 'end_time'> | undefined,
  range: InsightsRangeInfo | undefined
): InsightsRangeInfo {
  if (range) return range
  const end = data?.end_time ?? 0
  const start = data?.start_time ?? end
  const days = Math.max(0, Math.round((end - start) / DAY))
  return { start, end, days, hourly: days > 0 && days <= HOURLY_MAX_DAYS }
}

/** The hourly series to draw, or null to keep the daily one. */
export function financeHours(
  data: FinanceInsights | undefined,
  range: InsightsRangeInfo
): FinanceHour[] | null {
  const hours = data?.hourly
  if (!range.hourly || !hours || hours.length === 0) return null
  return hours
}

/** The closed hour that took the most money, or undefined when none took any. */
export function peakHour(
  hours: FinanceHour[],
  end: number
): FinanceHour | undefined {
  let best: FinanceHour | undefined
  for (const hour of closedHours(hours, end)) {
    const paid = hour.topup + hour.subscription
    if (paid <= 0) continue
    if (!best || paid > best.topup + best.subscription) best = hour
  }
  return best
}

/**
 * The whole day that took the most money. A day the range starts or ends
 * inside is partial and never the best; without the range's bounds every
 * day counts.
 */
export function bestWholeDay<
  T extends { day: number; topup: number; subscription: number },
>(days: T[], start?: number, end?: number): T | undefined {
  let best: T | undefined
  for (const day of days) {
    if (start != null && day.day < start) continue
    if (end != null && day.day + DAY > end) continue
    const paid = day.topup + day.subscription
    if (paid <= 0) continue
    if (!best || paid > best.topup + best.subscription) best = day
  }
  return best
}

/** Revenue rests on enough orders in both periods for a percentage change. */
export function ordersComparable(
  orders: number,
  previousOrders: number | undefined
): boolean {
  return (
    previousOrders != null &&
    orders >= MIN_ORDERS &&
    previousOrders >= MIN_ORDERS
  )
}

/** A signed amount, such as +¥30 or -¥12. */
export function signed(
  value: number,
  format: (value: number) => string
): string {
  return value > 0 ? `+${format(value)}` : format(value)
}

export type FinanceDrivers = {
  /** new-api's charge at list price, root and staff included, in yuan. */
  consumption: { current: number; previous: number; change: number }
  /** The one or two models, else vendors, that drove the consumption change. */
  consumptionBy: { kind: 'model' | 'vendor'; parts: Contribution[] }
  models: Contribution[]
  revenue: { current: number; previous: number; change: number }
  /** The one or two payment methods that drove the revenue change. */
  revenueBy: Contribution[]
  methods: Contribution[]
}

/**
 * What moved between the periods: consumption by model and vendor (from
 * vendor_models, root and staff included on both sides) and revenue by payment
 * method. Undefined without a previous period to compare with.
 */
export function financeDrivers(
  data: FinanceInsights,
  previous: FinanceInsights | undefined
): FinanceDrivers | undefined {
  if (!previous) return undefined
  const sum = (rows: { usd: number }[] | null | undefined) =>
    (rows ?? []).reduce((total, row) => total + row.usd, 0)
  const models = contributions(
    data.vendor_models,
    previous.vendor_models,
    (row) => row.model,
    (row) => row.usd
  )
  const vendors = contributions(
    data.vendor_models,
    previous.vendor_models,
    (row) => row.vendor,
    (row) => row.usd
  )
  const consumptionNow = sum(data.vendor_models)
  const consumptionBefore = sum(previous.vendor_models)
  const consumptionChange = consumptionNow - consumptionBefore
  const byModel = dominant(models, consumptionChange)
  const byVendor = dominant(vendors, consumptionChange)
  let consumptionBy: FinanceDrivers['consumptionBy'] = {
    kind: 'model',
    parts: byModel,
  }
  if (byModel.length !== 1 && byVendor.length > 0) {
    consumptionBy = { kind: 'vendor', parts: byVendor }
  }
  const methods = contributions(
    data.methods,
    previous.methods,
    (row) => row.payment_method,
    (row) => row.money
  )
  const revenueChange = data.revenue - previous.revenue
  return {
    consumption: {
      current: consumptionNow,
      previous: consumptionBefore,
      change: consumptionChange,
    },
    consumptionBy,
    models,
    revenue: {
      current: data.revenue,
      previous: previous.revenue,
      change: revenueChange,
    },
    revenueBy: dominant(methods, revenueChange),
    methods,
  }
}

/** Earned revenue, account cost and margin over the range, projected to 30 days. */
export function monthProjection(
  revenue: number,
  cost: number,
  days: number
): { revenue: number; cost: number; margin: number } {
  return {
    revenue: runRate(revenue, days),
    cost: runRate(cost, days),
    margin: runRate(revenue - cost, days),
  }
}

/** A range shorter than this many days is too short to measure a runway. */
export const RUNWAY_MIN_DAYS = 3

/**
 * Why a runway is a dash: the range is short, the server lacks a figure the
 * runway needs, or there is no paid use to divide by.
 */
export type RunwayGap = 'short' | 'missing' | 'no_use'

export type Runway =
  | { days: number; gap: null }
  | { days: null; gap: RunwayGap }

/**
 * Days customers' paid balances and paid plans' quota left cover at the
 * range's paid use per day. Both sides count paid money only, so the runway
 * does not read gift credit as runway. Paid use is spread over the logged
 * days of the range, so days before the logs begin do not dilute it. A
 * server that sends neither the paid balance nor the plan quota gives no
 * runway: a figure from one side alone would understate it.
 */
export function runwayOf(
  data: FinanceInsights | undefined,
  range: InsightsRangeInfo
): Runway {
  if (!data) return { days: null, gap: 'missing' }
  if (range.days < RUNWAY_MIN_DAYS) return { days: null, gap: 'short' }
  const paidBalance = data.liability_paid_value
  const planQuota =
    data.paid_plan_quota_left_usd ?? owedNow(data)?.planQuotaLeft
  const logged = loggedDays(range, data.logs_since)
  if (paidBalance == null || planQuota == null || logged <= 0) {
    return { days: null, gap: 'missing' }
  }
  const paidUse =
    data.paid_use_usd ?? data.consumption_usd - (data.gift_consumption_usd ?? 0)
  if (paidUse <= 0) return { days: null, gap: 'no_use' }
  return {
    days: Math.max(0, paidBalance + planQuota) / (paidUse / logged),
    gap: null,
  }
}

export type GiftWatch = {
  /** Gifted credit's share of customers' consumption; null without enough consumption. */
  giftShare: number | null
  /** Unpaid credit issued per yuan of paid credit; null without paid credit. */
  unpaidPerPaid: number | null
  unpaid: number
}

/** How much of what customers use and receive was given rather than paid for. */
export function giftWatch(data: FinanceInsights | undefined): GiftWatch {
  const consumed = data?.consumption_usd ?? 0
  const unpaid =
    (data?.bonus_usd ?? 0) +
    (data?.redemption_usd ?? 0) +
    (data?.commission_usd ?? 0) +
    Math.max(0, data?.adjustment_net_usd ?? 0) +
    signupCredit(data)
  const paid = data?.topup_credit_usd ?? 0
  return {
    giftShare:
      consumed >= GIFT_MIN_YUAN
        ? (data?.gift_consumption_usd ?? 0) / consumed
        : null,
    unpaidPerPaid: paid > 0 ? unpaid / paid : null,
    unpaid,
  }
}

/**
 * Credit given on check-in (exact) and at sign-up and invitation (counts
 * times today's settings: estimates), in yuan. 0 on a server without them.
 */
export function signupCredit(data: FinanceInsights | undefined): number {
  return (
    (data?.checkin_credit_usd ?? 0) +
    (data?.signup_credit_estimate_usd ?? 0) +
    (data?.invitee_credit_estimate_usd ?? 0)
  )
}

/** The gifted share is past its warning line. */
export function giftShareHigh(watch: GiftWatch): boolean {
  return watch.giftShare != null && watch.giftShare > GIFT_SHARE_WARN
}

export type PoolUse = {
  /** Official-price use per day, US dollars. */
  usedPerDay: number
  /** What the pool's accounts serve in a day at official prices, measured. */
  capacityPerDay: number
  utilisation: number
  /** The account cost per day: new-api's daily Claude charge, in US dollars, that covers it. */
  breakEven: number
  /** new-api's Claude charge per day over the same days, in US dollars. */
  chargedPerDay: number
  advice: 'fewer' | 'more' | 'fits'
}

/**
 * The Claude pool's use against its measured weekly capacity. Null unless
 * every plan with accounts has a measured week: an unmeasured plan would
 * leave capacity short and read as over-use. Null too under POOL_MIN_DAYS of
 * matched data, where a few hours of use would read as buy or drop advice.
 */
export function poolUse(input: {
  plans: EnginePlanValue[] | null | undefined
  officialUSD: number
  chargedUSD: number
  coveredDays: number
  costPerDayUSD: number
}): PoolUse | null {
  const plans = (input.plans ?? []).filter((plan) => plan.accounts > 0)
  if (plans.length === 0 || input.coveredDays < POOL_MIN_DAYS) return null
  if (plans.some((plan) => plan.measured <= 0 || plan.week_usd <= 0)) {
    return null
  }
  const capacityPerDay =
    plans.reduce((sum, plan) => sum + plan.week_usd * plan.accounts, 0) / 7
  const usedPerDay = input.officialUSD / input.coveredDays
  const utilisation = usedPerDay / capacityPerDay
  let advice: PoolUse['advice'] = 'fits'
  if (utilisation < POOL_UNDER_USED) advice = 'fewer'
  else if (utilisation > POOL_OVER_USED) advice = 'more'
  return {
    usedPerDay,
    capacityPerDay,
    utilisation,
    breakEven: input.costPerDayUSD,
    chargedPerDay: input.chargedUSD / input.coveredDays,
    advice,
  }
}

export type SpendFlag = 'below_cost' | 'debt' | 'concentrated'

/**
 * What to look at in one customer's use: charged below gpt-load's official
 * cost (compared in dollars at rate yuan to the dollar), in debt past the
 * alert line, or holding more than CONCENTRATION_SHARE of the window's
 * customer consumption.
 */
export function spendFlags(
  row: UserSpendRow,
  totalYuan: number,
  rate: number,
  engineRead: boolean
): SpendFlag[] {
  const flags: SpendFlag[] = []
  if (
    engineRead &&
    row.engine_usd > 0 &&
    rate > 0 &&
    row.quota_usd / rate < row.engine_usd
  ) {
    flags.push('below_cost')
  }
  if (row.balance_usd < DEBT_ALERT_USD) flags.push('debt')
  if (totalYuan > 0 && row.quota_usd / totalYuan > CONCENTRATION_SHARE) {
    flags.push('concentrated')
  }
  return flags
}

/** A vendor's margin row with its cost split into accounts and upstreams, yuan. */
export type MarginRow = VendorMarginRow & {
  /** The pool's accounts at today's prices over the range. */
  accountCost: number
  /** Upstream bills (their quota dollars, one for one) plus fees at the rate. */
  upstreamCost: number
}

export type FinanceMargins = {
  rows: MarginRow[]
  revenue: number
  /** Every row's cost plus the upstream cost no row's revenue took. */
  cost: number
  margin: number
  /** margin over revenue; null without revenue. */
  rate: number | null
  /** Upstream cost on channels with no customer revenue in the range, yuan. */
  unattributed: number
  /** The server sent upstream bills by vendor, so they are subtracted. */
  upstreamRead: boolean
  /** Accounts with no recorded price, counted as free. */
  unpricedAccounts: number
  /** Accounts in no engine group, so with no vendor: counted as free too. */
  ungroupedAccounts: number
  /** Vendors whose oldest channel bill was read over COST_STALE_SECONDS before the range's end. */
  staleBills: { vendor: string; at: number }[]
}

/**
 * Gross margin by vendor: recognized revenue against the pool's account cost
 * and the billed upstreams' cost. A bill is in that upstream's quota dollars,
 * compared with revenue one for one; a fee is real US dollars, at the rate.
 * Without the server's upstream bills, only accounts are subtracted.
 */
export function financeMargins(
  data: FinanceInsights,
  rate: number
): FinanceMargins {
  const rows = new Map<string, MarginRow>(
    vendorMargins(data, rate).map((row) => [
      row.vendor,
      { ...row, accountCost: row.cost, upstreamCost: 0 },
    ])
  )
  const end = data.end_time ?? 0
  const staleBills: FinanceMargins['staleBills'] = []
  for (const item of data.vendor_upstream ?? []) {
    let row = rows.get(item.vendor)
    if (!row) {
      row = {
        vendor: item.vendor,
        revenue: 0,
        cost: 0,
        margin: 0,
        accounts: 0,
        unpriced: 0,
        accountCost: 0,
        upstreamCost: 0,
      }
      rows.set(item.vendor, row)
    }
    row.upstreamCost += item.bill_usd + item.fee_usd * rate
    if (
      item.oldest_bill_at > 0 &&
      end - item.oldest_bill_at > COST_STALE_SECONDS
    ) {
      staleBills.push({ vendor: item.vendor, at: item.oldest_bill_at })
    }
  }
  const order = (vendor: string) => {
    const index = MARGIN_VENDORS.indexOf(vendor as never)
    return index < 0 ? MARGIN_VENDORS.length : index
  }
  const list = [...rows.values()]
    .map((row) => {
      const cost = row.accountCost + row.upstreamCost
      return { ...row, cost, margin: row.revenue - cost }
    })
    .filter((row) => row.revenue > 0 || row.accounts > 0 || row.cost > 0)
    .sort((a, b) => order(a.vendor) - order(b.vendor))
  const unattributed =
    (data.upstream_unattributed_bill_usd ?? 0) +
    (data.upstream_unattributed_fee_usd ?? 0) * rate
  const revenue = list.reduce((sum, row) => sum + row.revenue, 0)
  const cost = list.reduce((sum, row) => sum + row.cost, 0) + unattributed
  const margin = revenue - cost
  return {
    rows: list,
    revenue,
    cost,
    margin,
    rate: revenue > 0 ? margin / revenue : null,
    unattributed,
    upstreamRead: data.vendor_upstream != null,
    unpricedAccounts: list.reduce((sum, row) => sum + row.unpriced, 0),
    ungroupedAccounts: (data.plan_accounts ?? []).reduce(
      (sum, plan) => sum + (plan.vendor ? 0 : plan.accounts),
      0
    ),
    staleBills,
  }
}

/** How a gross margin reads: a loss, thin under 20%, else good. */
export function marginTone(
  margin: number,
  revenue: number
): 'danger' | 'warning' | 'good' {
  if (margin < 0) return 'danger'
  if (revenue > 0 && margin / revenue < 0.2) return 'warning'
  return 'good'
}

export type OrderFunnelRow = OrderMethodFunnel & {
  /** The method's rate in the previous period; null without its checkouts there. */
  previousRate: number | null
  /** Enough checkouts (MIN_CHECKOUTS) to color the rate. */
  judged: boolean
  /** The rate fell to half the previous period's or less, over MIN_ORDERS checkouts in both. */
  fell: boolean
}

/**
 * Each payment method's checkouts against its own previous period. Most
 * unpaid checkouts are abandoned, so a rate is judged only against the same
 * method before, never against 100%.
 */
export function orderFunnels(
  rows: OrderMethodFunnel[] | null | undefined,
  previous: OrderMethodFunnel[] | null | undefined
): OrderFunnelRow[] {
  const before = new Map(
    (previous ?? []).map((row) => [row.payment_method, row])
  )
  return (rows ?? []).map((row) => {
    const prior = before.get(row.payment_method)
    const previousRate =
      prior && prior.created > 0 ? prior.completion_rate : null
    const fell =
      !!prior &&
      previousRate != null &&
      previousRate > 0 &&
      row.created >= MIN_ORDERS &&
      prior.created >= MIN_ORDERS &&
      row.completion_rate <= previousRate / 2
    return {
      ...row,
      previousRate,
      judged: row.created >= MIN_CHECKOUTS,
      fell,
    }
  })
}

export type GroupRow = GroupConsumption & {
  /** Consumption in the previous period; null without the previous groups. */
  previousUsd: number | null
  /** Share change in percentage points as a fraction; null without the previous groups. */
  shareChange: number | null
}

/** Each billing group's use beside its previous period, matched by name. */
export function groupRows(
  rows: GroupConsumption[] | null | undefined,
  previous: GroupConsumption[] | null | undefined
): GroupRow[] {
  const before =
    previous == null ? null : new Map(previous.map((row) => [row.group, row]))
  return (rows ?? []).map((row) => {
    if (!before) return { ...row, previousUsd: null, shareChange: null }
    const prior = before.get(row.group)
    return {
      ...row,
      previousUsd: prior?.consumption_usd ?? 0,
      shareChange: row.share - (prior?.share ?? 0),
    }
  })
}

export type PlanBookTotals = {
  runningPaid: number
  runningGifted: number
  sold: number
  soldValue: number
  renewed: number
  gifted: number
  expired: number
  expiring: number
  expiringValue: number
  deferred: number
}

/** The plan book's totals over every plan. */
export function planBookTotals(rows: PlanBookRow[]): PlanBookTotals {
  const totals: PlanBookTotals = {
    runningPaid: 0,
    runningGifted: 0,
    sold: 0,
    soldValue: 0,
    renewed: 0,
    gifted: 0,
    expired: 0,
    expiring: 0,
    expiringValue: 0,
    deferred: 0,
  }
  for (const row of rows) {
    totals.runningPaid += row.running_paid
    totals.runningGifted += row.running_gifted
    totals.sold += row.sold
    totals.soldValue += row.sold_value
    totals.renewed += row.renewed
    totals.gifted += row.gifted
    totals.expired += row.expired
    totals.expiring += row.expiring_7d
    totals.expiringValue += row.expiring_7d_value
    totals.deferred += row.deferred_value
  }
  return totals
}

export type OwedNow = {
  /** What customers paid for their wallet balances, yuan. */
  wallets: number
  /** The price share of running paid plans not yet run, yuan. */
  plans: number
  total: number
  /** Quota dollars left on running paid plans: never-resetting totals plus this period's remainder. */
  planQuotaLeft: number
  paidPlans: number
  unmatched: number
}

/**
 * Money taken and not yet earned, now: wallets at their paid value and
 * running paid plans' unrun share. Null on a server without plan_liability.
 * A point in time: never compared with the previous period.
 */
export function owedNow(data: FinanceInsights | undefined): OwedNow | null {
  const plans = data?.plan_liability
  if (!data || !plans) return null
  const wallets = data.liability_paid_value ?? 0
  return {
    wallets,
    plans: plans.deferred_value,
    total: wallets + plans.deferred_value,
    planQuotaLeft: plans.paid_quota_left_usd + plans.paid_period_left_usd,
    paidPlans: plans.paid_plans,
    unmatched: plans.unmatched,
  }
}

export type ClaudeEarned = {
  /** Claude's revenue earned over the days gpt-load reported, yuan. */
  earnedYuan: number
  /** Revenue earned per yuan customers were charged for Claude; null without their charge. */
  perCharge: number | null
}

/**
 * Claude's revenue earned (root and staff left out) over the days gpt-load reported:
 * the range's recognized revenue for Claude in proportion to those days.
 * Null on a server without revenue by vendor.
 */
export function claudeEarned(
  data: FinanceInsights | undefined,
  coveredDays: number,
  rangeDays: number
): ClaudeEarned | null {
  const row = data?.vendor_revenue?.find((item) => item.vendor === 'claude')
  if (!row) return null
  const covered = rangeDays > 0 ? Math.min(1, coveredDays / rangeDays) : 0
  return {
    earnedYuan: row.recognized_revenue * covered,
    perCharge:
      row.customer_usd > 0 ? row.recognized_revenue / row.customer_usd : null,
  }
}
