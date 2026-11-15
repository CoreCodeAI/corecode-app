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
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { accountPrice } from '../lib'
import {
  OUTLOOK_WINDOWS,
  type EngineOutlook,
  type EngineOutlookAddition,
  type EngineOutlookModel,
  type EngineOutlookRemaining,
  type EngineOutlookWindow,
  type OutlookModelId,
} from '../types'
import type { InsightsFormat } from './overview-analysis'
import type { Tone } from './shared'

/** How a window's supply stands against its demand. */
export type Coverage = 'enough' | 'tight' | 'short'

/** The forecast the account pool tab opens under, and the capacity verdict reads. */
const DEFAULT_FORECAST: OutlookModelId = 'smart'

// Demand above this share of the supply reads as tight.
const TIGHT_SHARE = 0.8

/** The entry for a window of `hours`, from a list with one per window. */
export function windowOf<T extends { hours: number }>(
  rows: T[] | null | undefined,
  hours: number
): T | undefined {
  return rows?.find((row) => row.hours === hours)
}

/**
 * Short when the projection left demand unserved, which can happen while the
 * supply exceeds the demand: quota that arrives after it was needed. Tight
 * when demand takes most of the supply.
 */
export function coverage(
  window: EngineOutlookWindow | undefined,
  supply: EngineOutlookRemaining | undefined
): Coverage {
  if (!window) return 'enough'
  if (window.short_usd > 0) return 'short'
  if (supply && window.demand_usd > supply.with_resets_usd * TIGHT_SHARE) {
    return 'tight'
  }
  return 'enough'
}

export const COVERAGE_TONES: Record<Coverage, Tone> = {
  enough: 'default',
  tight: 'warning',
  short: 'danger',
}

/**
 * The accounts to add: the more of keeping up with the week's demand and
 * leaving the 7 days without a gap. Null when even the most the server tries
 * leave one.
 */
export function accountsToAdd(addition: EngineOutlookAddition): number | null {
  if (addition.cover_week == null) return null
  return Math.max(addition.keep_up, addition.cover_week)
}

/**
 * The model to show: the one picked when the server could build it, or else
 * the first it could, last in the list first, since the list ends with the
 * forecast that reads the most.
 */
export function pickModel(
  outlook: EngineOutlook,
  picked: OutlookModelId
): EngineOutlookModel | undefined {
  const available = outlook.models.filter((model) => model.available)
  return available.find((model) => model.id === picked) ?? available.at(-1)
}

/** How many leading samples stand within `hours` from now. */
export function samplesWithin(sampleHours: number[], hours: number): number {
  let count = 0
  while (count < sampleHours.length && sampleHours[count] <= hours) count++
  return count
}

/** The index of the sample nearest `hours`; samples are ascending. */
export function nearestSample(sampleHours: number[], hours: number): number {
  let low = 0
  let high = sampleHours.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (sampleHours[middle] <= hours) low = middle
    else high = middle
  }
  return hours - sampleHours[low] <= sampleHours[high] - hours ? low : high
}

/** A window's name: "Next 7 days", or "Next 24 hours" under a week. */
export function windowName(t: TFunction, hours: number): string {
  if (hours === 168) return t('Next 7 days')
  return t('Next {{count}} hours', { count: hours })
}

/** The windows' names, shared by the remaining and forecast panels. */
export function useWindowLabel() {
  const { t } = useTranslation()
  return (hours: number) => windowName(t, hours)
}

const COVERAGE_RANK: Record<Coverage, number> = {
  enough: 0,
  tight: 1,
  short: 2,
}

/**
 * The quota window nearest to binding: the one that is short, else tight,
 * else the one with the largest share of its supply taken. Its addition is
 * the first the forecast offers, as the account pool tab reads it.
 */
export type QuotaBinding = {
  coverage: Coverage
  hours: number
  demand_usd: number
  short_usd: number
  /** Demand over the supply the window has, resets included. */
  share: number
  addition?: EngineOutlookAddition
}

/**
 * The quota binding under the forecast the account pool tab opens under.
 * This is the one definition the capacity verdict, the overview and the
 * account pool tab share. Undefined without a readable outlook.
 */
export function quotaBinding(
  outlook: EngineOutlook | undefined
): QuotaBinding | undefined {
  if (!outlook?.configured || outlook.error) return undefined
  const model = pickModel(outlook, DEFAULT_FORECAST)
  if (!model) return undefined
  let best: QuotaBinding | undefined
  for (const hours of OUTLOOK_WINDOWS) {
    const cell = windowOf(model.windows, hours)
    const supply = windowOf(outlook.remaining, hours)
    if (!cell || !supply) continue
    const row: QuotaBinding = {
      coverage: coverage(cell, supply),
      hours,
      demand_usd: cell.demand_usd,
      short_usd: cell.short_usd,
      share:
        supply.with_resets_usd > 0
          ? cell.demand_usd / supply.with_resets_usd
          : 0,
      addition: model.additions[0],
    }
    if (
      !best ||
      COVERAGE_RANK[row.coverage] > COVERAGE_RANK[best.coverage] ||
      (COVERAGE_RANK[row.coverage] === COVERAGE_RANK[best.coverage] &&
        row.share > best.share)
    ) {
      best = row
    }
  }
  return best
}

/**
 * The sentences that name a tight or short quota: its lead, and the
 * accounts to add, which point to the account pool tab. Only for a binding
 * that is not enough.
 */
export function quotaSentences(
  t: TFunction,
  fmt: InsightsFormat,
  binding: QuotaBinding
): { tone: Tone; lead: string; add: string } {
  const window = windowName(t, binding.hours)
  const lead =
    binding.coverage === 'short'
      ? t('Quota is short: {{window}} leaves {{amount}} of demand unserved.', {
          window,
          amount: fmt.usdWhole(binding.short_usd),
        })
      : t(
          'Quota is the bottleneck: {{window}} demand is {{share}} of supply.',
          {
            window,
            share: fmt.pct(binding.share),
          }
        )
  const item = binding.addition
  const add = item
    ? t('Add {{count}} × {{plan}}, see the account pool tab.', {
        count: accountsToAdd(item) ?? t('over {{count}}', { count: 30 }),
        plan: accountPrice(item.plan, item.tier)?.label ?? item.tier,
      })
    : t('See the account pool tab.')
  return {
    tone: binding.coverage === 'short' ? 'danger' : 'warning',
    lead,
    add,
  }
}

// One color per source of quota, the same in the bar, its legend, the reset
// list and the forecast chart's reset marks.
export const QUOTA_PART_COLORS = {
  held: 'bg-primary',
  five: 'bg-chart-2',
  week: 'bg-chart-3',
}
