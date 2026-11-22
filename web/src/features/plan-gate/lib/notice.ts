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
 * CoreCode fork: reading the newcomer plan limit's marks. A log carries the
 * outcome of its own request; the notice counts the last day's.
 */
import type { PlanGateKind, PlanGateNotice } from '../types'

const KINDS: readonly PlanGateKind[] = ['wallet', 'other_plan', 'refused']

/** The outcome a log's `other.limited_plan_gate` names; unknown values read as none. */
export function planGateKindOf(
  other: { limited_plan_gate?: unknown } | null | undefined
): PlanGateKind | null {
  const value = other?.limited_plan_gate
  return KINDS.find((kind) => kind === value) ?? null
}

/** Requests of the last day that cost the customer balance or were turned away. */
export function balanceHitCount(notice: PlanGateNotice | null | undefined) {
  return notice ? notice.wallet + notice.refused : 0
}

/**
 * The banner shows for a customer who holds a guarded plan and had a request
 * charged to the balance or refused in the last day, until they dismiss it.
 */
export function shouldShowPlanGateBanner(
  notice: PlanGateNotice | null | undefined,
  dismissed: boolean
): boolean {
  if (dismissed || !notice || notice.subscription_ids.length === 0) return false
  return balanceHitCount(notice) > 0
}

/** A plan is shown as paused when the limit touched any request of the last day. */
export function isPlanPaused(
  notice: PlanGateNotice | null | undefined,
  subscriptionId: number | undefined
): boolean {
  if (!notice || subscriptionId === undefined) return false
  if (!notice.subscription_ids.includes(subscriptionId)) return false
  return notice.wallet + notice.other_plan + notice.refused > 0
}
