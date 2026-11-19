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
import { beforeEach, describe, expect, it } from 'vitest'

import type { ApiKey } from '@/features/keys/types'

import {
  canBuyPlan,
  CLAUDE_CODE_GROUP,
  dismissOnboarding,
  EXTERNAL_GROUP,
  isOnboardingDismissed,
  pickOnboardingGroup,
  pickReusableKeys,
  summarizeFunding,
} from '../onboarding'

const key = (fields: Partial<ApiKey>): ApiKey =>
  ({
    id: 1,
    status: 1,
    expired_time: -1,
    unlimited_quota: true,
    remain_quota: 0,
    group: '',
    ...fields,
  }) as ApiKey

const groups = {
  [CLAUDE_CODE_GROUP]: { claude_code_only: true },
  [EXTERNAL_GROUP]: {},
}

describe('pickOnboardingGroup', () => {
  it('gives Claude Code clients the Claude Code only group', () => {
    expect(pickOnboardingGroup(groups, 'claude-code')).toEqual({
      group: CLAUDE_CODE_GROUP,
      fellBack: false,
    })
    expect(pickOnboardingGroup(groups, 'cc-switch').group).toBe(
      CLAUDE_CODE_GROUP
    )
  })

  it('gives agent and OpenAI-compatible clients the external group', () => {
    expect(pickOnboardingGroup(groups, 'agent').group).toBe(EXTERNAL_GROUP)
    expect(pickOnboardingGroup(groups, 'openai').group).toBe(EXTERNAL_GROUP)
  })

  it('falls back to the default group when the account cannot use it', () => {
    expect(pickOnboardingGroup({}, 'agent')).toEqual({
      group: '',
      fellBack: true,
    })
    expect(
      pickOnboardingGroup({ [CLAUDE_CODE_GROUP]: {} }, 'openai').fellBack
    ).toBe(true)
  })
})

describe('pickReusableKeys', () => {
  it('skips disabled, expired and empty keys', () => {
    const keys = [
      key({ id: 1, status: 2 }),
      key({ id: 2, expired_time: 10 }),
      key({ id: 3, unlimited_quota: false, remain_quota: 0 }),
      key({ id: 4, unlimited_quota: false, remain_quota: 5 }),
    ]
    expect(
      pickReusableKeys(keys, groups, 'claude-code').map((k) => k.id)
    ).toEqual([4])
  })

  it('refuses a Claude Code only key for another client, and lists the matching group first', () => {
    const keys = [
      key({ id: 1, group: CLAUDE_CODE_GROUP }),
      key({ id: 2, group: '' }),
      key({ id: 3, group: EXTERNAL_GROUP }),
    ]
    expect(pickReusableKeys(keys, groups, 'openai').map((k) => k.id)).toEqual([
      3, 2,
    ])
    expect(
      pickReusableKeys(keys, groups, 'claude-code').map((k) => k.id)[0]
    ).toBe(1)
  })
})

describe('dismissal', () => {
  beforeEach(() => window.localStorage.clear())

  it('is kept per user', () => {
    expect(isOnboardingDismissed(5)).toBe(false)
    dismissOnboarding(5)
    expect(isOnboardingDismissed(5)).toBe(true)
    expect(isOnboardingDismissed(6)).toBe(false)
  })
})

describe('summarizeFunding', () => {
  const sub = (fields: Record<string, unknown>) => ({
    subscription: {
      status: 'active',
      end_time: 2_000,
      amount_total: 100,
      amount_used: 0,
      ...fields,
    },
  })

  it('is unfunded with an empty wallet and no active plan', () => {
    expect(
      summarizeFunding({
        wallet: 0,
        subscriptions: [sub({ status: 'expired' }), sub({ end_time: 1 })],
        now: 1000,
      })
    ).toEqual({ funded: false, trialQuota: null })
  })

  it('counts the wallet, and names an affiliate gift as the trial', () => {
    expect(
      summarizeFunding({ wallet: 5, subscriptions: [], now: 1000 }).funded
    ).toBe(true)
    expect(
      summarizeFunding({
        wallet: 0,
        subscriptions: [sub({ source: 'affiliate_gift', amount_used: 40 })],
        now: 1000,
      })
    ).toEqual({ funded: true, trialQuota: 60 })
  })
})

describe('canBuyPlan', () => {
  it('honours the per-account purchase limit', () => {
    const plan = { id: 2, enabled: true, max_purchase_per_user: 1 }
    expect(canBuyPlan(plan, [])).toBe(true)
    expect(canBuyPlan(plan, [{ subscription: { plan_id: 2 } }])).toBe(false)
    expect(canBuyPlan({ ...plan, enabled: false }, [])).toBe(false)
  })
})
