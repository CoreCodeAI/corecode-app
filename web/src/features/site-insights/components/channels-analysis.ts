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
import { VIEW_MAX_DAYS } from '../api'
import { MIN_COHORT, SHORT_ROI_DAYS, channelEconomics } from '../lib'
import type { ChannelCost, ChannelRow } from '../types'

const DAY_SECONDS = 86400
const FEE_MONTH_SECONDS = 30 * DAY_SECONDS

/** Fewer accounts paying for the first time than this give no fee per new payer. */
export const MIN_NEW_PAYERS = 3

/** A row's identity across periods: invited and organic have user id 0. */
export function channelKey(row: ChannelRow): string {
  return `${row.segment}-${row.channel.user_id}`
}

/** Sources with a fee: the ones whose return is judged. */
export function paidChannels(rows: ChannelRow[]): ChannelRow[] {
  return rows.filter((row) => row.fee_usd > 0)
}

export type ChannelTotals = {
  fee: number
  revenue: number
  net: number
  gift: number
  newPayers: number
}

/** The paid channels' figures summed, in yuan. */
export function channelTotals(rows: ChannelRow[], rate: number): ChannelTotals {
  return paidChannels(rows).reduce<ChannelTotals>(
    (sum, row) => {
      const economics = channelEconomics(row, rate)
      sum.fee += economics.fee
      sum.revenue += row.revenue
      sum.net += economics.net
      sum.gift += row.gift_consumption_usd
      sum.newPayers += row.new_payers
      return sum
    },
    { fee: 0, revenue: 0, net: 0, gift: 0, newPayers: 0 }
  )
}

export type CostDriver = 'fee' | 'commission' | 'gift'

/** What a source cost, in yuan, by part, and the largest part; null without cost. */
export function costParts(
  row: ChannelRow,
  rate: number
): { fee: number; commission: number; gift: number; main: CostDriver | null } {
  const economics = channelEconomics(row, rate)
  const parts: Record<CostDriver, number> = {
    fee: economics.fee,
    commission: economics.commission,
    gift: row.gift_consumption_usd,
  }
  let main: CostDriver | null = null
  for (const key of ['fee', 'commission', 'gift'] as const) {
    if (parts[key] > 0 && (main === null || parts[key] > parts[main])) {
      main = key
    }
  }
  return { ...parts, main }
}

/** The paid channel with the lowest net, or undefined without one. */
export function worstPaidChannel(
  rows: ChannelRow[],
  rate: number
): ChannelRow | undefined {
  let worst: ChannelRow | undefined
  let worstNet = Infinity
  for (const row of paidChannels(rows)) {
    const net = channelEconomics(row, rate).net
    if (net < worstNet) {
      worst = row
      worstNet = net
    }
  }
  return worst
}

/** Given credit's share of what a source's accounts used; null when they used nothing. */
export function giftShare(row: ChannelRow): number | null {
  return row.consumption_usd > 0
    ? row.gift_consumption_usd / row.consumption_usd
    : null
}

/** Revenue per paying account; null without payers. */
export function revenuePerPayer(row: ChannelRow): number | null {
  return row.payers > 0 ? row.revenue / row.payers : null
}

/** A funnel rate, or null under MIN_COHORT sign-ups. */
export function cohortRate(events: number, registered: number): number | null {
  return registered >= MIN_COHORT ? events / registered : null
}

/**
 * A source's activation and paying rates as multiples of organic sign-ups'.
 * Each is null unless both cohorts reach MIN_COHORT and organic's rate is
 * above zero.
 */
export function organicLift(
  row: ChannelRow,
  organic: ChannelRow | undefined
): { activated: number | null; paid: number | null } {
  const multiple = (events: number, base: number): number | null => {
    if (!organic) return null
    const rate = cohortRate(events, row.registered)
    const baseline = cohortRate(base, organic.registered)
    if (rate == null || baseline == null || baseline <= 0) return null
    return rate / baseline
  }
  return {
    activated: multiple(row.activated, organic?.activated ?? 0),
    paid: multiple(row.paid, organic?.paid ?? 0),
  }
}

/**
 * The share of a source's revenue paid by accounts it brought in the
 * range; null before the server sends it or without revenue.
 */
export function newAccountShare(row: ChannelRow): number | null {
  if (row.revenue_new_accounts == null || row.revenue <= 0) return null
  return row.revenue_new_accounts / row.revenue
}

