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
  closedHours,
  contributions,
  dominant,
  runRate,
  type Contribution,
} from './analysis'
import {
  CONCENTRATION_SHARE,
  DEBT_ALERT_USD,
  GIFT_SHARE_WARN,
  HOURLY_MAX_DAYS,
  MIN_ORDERS,
  type InsightsRangeInfo,
} from './lib'
import type {
  EnginePlanValue,
  FinanceHour,
  FinanceInsights,
  UserSpendRow,
} from './types'

const DAY = 86400

/** Unpaid credit issued past this share of paid credit needs a look. */
export const UNPAID_CREDIT_WARN = 0.5

/** Customers' balance covering more days of their paid use than this is a refund exposure. */
export const RUNWAY_WARN_DAYS = 60

/** Below this share of measured capacity, the pool has accounts to spare. */
export const POOL_UNDER_USED = 0.4

/** Past this share of measured capacity, the pool is close to full. */
export const POOL_OVER_USED = 0.85

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
  const days = Math.max(0, (end - start) / DAY)
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
  /** new-api's charge at list price, root included, in yuan. */
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
 * vendor_models, root included on both sides) and revenue by payment
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

/**
 * Days of customers' paid use their balance covers: the balance over the
 * paid part of their consumption per day. Null without paid use to divide by.
 */
export function balanceRunway(
  data: FinanceInsights | undefined,
  days: number
): number | null {
  if (!data || days <= 0) return null
  const paid = data.consumption_usd - (data.gift_consumption_usd ?? 0)
  if (paid <= 0) return null
  return Math.max(0, data.liability_usd) / (paid / days)
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
    Math.max(0, data?.adjustment_net_usd ?? 0)
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
 * leave capacity short and read as over-use.
 */
export function poolUse(input: {
  plans: EnginePlanValue[] | null | undefined
  officialUSD: number
  chargedUSD: number
  coveredDays: number
  costPerDayUSD: number
}): PoolUse | null {
  const plans = (input.plans ?? []).filter((plan) => plan.accounts > 0)
  if (plans.length === 0 || input.coveredDays <= 0) return null
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
