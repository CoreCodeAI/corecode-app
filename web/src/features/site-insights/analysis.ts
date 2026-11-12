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
// Pure analysis the tabs share: open hours, baselines, spikes, what drove a
// change, and whether a rate rests on enough events to judge.

import type { BarPoint, Tone } from './components/shared'
import type { InsightsTab } from './lib'

const HOUR = 3600

/** The hour is still filling: it ends after the range does. */
export function isOpenHour(hour: number, end: number): boolean {
  return hour + HOUR > end
}

/** The rows whose hour has ended by the range's end. */
export function closedHours<T extends { hour: number }>(
  rows: T[],
  end: number
): T[] {
  return rows.filter((row) => !isOpenHour(row.hour, end))
}

/**
 * For each current row, the previous period's row at the same point of its
 * range (hour - span), or undefined when the previous period has none.
 */
export function alignPrevious<T extends { hour: number }>(
  current: { hour: number }[],
  previous: T[] | null | undefined,
  span: number
): (T | undefined)[] {
  const byHour = new Map((previous ?? []).map((row) => [row.hour, row]))
  return current.map((row) => byHour.get(row.hour - span))
}

/** The middle value, the mean of the middle two for an even count; 0 when empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * The indexes whose value is at least floor and at least factor times its
 * baseline. A missing or zero baseline falls back to the median of the other
 * values; when that is 0 too, a value flags only at floor * factor or more.
 */
export function findSpikes(
  values: number[],
  baselines: (number | null | undefined)[],
  options: { factor: number; floor: number }
): number[] {
  const spikes: number[] = []
  values.forEach((value, index) => {
    if (value < options.floor) return
    let baseline = baselines[index] ?? 0
    if (baseline <= 0) {
      baseline = median(values.filter((_, other) => other !== index))
    }
    const flagged =
      baseline > 0
        ? value >= options.factor * baseline
        : value >= options.floor * options.factor
    if (flagged) spikes.push(index)
  })
  return spikes
}

/** One part's figure in both periods and how much it moved. */
export type Contribution = {
  key: string
  current: number
  previous: number
  change: number
}

function sumBy<T>(
  rows: T[] | null | undefined,
  key: (row: T) => string,
  value: (row: T) => number
): Map<string, number> {
  const sums = new Map<string, number>()
  for (const row of rows ?? []) {
    const name = key(row)
    sums.set(name, (sums.get(name) ?? 0) + value(row))
  }
  return sums
}

function byChange(a: Contribution, b: Contribution): number {
  return Math.abs(b.change) - Math.abs(a.change) || a.key.localeCompare(b.key)
}

/**
 * Each part's move between the periods, keys on one side only included,
 * largest absolute change first; parts that did not move are dropped. Rows
 * that share a key are summed.
 */
export function contributions<T>(
  current: T[] | null | undefined,
  previous: T[] | null | undefined,
  key: (row: T) => string,
  value: (row: T) => number
): Contribution[] {
  const now = sumBy(current, key, value)
  const before = sumBy(previous, key, value)
  const keys = new Set([...now.keys(), ...before.keys()])
  return [...keys]
    .map((name) => {
      const a = now.get(name) ?? 0
      const b = before.get(name) ?? 0
      return { key: name, current: a, previous: b, change: a - b }
    })
    .filter((row) => row.change !== 0)
    .sort(byChange)
}

/**
 * Each part's contribution to the change of an overall rate, such as the
 * failure rate, in rate points: its events over the whole period's total,
 * now against before. current and previous are those shares; the changes
 * sum to the overall rate's change. Parts that did not move are dropped.
 */
export function rateContributions<T>(
  current: T[] | null | undefined,
  previous: T[] | null | undefined,
  key: (row: T) => string,
  events: (row: T) => number,
  total: (row: T) => number
): Contribution[] {
  const totalOf = (rows: T[] | null | undefined) =>
    (rows ?? []).reduce((sum, row) => sum + total(row), 0)
  const totalNow = totalOf(current)
  const totalBefore = totalOf(previous)
  const now = sumBy(current, key, events)
  const before = sumBy(previous, key, events)
  const keys = new Set([...now.keys(), ...before.keys()])
  return [...keys]
    .map((name) => {
      const a = totalNow > 0 ? (now.get(name) ?? 0) / totalNow : 0
      const b = totalBefore > 0 ? (before.get(name) ?? 0) / totalBefore : 0
      return { key: name, current: a, previous: b, change: a - b }
    })
    .filter((row) => row.change !== 0)
    .sort(byChange)
}

