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
// The overview's pure figures: what drove each headline change, the last
// full hour against its baseline, and the upstream and margin checks.

import type { TFunction } from 'i18next'

import {
  alignPrevious,
  closedHours,
  contributions,
  findSpikes,
  median,
  type Contribution,
  type Finding,
} from '../analysis'
import {
  COST_STALE_SECONDS,
  CONCENTRATION_SHARE,
  DROP_SHARE,
  MIN_ORDERS,
  SMALL_SAMPLE,
  SPIKE_FACTOR,
  SPIKE_FLOOR,
  vendorMargins,
  type InsightsRangeInfo,
  type InsightsTab,
  type useInsightsFormat,
} from '../lib'
import type {
  ActivityInsights,
  CapacityHour,
  CapacityInsights,
  FinanceInsights,
  QualityInsights,
  UpstreamChannel,
  UpstreamInsights,
} from '../types'
import { attemptsOf, upstreamMargin } from '../upstream'
import type { MetricItem } from './shared'

/** The figure formats useInsightsFormat returns. */
export type InsightsFormat = ReturnType<typeof useInsightsFormat>

/** A failure rate above this needs action, as failureTone's danger. */
export const FAILING_RATE = 0.05

/** Requests by model, now against the previous period. */
export function requestContributions(
  current: QualityInsights | undefined,
  previous: QualityInsights | undefined
): Contribution[] {
  return contributions(
    current?.models,
    previous?.models,
    (row) => row.model,
    (row) => row.requests
  )
}

/** Each vendor's charge on each day of the range, in yuan. */
export function vendorCharges(
  finance: FinanceInsights | undefined
): { vendor: string; usd: number }[] {
  return (finance?.daily ?? []).flatMap((day) =>
    Object.entries(day.vendor_usd ?? {}).map(([vendor, usd]) => ({
      vendor,
      usd,
    }))
  )
}

/** Consumption by vendor, now against the previous period, in yuan. */
export function consumptionContributions(
  current: FinanceInsights | undefined,
  previous: FinanceInsights | undefined
): { parts: Contribution[]; total: number } {
  const now = vendorCharges(current)
  const before = vendorCharges(previous)
  const sum = (rows: { usd: number }[]) =>
    rows.reduce((total, row) => total + row.usd, 0)
  return {
    parts: contributions(
      now,
      before,
      (row) => row.vendor,
      (row) => row.usd
    ),
    total: sum(now) - sum(before),
  }
}

/** Revenue by payment method, now against the previous period. */
export function revenueContributions(
  current: FinanceInsights | undefined,
  previous: FinanceInsights | undefined
): Contribution[] {
  return contributions(
    current?.methods,
    previous?.methods,
    (row) => row.payment_method,
    (row) => row.money
  )
}

/** Orders by payment method in both periods. */
export function methodOrders(
  current: FinanceInsights | undefined,
  previous: FinanceInsights | undefined
): Map<string, { current: number; previous: number }> {
  const orders = new Map<string, { current: number; previous: number }>()
  const entry = (method: string) => {
    let found = orders.get(method)
    if (!found) {
      found = { current: 0, previous: 0 }
      orders.set(method, found)
    }
    return found
  }
  for (const row of current?.methods ?? []) {
    entry(row.payment_method).current += row.count
  }
  for (const row of previous?.methods ?? []) {
    entry(row.payment_method).previous += row.count
  }
  return orders
}

/** Both periods have enough orders for a revenue change to read as a percentage. */
export function revenueComparable(
  currentOrders: number,
  previousOrders: number | undefined
): boolean {
  return currentOrders >= MIN_ORDERS && (previousOrders ?? 0) >= MIN_ORDERS
}

/** An hourly figure as trend points, the hour still filling left out. */
export function closedTrend<T extends { hour: number }>(
  rows: T[] | null | undefined,
  end: number,
  value: (row: T) => number
): { hour: number; value: number }[] {
  return closedHours(rows ?? [], end).map((row) => ({
    hour: row.hour,
    value: value(row),
  }))
}

export type HourSignalKind = 'drop' | 'errors' | 'engine' | 'rate_limits'

/** The last full hour departing from its baseline. */
export type HourSignal = {
  kind: HourSignalKind
  hour: number
  value: number
  baseline: number
  /** The same hour of the previous period, or the median full hour of this range. */
  source: 'previous' | 'median'
}

const HOUR_FIELDS: [
  Exclude<HourSignalKind, 'drop'>,
  (row: CapacityHour) => number,
][] = [
  ['errors', (row) => row.errors],
  ['engine', (row) => row.engine_rejections],
  ['rate_limits', (row) => row.upstream_rate_limits],
]

/**
 * The last full hour of the range against the same hour of the previous
 * period, or, where that is missing or zero, the median of the range's other
 * full hours: requests under DROP_SHARE of a baseline of at least
 * SMALL_SAMPLE, and failures, pool-full rejections or upstream rate limits
 * at SPIKE_FACTOR times their baseline and SPIKE_FLOOR or more.
 */
