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
 * CoreCode fork: the checks the overview makes before it loads the plan
 * limit banner. They need no text, so the overview can import them without
 * pulling the banner's strings into its first load.
 */
import { isDismissedWithin } from '@/features/dashboard/lib/customer-overview'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'

const DISMISS_KEY = 'plan-gate:banner-dismissed-at:'

export function readPlanGateDismissed(
  userId: number | undefined,
  now = Date.now()
): boolean {
  if (userId === undefined) return false
  try {
    return isDismissedWithin(
      Number(localStorage.getItem(DISMISS_KEY + userId)) || null,
      now
    )
  } catch {
    return false
  }
}

export function dismissPlanGateBanner(userId: number, now = Date.now()): void {
  try {
    localStorage.setItem(DISMISS_KEY + userId, String(now))
  } catch {
    // Storage is blocked: the banner hides for this visit only.
  }
}

/** A customer with no active plan has nothing the limit could pause. */
export function holdsActivePlan(
  records: readonly UserSubscriptionRecord[] | undefined,
  now = Date.now() / 1000
): boolean {
  return (records ?? []).some(
    ({ subscription }) =>
      subscription?.status === 'active' && subscription.end_time > now
  )
}