// The normal quantile of a two-sided 95% interval.
const Z95 = 1.959964

/** The lower end of the Wilson 95% interval of events / total; 0 when total is 0. */
export function wilsonLower(events: number, total: number): number {
  if (total <= 0) return 0
  const p = events / total
  const z2 = Z95 * Z95
  const centre = p + z2 / (2 * total)
  const margin =
    Z95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))
  return Math.max(0, (centre - margin) / (1 + z2 / total))
}

/**
 * The rate events / total is above baseline beyond small-sample chance:
 * its Wilson 95% lower bound is. False when total is 0.
 */
export function rateIsAbove(
  events: number,
  total: number,
  baseline: number
): boolean {
  if (total <= 0) return false
  return wilsonLower(events, total) > baseline
}

/** The least-squares slope per step of evenly spaced values; 0 under two points. */
export function linearSlope(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const meanX = (n - 1) / 2
  const meanY = values.reduce((sum, value) => sum + value, 0) / n
  let numerator = 0
  let denominator = 0
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY)
    denominator += (index - meanX) ** 2
  })
  return numerator / denominator
}

/** A figure over days, scaled to `to` days (a month by default); 0 without days. */
export function runRate(value: number, days: number, to = 30): number {
  if (days <= 0) return 0
  return (value / days) * to
}

/**
 * The one or two parts that drove a total change: of the parts that moved
 * the same way as the total, the largest, or the largest two, that together
 * make up at least share of it. Empty when the total did not move or no
 * such pair explains it.
 */
export function dominant(
  parts: Contribution[],
  total: number,
  share = 0.5
): Contribution[] {
  if (total === 0) return []
  const need = Math.abs(total) * share
  const sameWay = parts
    .filter((part) => Math.sign(part.change) === Math.sign(total))
    .sort(byChange)
  const [first, second] = sameWay
  if (!first) return []
  if (Math.abs(first.change) >= need) return [first]
  if (second && Math.abs(first.change + second.change) >= need) {
    return [first, second]
  }
  return []
}

/** How an hour reads on a bar series: its full title, and an axis label where the viewer's day starts. */
export type HourAxis = {
  title: (hour: number) => string
  axis: (hour: number) => string | undefined
}

/** What one hourly row draws: its stacked values, further readout rows, and a tone that flags it. */
export type HourBar = {
  values: number[]
  extra?: { label: string; value: string }[]
  tone?: Tone
}

/**
 * Hourly rows as bar points: keyed and titled by hour, the axis labelled
 * where the viewer's day starts, the open hour faded.
 */
export function hourBars<T extends { hour: number }>(
  rows: T[] | null | undefined,
  end: number,
  build: (row: T, index: number) => HourBar,
  axis: HourAxis
): BarPoint[] {
  return (rows ?? []).map((row, index) => {
    const bar = build(row, index)
    return {
      key: row.hour,
      title: axis.title(row.hour),
      axis: axis.axis(row.hour),
      values: bar.values,
      extra: bar.extra,
      tone: bar.tone,
      faded: isOpenHour(row.hour, end),
    }
  })
}

/** One thing a reader should know, linked to where they act on it. */
export type Finding = {
  key: string
  tone: 'danger' | 'warning' | 'good' | 'default'
  title: string
  detail?: string
  /** The tab that explains it. */
  tab?: InsightsTab
  /** A page outside the tabs, used when there is no tab. */
  href?: string
  /** Requests or money it touches; within a tone, the largest leads. */
  impact?: number
}

const FINDING_ORDER: Finding['tone'][] = [
  'danger',
  'warning',
  'default',
  'good',
]

/** Findings in reading order: by tone, danger first, then by impact; ties keep their order. */
export function sortFindings(items: Finding[]): Finding[] {
  return [...items].sort(
    (a, b) =>
      FINDING_ORDER.indexOf(a.tone) - FINDING_ORDER.indexOf(b.tone) ||
      (b.impact ?? 0) - (a.impact ?? 0)
  )
}
