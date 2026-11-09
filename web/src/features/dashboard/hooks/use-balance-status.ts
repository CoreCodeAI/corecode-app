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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getSelfSubscriptionFull } from '@/features/subscriptions/api'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { estimateRunwayDays, type DailySpend } from '../lib/customer-overview'
import { isFirstRun } from '../lib/first-run'

/** Days of spend the runway estimate averages over. */
const RUNWAY_WINDOW_DAYS = 7
const LOW_RUNWAY_DAYS = 3

/**
 * `unfunded` is an empty balance on an account that has never spent: a new
 * customer who has not topped up yet, not one who ran out.
 */
export type BalanceHealth = 'healthy' | 'low' | 'empty' | 'unfunded'

const HEALTH: Record<
  BalanceHealth,
  { dotClassName: string; labelKey: string }
> = {
  healthy: { dotClassName: 'bg-success', labelKey: 'Healthy' },
  low: { dotClassName: 'bg-warning', labelKey: 'Low balance' },
  empty: { dotClassName: 'bg-destructive', labelKey: 'Balance depleted' },
  unfunded: {
    dotClassName: 'bg-muted-foreground/50',
    labelKey: 'Not topped up yet',
  },
}

/**
 * What the active subscriptions still cover. A subscription with no total is
 * unlimited until it ends.
 */
export function summarizeSubscriptionQuota(
  records: UserSubscriptionRecord[],
  now = Date.now() / 1000
) {
  let remaining = 0
  let unlimited = false
  for (const { subscription } of records) {
    if (subscription?.status !== 'active' || subscription.end_time < now) {
      continue
    }
    const total = Number(subscription.amount_total || 0)
    if (total <= 0) unlimited = true
    else remaining += Math.max(0, total - Number(subscription.amount_used || 0))
  }
  return { remaining, unlimited }
}

/**
 * How healthy the spendable quota is and how long it lasts at the last
 * week's spend. Requests draw on the wallet and on active subscriptions, so a
 * customer with an empty wallet and a live plan is not out of credit. The
 * overview and the wallet word it the same way.
 */
export function useBalanceStatus(balance: number, daily: DailySpend[]) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const neverSpent = useAuthStore((state) =>
    state.auth.user ? isFirstRun(state.auth.user) : false
  )
  const subscriptionsQuery = useQuery({
    queryKey: ['subscription', 'self'],
    queryFn: async () =>
      requireServerSuccess(await getSelfSubscriptionFull()).data
        ?.subscriptions ?? [],
    staleTime: 60 * 1000,
  })
  const subscription = summarizeSubscriptionQuota(
    Array.isArray(subscriptionsQuery.data) ? subscriptionsQuery.data : []
  )
  const available = balance + subscription.remaining
  const runway = subscription.unlimited
    ? null
    : estimateRunwayDays(available, daily.slice(-RUNWAY_WINDOW_DAYS))

  let health: BalanceHealth = 'healthy'
  if (available <= 0 && !subscription.unlimited) {
    health = neverSpent ? 'unfunded' : 'empty'
  } else if (runway !== null && runway < LOW_RUNWAY_DAYS) health = 'low'

  let runwayText = t('Runway appears after your first requests')
  if (runway !== null) {
    runwayText =
      runway >= 365
        ? t('Lasts over a year at your recent daily spend')
        : t('About {{days}} days at your recent daily spend', {
            days: formatNumber(Math.max(1, Math.floor(runway)), locale),
          })
  }

  return {
    available,
    subscriptionRemaining: subscription.remaining,
    hasSubscription: subscription.unlimited || subscription.remaining > 0,
    health,
    runwayDays: runway,
    dotClassName: HEALTH[health].dotClassName,
    label: t(HEALTH[health].labelKey),
    runwayText,
  }
}
