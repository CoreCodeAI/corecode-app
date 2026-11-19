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
 * CoreCode fork: the rules of the first-run onboarding wizard that need no
 * React: when it opens, where a dismissal is kept, which group and key fit the
 * client a customer picked, and the text an AI agent is handed.
 */
import type { ApiKey } from '@/features/keys/types'

export const ONBOARDING_CLIENTS = [
  'claude-code',
  'cc-switch',
  'agent',
  'openai',
] as const

export type OnboardingClient = (typeof ONBOARDING_CLIENTS)[number]

/** The group the Claude Code clients use: the cheapest, Claude Code only. */
export const CLAUDE_CODE_GROUP = 'Claude 满血（仅限CC）'
/** The group for everything else that calls Claude. */
export const EXTERNAL_GROUP = 'Claude 满血（可外接）'

/** The plan a new customer can buy once, and the one channel invitees get. */
export const NEWCOMER_PLAN_ID = 2
export const AFFILIATE_GIFT_SOURCE = 'affiliate_gift'

export type GroupInfo = {
  claude_code_only?: boolean
  codex_only?: boolean
}
export type UserGroups = Record<string, GroupInfo>

export function isClaudeCodeClient(client: OnboardingClient): boolean {
  return client === 'claude-code' || client === 'cc-switch'
}

/**
 * The group a key made for `client` starts in. A Claude Code client takes the
 * Claude Code only group, any other client the one that admits other tools.
 * `fellBack` is true when the account cannot use it: the key then uses the
 * account's default group, which an empty name stands for.
 */
export function pickOnboardingGroup(
  groups: UserGroups,
  client: OnboardingClient
): { group: string; fellBack: boolean } {
  const wanted = isClaudeCodeClient(client) ? CLAUDE_CODE_GROUP : EXTERNAL_GROUP
  if (wanted in groups) return { group: wanted, fellBack: false }
  if (isClaudeCodeClient(client)) {
    const only = Object.keys(groups).find(
      (name) => groups[name]?.claude_code_only === true
    )
    if (only) return { group: only, fellBack: false }
  }
  return { group: '', fellBack: true }
}

/** An enabled key that has not expired or run dry. */
export function isUsableKey(key: ApiKey, now = Date.now() / 1000): boolean {
  if (key.status !== 1) return false
  if (key.expired_time !== -1 && key.expired_time < now) return false
  return key.unlimited_quota || key.remain_quota > 0
}

/**
 * The keys that already work for `client`, the ones in the group made for it
 * first. A key in a Claude Code only group refuses every other client, and a
 * Codex only group has no Claude models.
 */
export function pickReusableKeys(
  keys: readonly ApiKey[],
  groups: UserGroups,
  client: OnboardingClient
): ApiKey[] {
  const wanted = pickOnboardingGroup(groups, client).group
  const fits = (key: ApiKey) => {
    const info = key.group ? groups[key.group] : undefined
    if (info?.codex_only) return false
    return isClaudeCodeClient(client) || !info?.claude_code_only
  }
  return keys
    .filter((key) => isUsableKey(key) && fits(key))
    .sort(
      (a, b) =>
        Number((b.group ?? '') === wanted) - Number((a.group ?? '') === wanted)
    )
}

/** localStorage key under which one account's dismissal is kept. */
export function onboardingDismissKey(userId: number): string {
  return `corecode:onboarding-dismissed:${userId}`
}

export function isOnboardingDismissed(userId: number): boolean {
  try {
    return window.localStorage.getItem(onboardingDismissKey(userId)) !== null
  } catch {
    // Storage blocked: ask again next visit rather than never.
    return false
  }
}

export function dismissOnboarding(userId: number): void {
  try {
    window.localStorage.setItem(onboardingDismissKey(userId), '1')
  } catch {
    // Nothing to keep the dismissal in.
  }
}

/**
 * Whether the wallet and the active subscriptions can pay for a request. A
 * subscription with no total is unlimited; one from an affiliate gift is the
 * trial plan channel invitees get at sign-up.
 */
export function summarizeFunding(input: {
  wallet: number
  subscriptions: readonly {
    subscription?: {
      status: string
      end_time: number
      amount_total: number
      amount_used: number
      source?: string
    }
  }[]
  now?: number
}): { funded: boolean; trialQuota: number | null } {
  const now = input.now ?? Date.now() / 1000
  let available = input.wallet
  let trialQuota: number | null = null
  for (const { subscription } of input.subscriptions) {
    if (!subscription || subscription.status !== 'active') continue
    if (subscription.end_time < now) continue
    const total = Number(subscription.amount_total || 0)
    const left =
      total <= 0
        ? Number.POSITIVE_INFINITY
        : Math.max(0, total - Number(subscription.amount_used || 0))
    if (left <= 0) continue
    available += left
    if (subscription.source === AFFILIATE_GIFT_SOURCE) {
      trialQuota = (trialQuota ?? 0) + left
    }
  }
  return { funded: available > 0, trialQuota }
}

/** Whether a customer can still buy a plan, by its per-account limit. */
export function canBuyPlan(
  plan: { id: number; enabled: boolean; max_purchase_per_user: number },
  held: readonly { subscription?: { plan_id: number } }[]
): boolean {
  if (!plan.enabled) return false
  const limit = Number(plan.max_purchase_per_user || 0)
  if (limit <= 0) return true
  const bought = held.filter((s) => s.subscription?.plan_id === plan.id).length
  return bought < limit
}

export function setupDocUrl(baseUrl: string): string {
  return `${baseUrl}/setup.md`
}
