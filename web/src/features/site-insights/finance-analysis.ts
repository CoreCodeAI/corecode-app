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
  GroupAllocation,
  GroupConsumption,
  EnginePlanUsage,
  EngineUsageTotal,
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
  /** The recorded egress IP costs over the range, yuan: part of cost, in no row. */
  ipCost: number
  /**
   * The payment processors' fees on recognized revenue, yuan: part of cost,
   * in no row. The range's fees over the cash they were taken from, applied
   * to recognized revenue, so cash and revenue recognized in different
   * ranges are not mixed.
   */
  paymentFee: number
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
 * What the payment processors kept of the range's cash: their fees, refunded
 * orders' included, over the money of the orders still paid. 0 without paid
 * orders or on a server that does not send payment_fees.
 */
export function paymentFeeRate(data: FinanceInsights): number {
  const fees = data.payment_fees ?? []
  const money = fees.reduce((sum, row) => sum + row.money, 0)
  const fee = fees.reduce((sum, row) => sum + row.fee, 0)
  return money > 0 ? fee / money : 0
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
  const ipCost = (data.ip_cost_cny ?? 0) + (data.ip_cost_usd ?? 0) * rate
  const revenue = list.reduce((sum, row) => sum + row.revenue, 0)
  const paymentFee = revenue * paymentFeeRate(data)
  const cost =
    list.reduce((sum, row) => sum + row.cost, 0) +
    unattributed +
    ipCost +
    paymentFee
  const margin = revenue - cost
  return {
    rows: list,
    revenue,
    cost,
    margin,
    rate: revenue > 0 ? margin / revenue : null,
    unattributed,
    ipCost,
    paymentFee,
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

/** The costs the profit waterfall takes off revenue, in the order it takes them. */
export type WaterfallCost =
  | 'accounts'
  | 'bills'
  | 'fees'
  | 'ips'
  | 'payments'
  | 'channels'
  | 'commission'

/** One cost step of the profit waterfall, in yuan. */
export type WaterfallStep = { key: WaterfallCost; amount: number }

export type ProfitWaterfall = {
  /** The vendor panel's earned figure, in yuan. */
  revenue: number
  /** Accounts, upstream bills, upstream fees, IP costs, payment fees, channel fees, then commission. */
  steps: WaterfallStep[]
  /** Revenue less the first five steps: the gross margin financeMargins reports. */
  grossMargin: number
  /** Revenue less every step. Not net profit: the panel lists what is still missing. */
  left: number
}

/**
 * Revenue taken down to what is left, one cost the dashboard knows at a time.
 * Accounts, bills, fees, IP costs and payment fees are the gross margin's; the channel fee
 * (real US dollars, converted at the rate) and the commission credited as
 * wallet quota follow. Commission earned by the exempt accounts, the site's
 * own promotion accounts that never withdraw it, is not a cost. Undefined on a
 * server that does not send channel_fee_usd.
 */
export function profitWaterfall(
  data: FinanceInsights,
  margins: FinanceMargins,
  rate: number
): ProfitWaterfall | undefined {
  if (data.channel_fee_usd == null) return undefined
  const upstream = data.vendor_upstream ?? []
  const accounts = margins.rows.reduce((sum, row) => sum + row.accountCost, 0)
  const bills =
    upstream.reduce((sum, item) => sum + item.bill_usd, 0) +
    (data.upstream_unattributed_bill_usd ?? 0)
  const fees =
    (upstream.reduce((sum, item) => sum + item.fee_usd, 0) +
      (data.upstream_unattributed_fee_usd ?? 0)) *
    rate
  const channels = data.channel_fee_usd * rate
  const commission = Math.max(
    data.commission_usd - (data.commission_exempt_usd ?? 0),
    0
  )
  const ips = margins.ipCost
  const payments = margins.paymentFee
  const grossMargin = margins.revenue - accounts - bills - fees - ips - payments
  return {
    revenue: margins.revenue,
    steps: [
      { key: 'accounts', amount: accounts },
      { key: 'bills', amount: bills },
      { key: 'fees', amount: fees },
      { key: 'ips', amount: ips },
      { key: 'payments', amount: payments },
      { key: 'channels', amount: channels },
      { key: 'commission', amount: commission },
    ],
    grossMargin,
    left: grossMargin - channels - commission,
  }
}

/** One row of the group margin table, in yuan. */
export type GroupMarginRow = {
  group: string
  kind: GroupAllocation['kind']
  revenue: number
  /** Pool accounts, upstream bills and fees at the rate, the row's share. */
  cost: number
  margin: number
  /** margin over revenue; null without revenue. */
  marginRate: number | null
}

const ALLOCATION_KIND_ORDER: Record<GroupAllocation['kind'], number> = {
  group: 0,
  staff: 1,
  unattributed: 2,
}

/**
 * Each group's recognized revenue against its share of the cost: its pool
 * fraction of each vendor's account cost, its bills one for one, and its fees
 * at the rate. Customer groups come by revenue, then staff, then unattributed;
 * an unattributed row with neither revenue nor cost is left out. Null on a
 * server that sends no allocation.
 */
export function groupMargins(
  data: FinanceInsights,
  rate: number
): GroupMarginRow[] | null {
  if (data.group_allocations == null) return null
  const accounts = new Map(
    financeMargins(data, rate).rows.map((row) => [row.vendor, row.accountCost])
  )
  return data.group_allocations
    .map((item) => {
      let cost = item.bill_usd + item.fee_usd * rate
      for (const [vendor, share] of Object.entries(item.pool_share ?? {})) {
        cost += share * (accounts.get(vendor) ?? 0)
      }
      const revenue = item.recognized_revenue
      const margin = revenue - cost
      return {
        group: item.group,
        kind: item.kind,
        revenue,
        cost,
        margin,
        marginRate: revenue > 0 ? margin / revenue : null,
      }
    })
    .filter(
      (row) =>
        row.kind !== 'unattributed' ||
        Math.abs(row.revenue) >= 0.005 ||
        Math.abs(row.cost) >= 0.005
    )
    .sort(
      (a, b) =>
        ALLOCATION_KIND_ORDER[a.kind] - ALLOCATION_KIND_ORDER[b.kind] ||
        b.revenue - a.revenue ||
        a.group.localeCompare(b.group)
    )
}

/**
 * A group's cost over what it was charged, both in yuan: under 1 the price
 * covers the cost, whatever paid the charge; above 1 the group sells under
 * its cost. Null without a charge.
 */
export function costShare(
  cost: number,
  charged: number | null | undefined
): number | null {
  return charged != null && charged > 0 ? cost / charged : null
}

/**
 * The customer groups whose cost takes the most and the least of their
 * charge; null with fewer than two to compare.
 */
export function groupCostExtremes<
  T extends {
    group: string
    kind: GroupAllocation['kind']
    costShare: number | null
  },
>(rows: T[]): { most: T; least: T } | null {
  const ranked = rows.filter(
    (row) => row.kind === 'group' && row.costShare != null
  )
  if (ranked.length < 2) return null
  const sorted = [...ranked].sort(
    (a, b) =>
      (b.costShare ?? 0) - (a.costShare ?? 0) || a.group.localeCompare(b.group)
  )
  const least = sorted.at(-1)
  return least ? { most: sorted[0], least } : null
}

export type OrderFunnelRow = OrderMethodFunnel &
  CheckoutValue & {
    /** The method's rate in the previous period; null without its checkouts there. */
    previousRate: number | null
    /** Enough checkouts (MIN_CHECKOUTS) to color the rate. */
    judged: boolean
    /** The rate fell to half the previous period's or less, over MIN_ORDERS checkouts in both. */
    fell: boolean
  }

/** What one payment method's checkouts settled at, and what its unpaid ones might be worth. */
export type CheckoutValue = {
  /** Checkouts that have finished or been open over an hour: all but the pending ones opened within the hour. */
  settled: number
  /** Settled checkouts not paid: failed, expired, and pending past the hour. A refund was a payment, so it is not here. */
  unpaid: number
  /** Checkouts paid and refunded since. They completed, so they count with the paid ones in settledRate. */
  refunded: number
  /** Checkouts that were paid, refunded since or not, over settled; null with none settled. */
  settledRate: number | null
  /** Paid money over paid checkouts, in the payment currency; null with none paid. */
  averagePaid: number | null
  /** Unpaid times averagePaid: the most the unpaid checkouts could be worth. An upper estimate; null without an average. */
  estimate: number | null
}

/** A method's checkout value, read from its funnel row. */
export function checkoutValue(row: OrderMethodFunnel): CheckoutValue {
  const settled = row.created - Math.max(row.pending - row.pending_stale, 0)
  const unpaid = row.failed + row.expired + row.pending_stale
  const refunded = row.refunded ?? 0
  const averagePaid = row.paid > 0 ? row.paid_money / row.paid : null
  return {
    settled,
    unpaid,
    refunded,
    // A refunded checkout went through: a method whose payments are refunded
    // is not one whose checkouts fail.
    settledRate: settled > 0 ? (row.paid + refunded) / settled : null,
    averagePaid,
    estimate: averagePaid == null ? null : unpaid * averagePaid,
  }
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
      ...checkoutValue(row),
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

/**
 * Requests a plan needs before its served ÷ cost is coloured. The funds tab
 * has no request floor of its own, so this is its floor for a rate.
 */
export const PLAN_MIN_REQUESTS = MIN_CHECKOUTS

/** One plan's, or one removed or unattributed group's, served value against its cost. */
export type ServedRow = {
  key: string
  plan: string
  tier: string
  /** Served accounts; the removed accounts' count for the removed row. */
  accounts: number
  addedInRange: number
  requests: number
  failures: number
  servedUSD: number
  /** Share of all value served over the range; null when nothing was served. */
  share: number | null
  /** Served value over the plan's cost of the same range; null without a cost. */
  perCost: number | null
  /** Enough requests for perCost to be coloured. */
  judged: boolean
}

export type PlanServed = {
  /** Every value served over the range, rows and extra groups alike: the engine's total. */
  totalUSD: number
  /** One row per costed plan, in the order given. */
  rows: ServedRow[]
  /** Usage with no costed row: removed accounts, unattributed use and plans without a cost. */
  muted: ServedRow[]
  /** Accounts that served and were created inside the range, over all plans. */
  addedInRange: number
  /** The judged plans with the highest and lowest served ÷ cost; null under two judged plans. */
  most: ServedRow | null
  least: ServedRow | null
}

function servedRow(
  key: string,
  plan: string,
  tier: string,
  total: EngineUsageTotal,
  addedInRange: number,
  totalUSD: number,
  costUSD: number | null
): ServedRow {
  const perCost =
    costUSD !== null && costUSD > 0 ? total.served_usd / costUSD : null
  return {
    key,
    plan,
    tier,
    accounts: total.accounts,
    addedInRange,
    requests: total.requests,
    failures: total.failures,
    servedUSD: total.served_usd,
    share: totalUSD > 0 ? total.served_usd / totalUSD : null,
    perCost,
    judged: perCost !== null && total.requests >= PLAN_MIN_REQUESTS,
  }
}

const planKey = (plan: string, tier: string) => `${plan}/${tier}`

const EMPTY_TOTAL: EngineUsageTotal = {
  accounts: 0,
  requests: 0,
  failures: 0,
  served_usd: 0,
}

/**
 * Joins what the engine served by plan to the plan rows the funds tab costs.
 * A costed plan with no usage has zeros; usage with no costed row, removed
 * accounts and unattributed use are muted rows. Shares are of the whole
 * served total, so they add up to 100%.
 */
export function planServed(input: {
  usage: EnginePlanUsage
  costed: { plan: string; tier: string; costUSD: number | null }[]
}): PlanServed {
  const planRows = input.usage.plans
  const totalUSD =
    planRows.reduce((sum, row) => sum + row.served_usd, 0) +
    input.usage.removed.served_usd +
    input.usage.unattributed.served_usd
  const usageOf = new Map(
    planRows.map((row) => [planKey(row.plan, row.tier), row])
  )
  const costedKeys = new Set(
    input.costed.map((cost) => planKey(cost.plan, cost.tier))
  )
  const rows = input.costed.map((cost) => {
    const usage = usageOf.get(planKey(cost.plan, cost.tier))
    return servedRow(
      planKey(cost.plan, cost.tier),
      cost.plan,
      cost.tier,
      usage ?? EMPTY_TOTAL,
      usage?.added_in_range ?? 0,
      totalUSD,
      cost.costUSD
    )
  })
  const muted = planRows
    .filter((row) => !costedKeys.has(planKey(row.plan, row.tier)))
    .map((row) =>
      servedRow(
        planKey(row.plan, row.tier),
        row.plan,
        row.tier,
        row,
        row.added_in_range,
        totalUSD,
        null
      )
    )
  muted.push(
    servedRow('removed', '', '', input.usage.removed, 0, totalUSD, null),
    servedRow(
      'unattributed',
      '',
      '',
      { ...input.usage.unattributed, accounts: 0 },
      0,
      totalUSD,
      null
    )
  )
  const judged = rows.filter((row) => row.judged)
  let most: ServedRow | null = null
  let least: ServedRow | null = null
  if (judged.length >= 2) {
    most = judged.reduce((best, row) =>
      (row.perCost ?? 0) > (best.perCost ?? 0) ? row : best
    )
    least = judged.reduce((low, row) =>
      (row.perCost ?? 0) < (low.perCost ?? 0) ? row : low
    )
  }
  return {
    totalUSD,
    rows,
    muted,
    addedInRange: planRows.reduce((sum, row) => sum + row.added_in_range, 0),
    most,
    least,
  }
}

/** The head counts the concentration chart reads. */
export const CONCENTRATION_TOPS = [5, 10, 20] as const

/**
 * How much of the customers' consumption the biggest few took: each head
 * count's total and its share of the window's whole (the server's total
 * covers every customer, not only the listed hundred). A head count above
 * the customers listed is the whole list's. Null when nothing was consumed.
 */
export function spendConcentration(
  users: Pick<UserSpendRow, 'quota_usd'>[],
  total: number
): { top: number; amount: number; share: number }[] | null {
  if (!(total > 0)) return null
  const sorted = users.map((row) => row.quota_usd).sort((a, b) => b - a)
  return CONCENTRATION_TOPS.map((top) => {
    const amount = sorted.slice(0, top).reduce((sum, value) => sum + value, 0)
    return { top, amount, share: Math.min(1, amount / total) }
  })
}
