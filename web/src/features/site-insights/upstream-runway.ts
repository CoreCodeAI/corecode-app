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
// How long each upstream account's balance lasts at its recent spend.

import type { UpstreamAccount, UpstreamRunway } from './types'

/** An account with fewer days left than this needs a top-up now. */
export const RUNWAY_DANGER_DAYS = 3

/** Fewer than this reads as a warning. */
export const RUNWAY_WARNING_DAYS = 7

export type RunwayTone = 'danger' | 'warning' | 'good' | 'default'

/** The tone of a runway; none without days, which a pool or an unmeasured account has. */
export function runwayTone(days: number | null | undefined): RunwayTone {
  if (days == null || !Number.isFinite(days)) return 'default'
  if (days < RUNWAY_DANGER_DAYS) return 'danger'
  if (days < RUNWAY_WARNING_DAYS) return 'warning'
  return 'good'
}

/** The accounts with a runway, fewest days first; the rest follow, richest balance first. */
export function runwayAccounts(
  runway: UpstreamRunway | undefined
): UpstreamAccount[] {
  return [...(runway?.accounts ?? [])].sort((a, b) => {
    const left = a.days_left ?? Number.POSITIVE_INFINITY
    const right = b.days_left ?? Number.POSITIVE_INFINITY
    return left - right || b.balance - a.balance || a.host.localeCompare(b.host)
  })
}

/** The accounts whose balance runs out within RUNWAY_DANGER_DAYS. */
export function runwayDanger(
  runway: UpstreamRunway | undefined
): UpstreamAccount[] {
  return runwayAccounts(runway).filter(
    (account) => runwayTone(account.days_left) === 'danger'
  )
}

/** Days as a short figure: one place under ten, whole above, and 99+ beyond that. */
export function formatDays(days: number): string {
  if (days >= 99.5) return '99+'
  if (days >= 10) return String(Math.round(days))
  return (Math.round(days * 10) / 10).toString()
}
