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
import { contributions, isOpenHour, type Contribution } from './analysis'
import { COST_STALE_SECONDS, SMALL_SAMPLE } from './lib'
import type {
  TaskOutcome,
  UpstreamChannel,
  UpstreamDay,
  UpstreamHour,
  UpstreamInsights,
  UpstreamModel,
  UpstreamRescue,
} from './types'

/**
 * Channels drawn as their own series; the rest are summed as one, drawn
 * grey. BarSeries colours a third slot amber and a fourth rose, which read
 * as alarms, so only two channels get colours.
 */
export const UPSTREAM_SERIES = 2

/** Keys the upstream cost reader reads per channel; the rest are left out. */
export const UPSTREAM_COST_MAX_KEYS = 5

/** Attempts below this are too few to name a channel best at a model. */
export const UPSTREAM_MIN_ATTEMPTS = 20

/** An hour failing past this rate, as failureTone's danger, is part of an incident. */
export const INCIDENT_RATE = 0.05

/** Every channel under this failure rate, as failureTone's default, is all clear. */
export const CLEAR_RATE = 0.02

const HOUR = 3600

export const attemptsOf = (row: { requests: number; errors: number }) =>
  row.requests + row.errors

/**
 * Failed attempts the channel is to blame for: errors less the customers'
 * own bad requests. All errors on a server that does not send client_errors.
 */
export const faultsOf = (row: {
  errors: number
  client_errors?: number
}): number => Math.max(0, row.errors - (row.client_errors ?? 0))

/** Whether the view tells customers' bad requests from channel failures. */
export function splitsClientErrors(
  data: UpstreamInsights | undefined
): boolean {
  return (data?.channels ?? []).some((row) => row.client_errors != null)
}

/**
 * Why a read upstream bill is short: the reader reads only the first
 * UPSTREAM_COST_MAX_KEYS keys (keys), or stops once the channel is disabled
 * (disabled). Null for a whole bill, a channel not billed from its
 * upstream, or a server that does not send key counts.
 */
export type PartialBill =
  | { kind: 'keys'; read: number; total: number }
  | { kind: 'disabled' }

export function partialBill(row: UpstreamChannel): PartialBill | null {
  if (row.cost_source !== 'upstream') return null
  const keys = row.key_count ?? 0
  if (keys > UPSTREAM_COST_MAX_KEYS) {
    return { kind: 'keys', read: UPSTREAM_COST_MAX_KEYS, total: keys }
  }
  if (row.key_count != null && row.status !== 1) return { kind: 'disabled' }
  return null
}

/** The channels whose bill leaves keys unread, so their cost is short. */
export function shortBills(
  data: UpstreamInsights | undefined
): UpstreamChannel[] {
  return (data?.channels ?? []).filter(
    (row) => partialBill(row)?.kind === 'keys'
  )
}

/** The channels that ran async tasks in the range, most submitted first. */
export function channelTasks(
  data: UpstreamInsights | undefined
): { channel: UpstreamChannel; tasks: TaskOutcome }[] {
  return (data?.channels ?? [])
    .flatMap((channel) =>
      channel.tasks && channel.tasks.submitted > 0
        ? [{ channel, tasks: channel.tasks }]
        : []
    )
    .sort((a, b) => b.tasks.submitted - a.tasks.submitted)
}

/** Tasks that reached an end, the task failure rate's denominator. */
export const finishedTasks = (tasks: TaskOutcome): number =>
  tasks.succeeded + tasks.failed

/**
 * Channels listed though automatically disabled and idle all range: no
 * attempt and no task. A server that does not list them sends none.
 */
export function idleDisabled(
  data: UpstreamInsights | undefined
): UpstreamChannel[] {
  return (data?.channels ?? []).filter(
    (row) => row.status === 3 && attemptsOf(row) === 0 && !row.tasks?.submitted
  )
}

/** A channel's name by id, or #id for one the view does not list. */
export function channelNamer(
  data: UpstreamInsights | undefined
): (id: number) => string {
  const names = new Map((data?.channels ?? []).map((row) => [row.id, row.name]))
  return (id: number) => names.get(id) ?? `#${id}`
}

/** Requests served elsewhere after failing on a channel, by the channel they failed on. */
export function rescuedFrom(
  rescues: UpstreamRescue[] | null | undefined
): Map<number, number> {
  const totals = new Map<number, number>()
  for (const row of rescues ?? []) {
    totals.set(row.from, (totals.get(row.from) ?? 0) + row.count)
  }
  return totals
}