/**
 * Why a range's ROI and fee per new payer are not judged: a range under
 * SHORT_ROI_DAYS, or fewer than MIN_NEW_PAYERS new payers. Null when they
 * are. An unknown range length is not held against them.
 */
export function roiMuted(
  days: number | undefined,
  newPayers: number
): 'short' | 'few' | null {
  if (days != null && days < SHORT_ROI_DAYS) return 'short'
  if (newPayers < MIN_NEW_PAYERS) return 'few'
  return null
}

/**
 * Where a contract-to-date read starts: the earliest fee's start, but no
 * earlier than the view's longest range back from end. Null without a fee
 * that started before end.
 */
export function contractStart(
  costs: ChannelCost[],
  end: number
): number | null {
  const starts = costs
    .filter((cost) => cost.monthly_usd > 0 && cost.start < end)
    .map((cost) => cost.start)
  if (starts.length === 0) return null
  return Math.max(
    Math.min(...starts),
    end - VIEW_MAX_DAYS.channels * DAY_SECONDS
  )
}

export type ContractRow = {
  row: ChannelRow
  /** The channel's own earliest fee start, clamped to the read's start. */
  start: number
  days: number
  fee: number
  net: number
  paidBack: boolean
  /** Days until net reaches zero at the daily net; 0 once paid back, null when it does not climb. */
  breakEvenDays: number | null
  /** Days of the read before this channel's fee started, whose revenue carries no fee. */
  preContractDays: number
}

/** Days until a negative net reaches zero at a daily net; 0 once it has. */
export function breakEvenDays(net: number, dailyNet: number): number | null {
  if (net >= 0) return 0
  if (dailyNet <= 0) return null
  return -net / dailyNet
}

/**
 * Each paid channel since its fee started, from one read of the view from
 * readStart to end, worst net first. dailyNet gives a channel's current
 * daily net, such as the selected range's; without it, the read's own
 * average serves.
 */
export function contractRows(
  rows: ChannelRow[],
  costs: ChannelCost[],
  rate: number,
  readStart: number,
  end: number,
  dailyNet?: (row: ChannelRow) => number | undefined
): ContractRow[] {
  const starts = new Map<number, number>()
  for (const cost of costs) {
    if (cost.monthly_usd <= 0 || cost.start >= end) continue
    const known = starts.get(cost.user_id)
    starts.set(
      cost.user_id,
      known == null ? cost.start : Math.min(known, cost.start)
    )
  }
  const readDays = Math.max((end - readStart) / DAY_SECONDS, 0)
  const result: ContractRow[] = []
  for (const row of rows) {
    if (row.segment !== 'channel') continue
    const own = starts.get(row.channel.user_id)
    if (own == null) continue
    const start = Math.max(own, readStart)
    const economics = channelEconomics(row, rate)
    const daily =
      dailyNet?.(row) ?? (readDays > 0 ? economics.net / readDays : 0)
    result.push({
      row,
      start,
      days: Math.max((end - start) / DAY_SECONDS, 0),
      fee: economics.fee,
      net: economics.net,
      paidBack: economics.net >= 0,
      breakEvenDays: breakEvenDays(economics.net, daily),
      preContractDays: Math.max((start - readStart) / DAY_SECONDS, 0),
    })
  }
  return result.sort((a, b) => a.net - b.net)
}

/**
 * The fees accrued from monthStart to now and the monthly fees running
 * now, in US dollars. A fee accrues a thirtieth of its month a day.
 */
export function monthFees(
  costs: ChannelCost[],
  monthStart: number,
  now: number
): { accrued: number; monthly: number } {
  let accrued = 0
  let monthly = 0
  for (const cost of costs) {
    if (cost.monthly_usd <= 0) continue
    const from = Math.max(cost.start, monthStart)
    const to = Math.min(cost.end > 0 ? cost.end : now, now)
    if (to > from) {
      accrued += (cost.monthly_usd * (to - from)) / FEE_MONTH_SECONDS
    }
    if (cost.start <= now && (cost.end === 0 || cost.end > now)) {
      monthly += cost.monthly_usd
    }
  }
  return { accrued, monthly }
}

/** Local midnight of the first day of the month containing unix, in unix seconds. */
export function monthStartOf(unix: number): number {
  const date = new Date(unix * 1000)
  return Math.floor(
    new Date(date.getFullYear(), date.getMonth(), 1).getTime() / 1000
  )
}
