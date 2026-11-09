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
 * CoreCode fork: the balance leads, with its runway and how fast it has been
 * going, so a customer can decide how much to add without leaving the page.
 */
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useBalanceStatus } from '@/features/dashboard/hooks/use-balance-status'
import { useDailySpend } from '@/features/dashboard/hooks/use-customer-overview'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { UserWalletData } from '../types'

const WEEK_DAYS = 7

interface WalletStatsCardProps {
  user: UserWalletData | null
  loading?: boolean
}

export function WalletStatsCard(props: WalletStatsCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const spend = useDailySpend()
  const balance = props.user?.quota ?? 0
  const status = useBalanceStatus(balance, spend.daily)
  const weekSpend = spend.daily
    .slice(-WEEK_DAYS)
    .reduce((sum, day) => sum + day.quota, 0)

  const facts = [
    {
      label: t('Last 7 days'),
      value: formatQuota(weekSpend),
      loading: spend.loading,
    },
    {
      label: t('Total spent'),
      value: formatQuota(props.user?.used_quota ?? 0),
    },
    {
      label: t('Requests'),
      value: formatNumber(props.user?.request_count ?? 0, locale),
    },
  ]

  return (
    <section
      aria-labelledby='wallet-balance-title'
      className='bg-card grid overflow-hidden rounded-2xl border shadow-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'
    >
      <div className='flex min-w-0 flex-col gap-2 p-4 sm:p-5'>
        <div className='flex items-center justify-between gap-2'>
          <h2
            id='wallet-balance-title'
            className='text-muted-foreground font-sans text-sm font-medium tracking-normal'
          >
            {t('Balance')}
          </h2>
          {!props.loading && (
            <span className='text-muted-foreground inline-flex items-center gap-1.5 text-xs'>
              <span
                className={cn('size-1.5 rounded-full', status.dotClassName)}
                aria-hidden
              />
              {status.label}
            </span>
          )}
        </div>
        {props.loading ? (
          <Skeleton className='h-9 w-36' />
        ) : (
          <p className='text-[2.25rem] leading-none font-semibold tracking-tight tabular-nums'>
            {formatQuota(status.available)}
          </p>
        )}
        <div className='text-muted-foreground min-h-4 text-xs'>
          {spend.loading ? (
            <Skeleton className='h-4 w-40' />
          ) : (
            status.runwayText
          )}
        </div>
        {status.subscriptionRemaining > 0 && (
          <div className='text-muted-foreground text-xs'>
            {t('Includes {{amount}} left on your plan', {
              amount: formatQuota(status.subscriptionRemaining),
            })}
          </div>
        )}
      </div>

      <dl className='bg-border grid grid-cols-3 gap-px border-t md:border-t-0 md:border-l'>
        {facts.map((fact) => (
          <div
            key={fact.label}
            className='bg-card flex min-w-0 flex-col justify-center gap-1 px-3 py-4 sm:px-5'
          >
            <dt className='text-muted-foreground text-xs text-balance'>
              {fact.label}
            </dt>
            <dd className='text-base font-semibold break-words tabular-nums sm:text-xl'>
              {props.loading || fact.loading ? (
                <Skeleton className='h-6 w-16' />
              ) : (
                fact.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
