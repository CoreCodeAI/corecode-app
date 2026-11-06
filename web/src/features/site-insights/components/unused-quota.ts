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
import type { EngineAccount, EngineRunway } from '../types'

/**
 * Whether the engine's runway projects the pool running short within its
 * horizon: demand at or above what the weekly resets bring back, or a gap in
 * the next seven days. CapacityVerdict reads the same test for "not enough
 * capacity", so the two never disagree.
 */
export function poolRunsShort(runway: EngineRunway | null | undefined) {
  return runway != null && (runway.week_load >= 1 || runway.week_hours != null)
}

/**
 * Waste below the larger of this floor and a share of the account's weekly
 * capacity is rounding in the whole-percent readings, not an account that is
 * falling behind. corecode-engine's pace controller uses the same two numbers
 * to decide which accounts to send more new conversations.
 */
export const UNUSED_FLOOR_USD = 25
export const UNUSED_CAPACITY_SHARE = 0.03

const HOUR_MS = 3_600_000

export type ExpiringAccount = {
  account: EngineAccount
  /** Weekly quota the account leaves at its reset at its current spend rate. */
  unused: number
  /** Hours until that reset. */
  hours: number
  /** What the account would have to spend per hour to use what is left. */
  needed: number | null
}

/**
 * The accounts the engine projects to leave weekly quota behind, worst first.
 * The projection comes from the engine's pool estimate: an engine before it
 * sends none, so every account is skipped and the panel stays out of the way.
 */
export function expiringAccounts(
  accounts: EngineAccount[],
  now: number
): ExpiringAccount[] {
  const rows: ExpiringAccount[] = []
  for (const account of accounts) {
    const unused = account.seven_day_unused_usd
    if (unused == null) continue
    const capacity = account.seven_day_capacity_usd ?? 0
    if (unused < Math.max(UNUSED_FLOOR_USD, UNUSED_CAPACITY_SHARE * capacity)) {
      continue
    }
    const hours =
      account.seven_day_reset_ms > now
        ? (account.seven_day_reset_ms - now) / HOUR_MS
        : 0
    const remaining = account.seven_day_remaining_usd
    rows.push({
      account,
      unused,
      hours,
      needed: remaining != null && hours > 0 ? remaining / hours : null,
    })
  }
  return rows.sort((a, b) => b.unused - a.unused)
}
