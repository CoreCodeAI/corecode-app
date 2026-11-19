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
 * CoreCode fork: says whether the account can pay for its first request. An
 * empty wallet and no active plan means every request ends in "insufficient
 * quota", so the wizard says so before the customer waits for one. A trial
 * plan from a channel invitation counts as funded and is named.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Gift, TriangleAlert, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import { formatPaymentMoney } from '@/features/wallet/lib/format'
import { formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  canBuyPlan,
  NEWCOMER_PLAN_ID,
  summarizeFunding,
} from '../lib/onboarding'

export function FundingNotice() {
  const { t } = useTranslation()
  const wallet = useAuthStore((state) => Number(state.auth.user?.quota ?? 0))
  const subscriptionsQuery = useQuery({
    queryKey: ['onboarding', 'subscriptions'],
    queryFn: async () =>
      requireServerSuccess(await getSelfSubscriptionFull()).data,
    meta: { errorToast: false },
  })
  const plansQuery = useQuery({
    queryKey: ['onboarding', 'plans'],
    queryFn: async () =>
      requireServerSuccess(await getPublicPlans()).data ?? [],
    meta: { errorToast: false },
  })
  const owned = subscriptionsQuery.data
  if (!owned) return null

  const funding = summarizeFunding({
    wallet,
    subscriptions: owned.subscriptions ?? [],
  })
  if (funding.funded && funding.trialQuota === null) return null
  if (funding.funded) {
    return (
      <p className='bg-success/10 text-success border-border/50 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm'>
        <Gift className='mt-0.5 size-4 shrink-0' aria-hidden />
        <span>
          {funding.trialQuota === Number.POSITIVE_INFINITY
            ? t(
                'Your trial plan from the invitation already covers your first requests.'
              )
            : t(
                'Your {{amount}} trial plan from the invitation already covers your first requests.',
                { amount: formatQuota(funding.trialQuota ?? 0) }
              )}
        </span>
      </p>
    )
  }

  const newcomer = (Array.isArray(plansQuery.data) ? plansQuery.data : [])
    .map((record) => record.plan)
    .find(
      (plan) =>
        plan.id === NEWCOMER_PLAN_ID &&
        canBuyPlan(plan, owned.all_subscriptions ?? [])
    )

  return (
    <div
      role='alert'
      className='bg-warning/10 border-border/50 flex flex-col gap-3 rounded-xl border px-3.5 py-3 text-sm'
    >
      <p className='text-warning flex items-start gap-2'>
        <TriangleAlert className='mt-0.5 size-4 shrink-0' aria-hidden />
        <span>
          {t(
            'Your balance is empty, so requests fail with insufficient quota until you add credits.'
          )}
        </span>
      </p>
      <div className='flex flex-wrap gap-2'>
        <Button size='sm' render={<Link to='/wallet' />}>
          <Wallet data-icon='inline-start' />
          {t('Add credits')}
        </Button>
        {newcomer && (
          <Button size='sm' variant='outline' render={<Link to='/wallet' />}>
            <Gift data-icon='inline-start' />
            {t('Get {{title}} · {{price}}', {
              title: newcomer.title,
              price: formatPaymentMoney(Number(newcomer.price_amount)),
            })}
          </Button>
        )}
      </div>
    </div>
  )
}