/**
 * A channel's failed attempts, those it is to blame for (faultsOf), that no
 * other channel made up for. Attempt based: retries on the same channel add
 * failures no rescue offsets, so it can overcount what customers saw.
 */
export function unrescuedOf(
  row: { id: number; errors: number; client_errors?: number },
  rescued: Map<number, number>
): number {
  return Math.max(0, faultsOf(row) - (rescued.get(row.id) ?? 0))
}

/** The channel that served most of what failed on a channel, and how many. */
export function topRescuer(
  rescues: UpstreamRescue[] | null | undefined,
  from: number
): UpstreamRescue | undefined {
  return (rescues ?? [])
    .filter((row) => row.from === from && row.to !== from)
    .reduce<UpstreamRescue | undefined>(
      (top, row) => (!top || row.count > top.count ? row : top),
      undefined
    )
}

/**
 * A channel's upstream bill was last read more than COST_STALE_SECONDS
 * before the range ended while it still earned: its latest revenue has no
 * cost yet. revenue is what it earned from the hour of the last read on, or
 * null without an hourly series to tell.
 */
export type StaleCost = { channel: UpstreamChannel; revenue: number | null }

export function staleCosts(
  data: UpstreamInsights | undefined,
  end: number | undefined
): StaleCost[] {
  if (!data || end === undefined) return []
  const hourly = data.hourly ?? null
  const result: StaleCost[] = []
  for (const channel of data.channels) {
    if (channel.cost_source !== 'upstream' || channel.latest_cost_at <= 0) {
      continue
    }
    if (end - channel.latest_cost_at <= COST_STALE_SECONDS) continue
    if (hourly === null) {
      if (channel.requests > 0) result.push({ channel, revenue: null })
      continue
    }
    const revenue = hourly
      .filter(
        (row) =>
          row.channel_id === channel.id &&
          row.hour + HOUR > channel.latest_cost_at
      )
      .reduce((sum, row) => sum + row.revenue_usd, 0)
    if (revenue > 0) result.push({ channel, revenue })
  }
  return result
}

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
  const faults = sum(faultsOf)
  const costed = channels.filter((row) => row.cost_source !== 'none')
  const revenue = sum((row) => row.revenue_usd)
  const costedRevenue = costed.reduce(
    (total, row) => total + row.revenue_usd,
    0
  )
  const cost = costed.reduce((total, row) => total + row.cost_usd, 0)
  const rescued = rescuedFrom(data?.rescues)
  return {
    requests,
    errors,
    /** The part of errors customers' own bad requests caused; 0 on an older server. */
    clientErrors: errors - faults,
    attempts: requests + errors,
    /** Failed attempts the channels are to blame for, over every attempt. */
    failureRate: requests + errors > 0 ? faults / (requests + errors) : 0,
    rescued: sum((row) => row.rescued),
    /** Failed attempts no other channel served; attempt based. */
    unrescued: sum((row) => unrescuedOf(row, rescued)),
    revenue,
    costedRevenue,
    cost,
    /** Over the channels whose cost is known only. */
    margin: costedRevenue - cost,
    marginRate: costedRevenue > 0 ? (costedRevenue - cost) / costedRevenue : 0,
    uncostedRevenue: revenue - costedRevenue,
  }
}

type SlotRow = {
  channel_id: number
  requests: number
  errors: number
  client_errors?: number
  revenue_usd: number
  cost_usd: number
}

/**
 * errors are the failed attempts the channel is to blame for (faultsOf).
 * revenue is every channel's; costedRevenue only that of channels whose
 * cost is known, the part cost sets against, and uncostedRevenue the rest.
 */
export type UpstreamSlot = {
  slot: number
  requests: number[]
  errors: number[]
  attempts: number[]
  failureRates: number[]
  revenue: number
  costedRevenue: number
  uncostedRevenue: number
  cost: number
}

/**
 * Each slot (a day or an hour) with each series' figure: the busiest
 * channels by attempts, then one series for the rest when there are more.
 * A row of a channel the view does not list counts as uncosted.
 */
