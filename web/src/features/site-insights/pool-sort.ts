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
import type { EngineAccount } from './types'

/**
 * Orders for the pool's account table. `schedule` estimates the engine's own
 * order under its quota_balanced strategy; the rest sort by one figure.
 */
export const POOL_SORT_KEYS = [
  'schedule',
  'account',
  'status',
  'active',
  'sessions',
  'five',
  'five_left',
  'five_reset',
  'seven',
  'seven_left',
  'seven_reset',
  'week_unused',
  'capacity',
  'weight',
  'burn',
  'last_used',
  'failures',
  'renewal',
] as const

export type PoolSortKey = (typeof POOL_SORT_KEYS)[number]
export type PoolSortDir = 'asc' | 'desc'
export type PoolSort = { key: PoolSortKey; dir: PoolSortDir }

/** Keys that read a Claude quota window, or the engine's Claude estimate. */
export const CLAUDE_ONLY_SORTS = new Set<PoolSortKey>([
  'schedule',
  'five',
  'five_left',
  'five_reset',
  'seven',
  'seven_left',
  'seven_reset',
  'week_unused',
])

/**
 * The direction a key sorts in when it is first picked: what an operator
 * looks for first, such as the most quota left or the soonest reset.
 */
export const POOL_SORT_DEFAULT_DIR: Record<PoolSortKey, PoolSortDir> = {
  schedule: 'asc',
  account: 'asc',
  status: 'asc',
  active: 'desc',
  sessions: 'desc',
  five: 'desc',
  five_left: 'desc',
  five_reset: 'asc',
  seven: 'desc',
  seven_left: 'desc',
  seven_reset: 'asc',
  week_unused: 'desc',
  capacity: 'desc',
  weight: 'desc',
  burn: 'desc',
  last_used: 'desc',
  failures: 'desc',
  renewal: 'asc',
}

/** The engine's weight for an account with none set. */
export const DEFAULT_WEIGHT = 50

/** The weights the pool page offers: ×0.5, ×1, ×1.5 and ×2. */
export const WEIGHT_PRESETS = [25, 50, 75, 100] as const

export function weightLabel(weight: number): string {
  return `×${Number((weight / DEFAULT_WEIGHT).toFixed(2))}`
}

/** How many times its quota's share of new conversations the account takes. */
export function weightFactor(row: EngineAccount): number {
  return (row.weight ?? DEFAULT_WEIGHT) / DEFAULT_WEIGHT
}

/** The engine's QuotaHeadroomScale. */
const HEADROOM_SCALE = 1_000_000_000
const WEEK_HOURS = 7 * 24

/** Quota budget thresholds in percent; 0 when the budget is off. */
export type HeadroomBudget = { five: number; seven: number }

/**
 * corecode-engine's QuotaHeadroom for one account, from the figures the pool
 * page reads (internal/state/quota_balance.go):
 *
 *   fiveShare² × (weekCeiling − week) / hours until the weekly reset
 *     × capacity × weight / 50
 *
 * The ceilings are the budget's thresholds, or 100% with the budget off. A
 * window past its reset counts as unused, hours are held between 1 and 168,
 * and an unknown capacity counts as 1. The manual weight is the engine's
 * scheduledCapacity (internal/scheduler/scheduler.go). The result is at least 1.
 */
export function quotaHeadroom(
  row: EngineAccount,
  budget: HeadroomBudget,
  now: number
): number {
  const on = budget.five > 0 && budget.seven > 0
  const fiveCeiling = on ? budget.five / 100 : 1
  const weekCeiling = on ? budget.seven / 100 : 1
  const current = (percent: number, resetMs: number) => {
    if (resetMs <= 0) return { used: percent / 100, resetMs: 0 }
    if (resetMs <= now) return { used: 0, resetMs: 0 }
    return { used: percent / 100, resetMs }
  }
  const five = current(row.five_hour ?? 0, row.five_hour_reset_ms ?? 0)
  const week = current(row.seven_day ?? 0, row.seven_day_reset_ms ?? 0)
  const hours = week.resetMs
    ? Math.min(Math.max((week.resetMs - now) / 3_600_000, 1), WEEK_HOURS)
    : WEEK_HOURS
  const fiveShare = Math.max(0, fiveCeiling - five.used) / fiveCeiling
  let score =
    (fiveShare * fiveShare * Math.max(0, weekCeiling - week.used)) / hours
  const capacity = row.capacity_weight ?? 0
  score *= (capacity > 0 ? capacity : 1) * weightFactor(row)
  return Math.max(1, Math.floor(score * HEADROOM_SCALE))
}

