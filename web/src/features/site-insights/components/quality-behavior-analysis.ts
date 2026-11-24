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
// What the model-behavior panel plots and says: the metrics, the models shown
// by default, one line per model, and how a flag reads.

import type { TFunction } from 'i18next'

import { SERIES_COLORS } from '../lib'
import type {
  BehaviorDay,
  BehaviorFlag,
  BehaviorMetric,
  BehaviorModel,
  ModelBehavior,
} from '../types'

/** A day with fewer requests than this is left out of a line, so it breaks. */
export const BEHAVIOR_POINT_SAMPLE = 20

/** The models the panel opens on: the GPT models and Opus. */
export const DEFAULT_BEHAVIOR_MODEL = 'claude-opus-5-5'

/** How a metric's value is drawn, picked from a day. */
export type BehaviorMetricSpec = {
  key: BehaviorMetric | 'cache'
  /** The value of a day, or null when the day has none. */
  pick: (day: BehaviorDay) => number | null
  unit: 'tokens' | 'ms' | 'seconds' | 'share'
}

export const BEHAVIOR_METRICS: BehaviorMetricSpec[] = [
  {
    key: 'output',
    unit: 'tokens',
    pick: (day) => (day.output_p50 > 0 ? day.output_p50 : null),
  },
  {
    key: 'reasoning',
    unit: 'tokens',
    pick: (day) => (day.reasoning_p50 > 0 ? day.reasoning_p50 : null),
  },
  {
    key: 'ttft',
    unit: 'ms',
    pick: (day) => (day.ttft_p50_ms > 0 ? day.ttft_p50_ms : null),
  },
  {
    key: 'latency',
    unit: 'seconds',
    pick: (day) => (day.latency_p50_s > 0 ? day.latency_p50_s : null),
  },
  { key: 'errors', unit: 'share', pick: (day) => day.error_rate },
  { key: 'cache', unit: 'share', pick: (day) => day.cache_share },
]

/** The models shown before a choice is made; the busiest three if none fits. */
export function defaultBehaviorModels(
  models: BehaviorModel[] | undefined
): string[] {
  const list = models ?? []
  const picked = list
    .filter(
      (row) => row.vendor === 'codex' || row.model === DEFAULT_BEHAVIOR_MODEL
    )
    .map((row) => row.model)
  if (picked.length > 0) return picked
  return list.slice(0, 3).map((row) => row.model)
}

/** The line color of the model at an index of the shown models. */
export function behaviorColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]
}

/**
 * One line per shown model: the metric's value per day, null where the day has
 * too few requests (or no sample of that kind) to read.
 */
export function behaviorLines(
  models: BehaviorModel[],
  shown: string[],
  metric: BehaviorMetricSpec
) {
  return models
    .filter((row) => shown.includes(row.model))
    .map((row, index) => ({
      model: row.model,
      color: behaviorColor(index),
      // The palette has four validated colors: a fifth line reuses one and is
      // drawn dashed, so it is not mistaken for the first.
      dashed: index >= SERIES_COLORS.length,
      values: row.daily.map((day) =>
        day.requests >= BEHAVIOR_POINT_SAMPLE || metric.key === 'errors'
          ? metric.pick(day)
          : null
      ),
      flags: row.daily.map((day) =>
        metric.key === 'cache'
          ? undefined
          : day.flags.find((flag) => flag.metric === metric.key)
      ),
    }))
}

/** A change as a signed whole percent: +72%, −70%. */
export function signedPercent(change: number): string {
  const rounded = Math.round(change * 100)
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`
}

/** The alerts of the last day, or none for an older server. */
export function behaviorAlerts(data: ModelBehavior | undefined) {
  return data?.alerts ?? []
}

/** The red alerts of the last day. */
export function redBehaviorAlerts(data: ModelBehavior | undefined) {
  return behaviorAlerts(data).filter((alert) => alert.level === 'red')
}

/** Whether a flag is a rise in the metric. */
export function isRise(flag: BehaviorFlag): boolean {
  return flag.change > 0
}

/** The input band's range, as a short label: "< 2k", "2k–16k", "≥ 64k". */
export function bandLabel(limits: number[], band: number): string {
  const short = (value: number) => `${Math.round(value / 1000)}k`
  if (band <= 0 || limits.length === 0) return ''
  if (band === 1) return `< ${short(limits[0])}`
  if (band > limits.length) return `≥ ${short(limits.at(-1) ?? 0)}`
  return `${short(limits[band - 2])}–${short(limits[band - 1])}`
}

/** The names of the metrics, as the panel and the overview signal print them. */
export function behaviorMetricLabels(
  t: TFunction
): Record<BehaviorMetric | 'cache', string> {
  return {
    output: t('Output length'),
    reasoning: t('Reasoning'),
    ttft: t('First token'),
    latency: t('Total time'),
    errors: t('Upstream errors'),
    cache: t('Cache hit'),
  }
}

/** The last value of a line that has one. */
export function lastValue(values: (number | null)[]): number | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i]
    if (value != null) return value
  }
  return undefined
}