function channelSeries<R extends SlotRow>(
  channels: UpstreamChannel[],
  rows: R[],
  slotOf: (row: R) => number,
  slots: number[]
): { named: number[]; hasOther: boolean; slots: UpstreamSlot[] } {
  const costed = new Set(
    channels.filter((row) => row.cost_source !== 'none').map((row) => row.id)
  )
  const ranked = [...channels]
    .filter((row) => attemptsOf(row) > 0)
    .sort((a, b) => attemptsOf(b) - attemptsOf(a))
  const named = ranked.slice(0, UPSTREAM_SERIES).map((row) => row.id)
  const hasOther = ranked.length > UPSTREAM_SERIES
  const index = (channelID: number) => {
    const at = named.indexOf(channelID)
    if (at >= 0) return at
    return hasOther ? named.length : -1
  }
  const width = named.length + (hasOther ? 1 : 0)
  const empty = () => Array.from({ length: width }, () => 0)
  const bySlot = new Map(
    slots.map((slot) => [
      slot,
      {
        requests: empty(),
        errors: empty(),
        attempts: empty(),
        revenue: 0,
        costedRevenue: 0,
        uncostedRevenue: 0,
        cost: 0,
      },
    ])
  )
  for (const row of rows) {
    const entry = bySlot.get(slotOf(row))
    if (!entry) continue
    entry.revenue += row.revenue_usd
    if (costed.has(row.channel_id)) {
      entry.costedRevenue += row.revenue_usd
    } else {
      entry.uncostedRevenue += row.revenue_usd
    }
    entry.cost += row.cost_usd
    const at = index(row.channel_id)
    if (at < 0) continue
    entry.requests[at] += row.requests
    entry.errors[at] += faultsOf(row)
    entry.attempts[at] += attemptsOf(row)
  }
  return {
    named,
    hasOther,
    slots: slots.flatMap((slot) => {
      const entry = bySlot.get(slot)
      if (!entry) return []
      return {
        slot,
        ...entry,
        failureRates: entry.attempts.map((count, at) =>
          count > 0 ? entry.errors[at] / count : 0
        ),
      }
    }),
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
  const days = [...new Set(daily.map((row) => row.day))].sort((a, b) => a - b)
  const series = channelSeries(channels, daily, (row) => row.day, days)
  return {
    named: series.named,
    hasOther: series.hasOther,
    days: series.slots.map(({ slot, ...rest }) => ({ day: slot, ...rest })),
  }
}

/**
 * Every hour start of the range, oldest first: from the hour holding start
 * to the last hour starting before end, and any hour a row has outside it.
 * Without a range, the hours from the first row's to the last's.
 */
export function upstreamHourSlots(
  hourly: UpstreamHour[] | null | undefined,
  range?: { start: number; end: number }
): number[] {
  const hours = new Set((hourly ?? []).map((row) => row.hour))
  const known = [...hours]
  let first = range ? range.start - (range.start % HOUR) : Math.min(...known)
  let last = range
    ? range.end - 1 - ((range.end - 1) % HOUR)
    : Math.max(...known)
  if (known.length > 0) {
    first = Math.min(first, ...known)
    last = Math.max(last, ...known)
  }
  if (!Number.isFinite(first) || !Number.isFinite(last)) return []
  for (let hour = first; hour <= last; hour += HOUR) hours.add(hour)
  return [...hours].sort((a, b) => a - b)
}

/** The hours of the range with each series' figure, as upstreamDailySeries does for days. */
export function upstreamHourlySeries(
  channels: UpstreamChannel[],
  hourly: UpstreamHour[] | null | undefined,
  range?: { start: number; end: number }
) {
  const series = channelSeries(
    channels,
    hourly ?? [],
    (row) => row.hour,
    upstreamHourSlots(hourly, range)
  )
  return {
    named: series.named,
    hasOther: series.hasOther,
    hours: series.slots.map(({ slot, ...rest }) => ({ hour: slot, ...rest })),
  }
}

/**
 * A run of hours in which a channel failed past INCIDENT_RATE every hour
 * it was tried, over at least SMALL_SAMPLE attempts in the run. errors are
 * the failures the channel is to blame for (faultsOf). start is
 * the first hour's start and end the last hour's end, or the range's end
 * when the run reaches into the open hour (ongoing). rescuer is the channel
 * that served most of what failed on it over the whole range.
 */
export type UpstreamIncident = {
  channel_id: number
  start: number
  end: number
  attempts: number
  errors: number
  rate: number
  ongoing: boolean
  rescuer?: UpstreamRescue
}

/**
 * Incident windows, most failed attempts first. The open hour cannot start
 * a run; it only extends one that reaches it, which then reads as ongoing.
 * end is the range's end; without it no hour is open.
 */
export function upstreamIncidents(
  hourly: UpstreamHour[] | null | undefined,
  rescues: UpstreamRescue[] | null | undefined,
  range?: { start: number; end: number }
): UpstreamIncident[] {
  const rows = hourly ?? []
  const slots = upstreamHourSlots(rows, range)
  const end = range?.end ?? Number.POSITIVE_INFINITY
  const byChannel = new Map<number, Map<number, UpstreamHour>>()
  for (const row of rows) {
    const hours = byChannel.get(row.channel_id) ?? new Map()
    const same = hours.get(row.hour)
    hours.set(
      row.hour,
      same
        ? {
            ...same,
            requests: same.requests + row.requests,
            errors: same.errors + row.errors,
            client_errors: (same.client_errors ?? 0) + (row.client_errors ?? 0),
          }
        : row
    )
    byChannel.set(row.channel_id, hours)
  }
  const result: UpstreamIncident[] = []
  for (const [channel, hours] of byChannel) {
    let run: {
      start: number
      last: number
      attempts: number
      errors: number
      open: boolean
    } | null = null
    const close = () => {
      if (
        run &&
        run.attempts >= SMALL_SAMPLE &&
        run.errors / run.attempts > INCIDENT_RATE
      ) {
        result.push({
          channel_id: channel,
          start: run.start,
          end: run.open ? end : run.last + HOUR,
          attempts: run.attempts,
          errors: run.errors,
          rate: run.errors / run.attempts,
          ongoing: run.open,
          rescuer: topRescuer(rescues, channel),
        })
      }
      run = null
    }
    for (const hour of slots) {
      const row = hours.get(hour)
      const attempts = row ? attemptsOf(row) : 0
      const faults = row ? faultsOf(row) : 0
      const failing =
        row !== undefined && attempts > 0 && faults / attempts > INCIDENT_RATE
      const open = isOpenHour(hour, end)
      if (!failing || (open && !run)) {
        close()
        continue
      }
      if (!run) {
        run = { start: hour, last: hour, attempts: 0, errors: 0, open: false }
      }
      run.last = hour
      run.attempts += attempts
      run.errors += faults
      run.open = open
    }
    close()
  }
  return result.sort((a, b) => b.errors - a.errors || a.start - b.start)
}

/**
 * Each channel's part in the change of the failed attempts it is to blame
 * for, the failures no other channel rescued, and the margin over channels
 * with a known cost,
 * against the previous period. fresh holds the channels the previous period
 * did not list, whose figures are new rather than a jump from zero.
 */
export function upstreamChanges(
  data: UpstreamInsights | undefined,
  previous: UpstreamInsights | undefined
): {
  failures: Contribution[]
  unrescued: Contribution[]
  margin: Contribution[]
  fresh: Set<string>
} {
  const key = (row: UpstreamChannel) => String(row.id)
  const now = data?.channels ?? []
  const before = previous?.channels ?? []
  const rescuedNow = rescuedFrom(data?.rescues)
  const rescuedBefore = rescuedFrom(previous?.rescues)
  const listed = new Set(before.map(key))
  const margin = (row: UpstreamChannel) =>
    row.cost_source === 'none' ? 0 : row.revenue_usd - row.cost_usd
  return {
    failures: contributions(now, before, key, faultsOf),
    unrescued: contributions(
      now.map((row) => ({ id: row.id, value: unrescuedOf(row, rescuedNow) })),
      before.map((row) => ({
        id: row.id,
        value: unrescuedOf(row, rescuedBefore),
      })),
      (row) => String(row.id),
      (row) => row.value
    ),
    margin: contributions(now, before, key, margin),
    fresh: new Set(now.filter((row) => !listed.has(key(row))).map(key)),
  }
}

/**
 * How a channel's served tokens read: the share of input read from the
 * cache, and what a million tokens cost. Logged prompt tokens count cache
 * reads in OpenAI's usage and leave them out in Anthropic's; a channel is
 * taken to leave them out when every model it served is a Claude model or
 * its cache reads exceed its prompt tokens. Cache writes are not sent, so
 * an Anthropic-style input is short of them. costPerMillion is null without
 * a known cost.
 */
export function channelTokens(
  row: UpstreamChannel,
  models: UpstreamModel[] | null | undefined
): {
  input: number
  cacheRate: number | null
  costPerMillion: number | null
} {
  const served = (models ?? []).filter(
    (model) => model.channel_id === row.id && model.requests > 0
  )
  const claudeOnly =
    served.length > 0 &&
    served.every((model) => model.model.toLowerCase().startsWith('claude'))
  const excludes = claudeOnly || row.cache_read_tokens > row.prompt_tokens
  const input = excludes
    ? row.prompt_tokens + row.cache_read_tokens
    : row.prompt_tokens
  const total = input + row.completion_tokens
  return {
    input,
    cacheRate: input > 0 ? row.cache_read_tokens / input : null,
    costPerMillion:
      row.cost_source !== 'none' && total > 0
        ? (row.cost_usd / total) * 1e6
        : null,
  }
}

/**
 * Whether a monthly-fee channel's fee, a thirtieth a day, is covered by
 * what it earned a day over the range. Null for other channels or without
 * days.
 */
export function feeBreakEven(
  row: UpstreamChannel,
  days: number
): { dailyFee: number; dailyRevenue: number; gap: number } | null {
  if (row.cost_source !== 'fee' || row.monthly_fee_usd <= 0 || days <= 0) {
    return null
  }
  const dailyFee = row.monthly_fee_usd / 30
  const dailyRevenue = row.revenue_usd / days
  return { dailyFee, dailyRevenue, gap: dailyRevenue - dailyFee }
}

/**
 * The channels whose upstream bill names models no row of theirs serves, so
 * that cost is in the channel's total but in no model row; most first.
 */
export function unmatchedCosts(
  data: UpstreamInsights | undefined
): UpstreamChannel[] {
  return (data?.channels ?? [])
    .filter(
      (row) =>
        row.cost_source === 'upstream' && (row.unmatched_cost_usd ?? 0) >= 0.01
    )
    .sort((a, b) => (b.unmatched_cost_usd ?? 0) - (a.unmatched_cost_usd ?? 0))
}

/**
 * What customers were charged per request they sent. Revenue leaves root
 * out, so the requests do too where the server says how many were
 * customers'; null without requests.
 */
export function revenuePerRequest(row: UpstreamModel): number | null {
  const requests = row.customer_requests ?? row.requests
  return requests > 0 ? row.revenue_usd / requests : null
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
 * attempts, and for margin only when its upstream bill is read whole (not
 * from some of its keys).
 */
export function upstreamModelComparison(
  models: UpstreamModel[],
  channels: UpstreamChannel[]
): UpstreamModelRow[] {
  const billed = new Set(
    channels
      .filter(
        (row) =>
          row.cost_source === 'upstream' && partialBill(row)?.kind !== 'keys'
      )
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

/**
 * A model whose best channel for failures (and for margin, where margins
 * compare) has a lower priority than the channel serving most of it.
 * earnsMore says it is also best for margin. Busiest and better are
 * channel ids.
 */
export type RoutingHint = {
  model: string
  busiest: number
  better: number
  earnsMore: boolean
}

export function routingHints(
  rows: UpstreamModelRow[],
  channels: UpstreamChannel[]
): RoutingHint[] {
  const priority = new Map(channels.map((row) => [row.id, row.priority]))
  const hints: RoutingHint[] = []
  const models = new Map<string, UpstreamModelRow[]>()
  for (const row of rows) {
    models.set(row.model, [...(models.get(row.model) ?? []), row])
  }
  for (const [model, group] of models) {
    const busiest = group.find((row) => row.first)
    if (!busiest || busiest.best.failure || busiest.best.margin) continue
    const marginContested = group.some((row) => row.best.margin)
    const better = group.find(
      (row) =>
        row !== busiest &&
        row.best.failure &&
        (row.best.margin || !marginContested)
    )
    if (!better) continue
    if (
      (priority.get(better.channel_id) ?? 0) >=
      (priority.get(busiest.channel_id) ?? 0)
    ) {
      continue
    }
    hints.push({
      model,
      busiest: busiest.channel_id,
      better: better.channel_id,
      earnsMore: better.best.margin,
    })
  }
  return hints
}