export function lastHourSignals(
  current: CapacityHour[] | null | undefined,
  previous: CapacityHour[] | null | undefined,
  end: number,
  span: number
): HourSignal[] {
  const closed = closedHours(current ?? [], end)
  const last = closed.at(-1)
  if (!last) return []
  const others = closed.slice(0, -1)
  const before = alignPrevious([last], previous, span)[0]
  const baselineOf = (
    pick: (row: CapacityHour) => number
  ): { baseline: number; source: HourSignal['source'] } => {
    if (before && pick(before) > 0) {
      return { baseline: pick(before), source: 'previous' }
    }
    return { baseline: median(others.map(pick)), source: 'median' }
  }
  const signals: HourSignal[] = []
  const requests = baselineOf((row) => row.requests)
  if (
    requests.baseline >= SMALL_SAMPLE &&
    last.requests < requests.baseline * DROP_SHARE
  ) {
    signals.push({
      kind: 'drop',
      hour: last.hour,
      value: last.requests,
      ...requests,
    })
  }
  for (const [kind, pick] of HOUR_FIELDS) {
    const value = pick(last)
    const base = baselineOf(pick)
    const spiked = findSpikes([value], [base.baseline], {
      factor: SPIKE_FACTOR,
      floor: SPIKE_FLOOR,
    })
    if (spiked.length > 0) {
      signals.push({ kind, hour: last.hour, value, ...base })
    }
  }
  return signals
}

/** Channels failing past FAILING_RATE over at least SMALL_SAMPLE attempts, most failures first. */
export function failingChannels(
  data: UpstreamInsights | undefined
): UpstreamChannel[] {
  return (data?.channels ?? [])
    .filter(
      (row) =>
        attemptsOf(row) >= SMALL_SAMPLE && row.failure_rate > FAILING_RATE
    )
    .sort((a, b) => b.errors - a.errors)
}

/** Channels with a known cost that cost more than they earned, largest loss first. */
export function losingChannels(
  data: UpstreamInsights | undefined
): { channel: UpstreamChannel; loss: number }[] {
  return (data?.channels ?? [])
    .flatMap((channel) => {
      const margin = upstreamMargin(channel).margin
      return margin !== null && margin < 0 ? [{ channel, loss: -margin }] : []
    })
    .sort((a, b) => b.loss - a.loss)
}

/**
 * Channels costed by an upstream bill last read more than
 * COST_STALE_SECONDS before the range's end while they earned in it: their
 * latest revenue has no cost against it yet.
 */
export function staleCostChannels(
  data: UpstreamInsights | undefined,
  end: number
): UpstreamChannel[] {
  return (data?.channels ?? []).filter(
    (row) =>
      row.cost_source === 'upstream' &&
      row.revenue_usd > 0 &&
      row.latest_cost_at > 0 &&
      end - row.latest_cost_at > COST_STALE_SECONDS
  )
}

/** The largest customer, when their share of consumption passes CONCENTRATION_SHARE. */
export function concentratedCustomer(
  data: ActivityInsights | undefined
): ActivityInsights['top_users'][number] | undefined {
  if (!data || data.top1_share <= CONCENTRATION_SHARE) return undefined
  return data.top_users[0]
}

/** How a gross margin reads, as useFinanceVerdict colors it. */
export function marginTone(
  revenue: number,
  margin: number
): 'danger' | 'warning' | 'default' {
  if (revenue <= 0) return 'default'
  if (margin < 0) return 'danger'
  if (margin / revenue < 0.2) return 'warning'
  return 'default'
}

function hourSignalTitle(t: TFunction, fmt: InsightsFormat) {
  return (signal: HourSignal): string => {
    const vars = {
      count: fmt.num(signal.value),
      baseline: fmt.num(Math.round(signal.baseline)),
      time: fmt.time(signal.hour),
    }
    const previous = signal.source === 'previous'
    switch (signal.kind) {
      case 'drop':
        return previous
          ? t(
              'Requests fell to {{count}} in the hour from {{time}}, against {{baseline}} at the same hour before',
              vars
            )
          : t(
              'Requests fell to {{count}} in the hour from {{time}}, against a median of {{baseline}} an hour',
              vars
            )
      case 'errors':
        return previous
          ? t(
              '{{count}} failures in the hour from {{time}}, against {{baseline}} at the same hour before',
              vars
            )
          : t(
              '{{count}} failures in the hour from {{time}}, against a median of {{baseline}} an hour',
              vars
            )
      case 'engine':
        return previous
          ? t(
              '{{count}} turned away with the pool full in the hour from {{time}}, against {{baseline}} at the same hour before',
              vars
            )
          : t(
              '{{count}} turned away with the pool full in the hour from {{time}}, against a median of {{baseline}} an hour',
              vars
            )
      default:
        return previous
          ? t(
              '{{count}} upstream rate limits in the hour from {{time}}, against {{baseline}} at the same hour before',
              vars
            )
          : t(
              '{{count}} upstream rate limits in the hour from {{time}}, against a median of {{baseline}} an hour',
              vars
            )
    }
  }
}

