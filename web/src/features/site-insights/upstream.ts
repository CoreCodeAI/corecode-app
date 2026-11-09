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
/**
 * CoreCode fork: the upstream tab's figures, computed from the upstream
 * view so the tab only lays them out.
 */
import type {
  UpstreamChannel,
  UpstreamDay,
  UpstreamInsights,
  UpstreamModel,
} from './types'

/** Channels drawn as their own series; the rest are summed as one. */
export const UPSTREAM_SERIES = 3

/** Attempts below this are too few to name a channel best at a model. */
export const UPSTREAM_MIN_ATTEMPTS = 20

export const attemptsOf = (row: { requests: number; errors: number }) =>
  row.requests + row.errors

/**
 * What a channel kept after its cost, and that over its revenue. Both are
 * null when nothing says what the channel cost.
 */
export function upstreamMargin(channel: {
  revenue_usd: number
  cost_usd: number
  cost_source?: UpstreamChannel['cost_source']
}) {
  if (channel.cost_source === 'none') return { margin: null, rate: null }
  const margin = channel.revenue_usd - channel.cost_usd
  return {
    margin,
    rate: channel.revenue_usd > 0 ? margin / channel.revenue_usd : null,
  }
}

/** The view's totals across channels. */
export function upstreamTotals(data: UpstreamInsights | undefined) {
  const channels = data?.channels ?? []
  const sum = (pick: (row: UpstreamChannel) => number) =>
    channels.reduce((total, row) => total + pick(row), 0)
  const requests = sum((row) => row.requests)
  const errors = sum((row) => row.errors)
  const costed = channels.filter((row) => row.cost_source !== 'none')
  const revenue = sum((row) => row.revenue_usd)
  const costedRevenue = costed.reduce(
    (total, row) => total + row.revenue_usd,
    0
  )
  const cost = costed.reduce((total, row) => total + row.cost_usd, 0)
  return {
    requests,
    errors,
    attempts: requests + errors,
    failureRate: requests + errors > 0 ? errors / (requests + errors) : 0,
    rescued: sum((row) => row.rescued),
    revenue,
    cost,
    /** Over the channels whose cost is known only. */
    margin: costedRevenue - cost,
    marginRate: costedRevenue > 0 ? (costedRevenue - cost) / costedRevenue : 0,
    uncostedRevenue: revenue - costedRevenue,
  }
}

/**
 * The days of the range with each series' figure: the busiest channels by
 * attempts, then one series for the rest when there are more.
 */
export function upstreamDailySeries(
  channels: UpstreamChannel[],
  daily: UpstreamDay[]
) {
  const ranked = [...channels]
    .filter((row) => attemptsOf(row) > 0)
    .sort((a, b) => attemptsOf(b) - attemptsOf(a))
  const named = ranked.slice(0, UPSTREAM_SERIES).map((row) => row.id)
  const hasOther = ranked.length > UPSTREAM_SERIES
  const days = [...new Set(daily.map((row) => row.day))].sort((a, b) => a - b)
  const index = (channelID: number) => {
    const at = named.indexOf(channelID)
    if (at >= 0) return at
    return hasOther ? named.length : -1
  }
  const width = named.length + (hasOther ? 1 : 0)
  const empty = () => Array.from({ length: width }, () => 0)
  const byDay = new Map(
    days.map((day) => [
      day,
      {
        requests: empty(),
        errors: empty(),
        revenue: 0,
        cost: 0,
      },
    ])
  )
  for (const row of daily) {
    const entry = byDay.get(row.day)
    if (!entry) continue
    entry.revenue += row.revenue_usd
    entry.cost += row.cost_usd
    const at = index(row.channel_id)
    if (at < 0) continue
    entry.requests[at] += row.requests
    entry.errors[at] += row.errors
  }
  return {
    named,
    hasOther,
    days: days.flatMap((day) => {
      const entry = byDay.get(day)
      if (!entry) return []
      return {
        day,
        ...entry,
        attempts: entry.requests.map((count, at) => count + entry.errors[at]),
        failureRates: entry.requests.map((count, at) => {
          const attempts = count + entry.errors[at]
          return attempts > 0 ? entry.errors[at] / attempts : 0
        }),
      }
    }),
  }
}

export type UpstreamModelRow = UpstreamModel & {
  /** The figures this row is best at among the model's channels. */
  best: { failure: boolean; ttft: boolean; margin: boolean }
  marginRate: number | null
  /** The first row of its model, which carries the model's name. */
  first: boolean
}

/**
 * The models served by more than one channel, each with its channels side by
 * side and the best one marked per figure; every model when none is shared.
 * A channel is a candidate for best only with UPSTREAM_MIN_ATTEMPTS
 * attempts, and for margin only when its upstream bill is read.
 */
export function upstreamModelComparison(
  models: UpstreamModel[],
  channels: UpstreamChannel[]
): UpstreamModelRow[] {
  const billed = new Set(
    channels
      .filter((row) => row.cost_source === 'upstream')
      .map((row) => row.id)
  )
  const groups = new Map<string, UpstreamModel[]>()
  for (const row of models) {
    if (attemptsOf(row) === 0) continue
    groups.set(row.model, [...(groups.get(row.model) ?? []), row])
  }
  const shared = [...groups.values()].filter((rows) => rows.length > 1)
  const shown = shared.length > 0 ? shared : [...groups.values()]
  const result: UpstreamModelRow[] = []
  for (const rows of shown) {
    const sorted = [...rows].sort((a, b) => attemptsOf(b) - attemptsOf(a))
    const marginRate = (row: UpstreamModel) =>
      billed.has(row.channel_id) && row.revenue_usd > 0
        ? (row.revenue_usd - row.cost_usd) / row.revenue_usd
        : null
    const candidates = sorted.filter(
      (row) => attemptsOf(row) >= UPSTREAM_MIN_ATTEMPTS
    )
    const contested = candidates.length > 1
    const lowest = (pick: (row: UpstreamModel) => number | null) => {
      const values = candidates
        .map(pick)
        .filter((value): value is number => value !== null)
      return values.length > 1 ? Math.min(...values) : null
    }
    const bestFailure = contested ? lowest((row) => row.failure_rate) : null
    const bestTTFT = contested
      ? lowest((row) => (row.ttft_p50_ms > 0 ? row.ttft_p50_ms : null))
      : null
    const margins = candidates
      .map(marginRate)
      .filter((value): value is number => value !== null)
    const bestMargin = margins.length > 1 ? Math.max(...margins) : null
    sorted.forEach((row, index) => {
      const enough = attemptsOf(row) >= UPSTREAM_MIN_ATTEMPTS
      const rate = marginRate(row)
      result.push({
        ...row,
        first: index === 0,
        marginRate: rate,
        best: {
          failure:
            enough && bestFailure !== null && row.failure_rate === bestFailure,
          ttft: enough && bestTTFT !== null && row.ttft_p50_ms === bestTTFT,
          margin: enough && bestMargin !== null && rate === bestMargin,
        },
      })
    })
  }
  return result
}
