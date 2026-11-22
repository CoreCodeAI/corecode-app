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
import { afterEach, describe, expect, it } from 'vitest'

import type { UserSubscriptionRecord } from '@/features/subscriptions/types'

import {
  dismissPlanGateBanner,
  holdsActivePlan,
  readPlanGateDismissed,
} from '../lib/mount'
import {
  balanceHitCount,
  isPlanPaused,
  planGateKindOf,
  shouldShowPlanGateBanner,
} from '../lib/notice'
import type { PlanGateNotice } from '../types'

const notice = (patch: Partial<PlanGateNotice> = {}): PlanGateNotice => ({
  window_seconds: 86400,
  wallet: 0,
  other_plan: 0,
  refused: 0,
  last_at: 0,
  subscription_ids: [5],
  ...patch,
})

describe('the mark a log carries', () => {
  it.each(['wallet', 'other_plan', 'refused'] as const)('reads %s', (kind) => {
    expect(planGateKindOf({ limited_plan_gate: kind })).toBe(kind)
  })

  it('reads nothing from a log the limit did not touch, or a value it never writes', () => {
    expect(planGateKindOf(null)).toBeNull()
    expect(planGateKindOf({})).toBeNull()
    expect(planGateKindOf({ limited_plan_gate: '' })).toBeNull()
    expect(planGateKindOf({ limited_plan_gate: 'banana' })).toBeNull()
    expect(planGateKindOf({ limited_plan_gate: true })).toBeNull()
  })
})

describe('when the banner shows', () => {
  it('shows for a holder with a request charged to the balance', () => {
    expect(shouldShowPlanGateBanner(notice({ wallet: 3 }), false)).toBe(true)
  })

  it('shows for a holder whose request was refused', () => {
    expect(shouldShowPlanGateBanner(notice({ refused: 1 }), false)).toBe(true)
  })

  it('stays away when nothing was charged to the balance', () => {
    expect(shouldShowPlanGateBanner(notice(), false)).toBe(false)
    // Another plan paid: the customer lost nothing.
    expect(shouldShowPlanGateBanner(notice({ other_plan: 9 }), false)).toBe(
      false
    )
  })

  it('stays away without a guarded plan, without a notice, and once dismissed', () => {
    expect(
      shouldShowPlanGateBanner(
        notice({ wallet: 3, subscription_ids: [] }),
        false
      )
    ).toBe(false)
    expect(shouldShowPlanGateBanner(null, false)).toBe(false)
    expect(shouldShowPlanGateBanner(undefined, false)).toBe(false)
    expect(shouldShowPlanGateBanner(notice({ wallet: 3 }), true)).toBe(false)
  })

  it('counts the balance charges and the refusals together', () => {
    expect(
      balanceHitCount(notice({ wallet: 2, refused: 3, other_plan: 7 }))
    ).toBe(5)
    expect(balanceHitCount(null)).toBe(0)
  })
})

describe('when a plan reads as paused', () => {
  it('pauses a guarded plan the limit touched', () => {
    expect(isPlanPaused(notice({ wallet: 1 }), 5)).toBe(true)
    expect(isPlanPaused(notice({ other_plan: 1 }), 5)).toBe(true)
    expect(isPlanPaused(notice({ refused: 1 }), 5)).toBe(true)
  })

  it('leaves a plan alone that the limit does not guard, or never touched', () => {
    expect(isPlanPaused(notice({ wallet: 1 }), 6)).toBe(false)
    expect(isPlanPaused(notice(), 5)).toBe(false)
    expect(isPlanPaused(null, 5)).toBe(false)
    expect(isPlanPaused(notice({ wallet: 1 }), undefined)).toBe(false)
  })
})

describe('what the overview checks before loading the banner', () => {
  afterEach(() => localStorage.clear())

  const record = (status: string, end: number) =>
    ({ subscription: { status, end_time: end } }) as UserSubscriptionRecord

  it('needs an active plan that has not ended', () => {
    expect(holdsActivePlan([record('active', 2_000)], 1_000)).toBe(true)
    expect(holdsActivePlan([record('active', 500)], 1_000)).toBe(false)
    expect(holdsActivePlan([record('expired', 2_000)], 1_000)).toBe(false)
    expect(holdsActivePlan([], 1_000)).toBe(false)
    expect(holdsActivePlan(undefined, 1_000)).toBe(false)
  })

  it('stays dismissed for 24 hours, per account', () => {
    const now = 1_700_000_000_000
    expect(readPlanGateDismissed(7, now)).toBe(false)
    dismissPlanGateBanner(7, now)
    expect(readPlanGateDismissed(7, now + 23 * 3600_000)).toBe(true)
    expect(readPlanGateDismissed(7, now + 25 * 3600_000)).toBe(false)
    expect(readPlanGateDismissed(8, now)).toBe(false)
    expect(readPlanGateDismissed(undefined, now)).toBe(false)
  })
})