/**
 * Signals the overview adds to the tabs' own: the last full hour against
 * its baseline, failing, losing or uncosted upstream channels, and one
 * customer carrying too much of the consumption.
 */
export function overviewExtraSignals(
  t: TFunction,
  fmt: InsightsFormat,
  props: {
    capacity: CapacityInsights | undefined
    previousCapacity: CapacityInsights | undefined
    upstream: UpstreamInsights | undefined
    activity: ActivityInsights | undefined
    range?: InsightsRangeInfo
  }
): Finding[] {
  const hourTitle = hourSignalTitle(t, fmt)
  const signals: Finding[] = []
  const range = props.range

  if (range?.hourly && props.capacity) {
    const details: Record<HourSignal['kind'], string> = {
      drop: t('This may be an outage: check the upstreams and the pool.'),
      errors: t('See which models and reasons failed.'),
      engine: t('Every pool slot was busy; add accounts or slots.'),
      rate_limits: t('The upstream throttled us; spread load or add capacity.'),
    }
    const tabs: Record<HourSignal['kind'], InsightsTab> = {
      drop: 'capacity',
      errors: 'quality',
      engine: 'capacity',
      rate_limits: 'capacity',
    }
    for (const signal of lastHourSignals(
      props.capacity.hourly,
      props.previousCapacity?.hourly,
      range.end,
      range.end - range.start
    )) {
      signals.push({
        key: `hour-${signal.kind}`,
        tone: signal.kind === 'drop' ? 'danger' : 'warning',
        title: hourTitle(signal),
        detail: details[signal.kind],
        tab: tabs[signal.kind],
        impact:
          signal.kind === 'drop'
            ? signal.baseline - signal.value
            : signal.value,
      })
    }
  }

  const failing = failingChannels(props.upstream)
  if (failing.length > 0) {
    signals.push({
      key: 'upstream-failing',
      tone: 'warning',
      title: t('{{count}} upstream channels fail more than 5% of attempts', {
        count: failing.length,
      }),
      detail: failing
        .map((row) => `${row.name} ${fmt.pct(row.failure_rate)}`)
        .join(', '),
      tab: 'upstream',
      impact: failing.reduce((sum, row) => sum + row.errors, 0),
    })
  }
  const losing = losingChannels(props.upstream)
  if (losing.length > 0) {
    signals.push({
      key: 'upstream-losing',
      tone: 'warning',
      title: t('{{count}} upstream channels cost more than they earned', {
        count: losing.length,
      }),
      detail: losing
        .map((row) => `${row.channel.name} ${fmt.usd(-row.loss)}`)
        .join(', '),
      tab: 'upstream',
      impact: losing.reduce((sum, row) => sum + row.loss, 0),
    })
  }
  if (range) {
    const stale = staleCostChannels(props.upstream, range.end)
    if (stale.length > 0) {
      signals.push({
        key: 'upstream-stale',
        tone: 'default',
        title: t(
          'The upstream bill of {{count}} channels has not been read lately',
          { count: stale.length }
        ),
        detail: stale
          .map((row) =>
            t('{{name}}, read {{time}}', {
              name: row.name,
              time: fmt.time(row.latest_cost_at),
            })
          )
          .join(', '),
        tab: 'upstream',
      })
    }
  }

  const top = concentratedCustomer(props.activity)
  if (top && props.activity) {
    signals.push({
      key: 'activity-concentration',
      tone: 'warning',
      title: t('One customer, {{user}}, used {{share}} of the consumption', {
        user: top.username || `#${top.user_id}`,
        share: fmt.pct(props.activity.top1_share),
      }),
      detail: t('{{amount}} over {{requests}} requests', {
        amount: fmt.cny(top.quota_usd),
        requests: fmt.num(top.requests),
      }),
      tab: 'activity',
      impact: top.quota_usd,
    })
  }
  return signals
}

/**
 * Revenue earned in the range and the gross margin on it after the pool
 * accounts' cost, colored as the funds tab's verdict.
 */
export function marginCard(
  t: TFunction,
  fmt: InsightsFormat,
  finance: FinanceInsights | undefined,
  rate: number
): MetricItem {
  const label = t('Gross margin')
  const help = t(
    'Revenue earned from what customers used, less what the pool’s accounts cost over the range.'
  )
  const rows = finance ? vendorMargins(finance, rate) : []
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  if (!finance || revenue <= 0) {
    return {
      label,
      help,
      value: '-',
      hint: finance
        ? t('Earned {{amount}}', {
            amount: fmt.cny(finance.recognized_revenue ?? 0),
          })
        : undefined,
    }
  }
  const margin = revenue - rows.reduce((sum, row) => sum + row.cost, 0)
  return {
    label,
    help,
    value: fmt.cny(margin),
    tone: marginTone(revenue, margin),
    hint: t('{{rate}} of {{earned}} earned', {
      rate: fmt.pct(margin / revenue),
      earned: fmt.cny(revenue),
    }),
  }
}