/**
 * The engine's order for a new session within one group: schedulable accounts
 * first, then the fewest pinned sessions per unit of headroom, then the lowest
 * share of the concurrency limit in use. Affinity, the avoided organization
 * and the round-robin tie-breaks are left out: they depend on the request.
 * Returns a negative number when a comes first.
 */
export function compareSchedule(
  a: EngineAccount,
  b: EngineAccount,
  headroom: (row: EngineAccount) => number
): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
  const load = (a.sessions + 1) * headroom(b) - (b.sessions + 1) * headroom(a)
  // Every account shares one concurrency limit, so its share in use orders
  // as the requests in flight do.
  return load || a.active - b.active
}

/**
 * Each schedulable account's place in its group's order, from 1; an account
 * the engine would not schedule has none.
 */
export function scheduleRanks(
  rows: EngineAccount[],
  headroom: (row: EngineAccount) => number
): Map<number, number> {
  const byGroup = new Map<number, EngineAccount[]>()
  for (const row of rows) {
    if (!row.eligible) continue
    const list = byGroup.get(row.group_id) ?? []
    list.push(row)
    byGroup.set(row.group_id, list)
  }
  const ranks = new Map<number, number>()
  for (const list of byGroup.values()) {
    list
      .sort(
        (a, b) =>
          compareSchedule(a, b, headroom) || a.credential_id - b.credential_id
      )
      .forEach((row, index) => ranks.set(row.credential_id, index + 1))
  }
  return ranks
}

type Context = {
  headroom: (row: EngineAccount) => number
  ranks: Map<number, number>
  /** Groups in the order the page lists them. */
  groupOrder: Map<number, number>
  /** Sorts status labels, so the order follows the reader's language. */
  statusLabel: (status: string) => string
}

/** The figure a key sorts by; null sorts last in either direction. */
function sortValue(
  row: EngineAccount,
  key: PoolSortKey,
  ctx: Context
): number | string | null {
  const positive = (value: number | null | undefined) =>
    value && value > 0 ? value : null
  switch (key) {
    case 'schedule':
      return null // compared separately
    case 'account':
      return row.credential_id
    case 'status':
      return ctx.statusLabel(row.status)
    case 'active':
      return row.active
    case 'sessions':
      return row.sessions
    case 'five':
      return row.five_hour
    case 'five_left':
      return row.five_hour_remaining_usd ?? null
    case 'five_reset':
      return positive(row.five_hour_reset_ms)
    case 'seven':
      return row.seven_day
    case 'seven_left':
      return row.seven_day_remaining_usd ?? null
    case 'seven_reset':
      return positive(row.seven_day_reset_ms)
    case 'week_unused':
      return row.seven_day_unused_usd ?? null
    case 'capacity':
      return positive(row.capacity_weight)
    case 'weight':
      return row.weight ?? null
    case 'burn':
      return row.burn_usd_per_hour ?? null
    case 'last_used':
      return positive(row.last_used_at_ms)
    case 'failures':
      return row.failures
    case 'renewal':
      return positive(row.subscription_period_end_ms)
  }
}

/**
 * Sorts the accounts by one key. Ties fall back to the account id, so a
 * refresh does not reshuffle equal rows. The schedule order lists schedulable
 * accounts by group and then by their place in the group; the rest follow by
 * status.
 */
export function sortPoolAccounts(
  rows: EngineAccount[],
  sort: PoolSort,
  ctx: Context
): EngineAccount[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.key === 'schedule') {
      const ra = ctx.ranks.get(a.credential_id)
      const rb = ctx.ranks.get(b.credential_id)
      if ((ra == null) !== (rb == null)) return ra == null ? 1 : -1
      if (ra != null && rb != null) {
        const ga = ctx.groupOrder.get(a.group_id) ?? 0
        const gb = ctx.groupOrder.get(b.group_id) ?? 0
        return sign * (ga - gb || ra - rb) || a.credential_id - b.credential_id
      }
      return (
        ctx.statusLabel(a.status).localeCompare(ctx.statusLabel(b.status)) ||
        a.credential_id - b.credential_id
      )
    }
    const va = sortValue(a, sort.key, ctx)
    const vb = sortValue(b, sort.key, ctx)
    if (va == null || vb == null) {
      if (va != null) return -1
      if (vb != null) return 1
      return a.credential_id - b.credential_id
    }
    const diff =
      typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb))
        : va - vb
    return sign * diff || a.credential_id - b.credential_id
  })
}
