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
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  ChevronRight,
  Gift,
  ShieldCheck,
  Tags,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSelf } from '@/hooks/use-self'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { useBalanceStatus } from '../../hooks/use-balance-status'
import type { DailySpend } from '../../lib/customer-overview'

const QUICK_LINKS: {
  to: '/pricing' | '/wallet' | '/security'
  labelKey: string
  icon: LucideIcon
}[] = [
  { to: '/pricing', labelKey: 'Model pricing', icon: Tags },
  { to: '/wallet', labelKey: 'Redeem a code', icon: Gift },
  { to: '/security', labelKey: 'Security & Access', icon: ShieldCheck },
]

export function BalanceCard(props: { daily: DailySpend[]; loading: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)
  useSelf()
  const balance = Number(user?.quota ?? 0)
  const used = Number(user?.used_quota ?? 0)
  const requests = Number(user?.request_count ?? 0)
  const today = props.daily.at(-1)?.quota ?? 0
  const status = useBalanceStatus(balance, props.daily)

  return (
    <section
      aria-labelledby='overview-balance-title'
      className='bg-card flex h-full min-w-0 flex-col rounded-2xl border p-4 shadow-xs sm:p-5'
    >
      <div className='flex items-center justify-between gap-2'>
        <h2
          id='overview-balance-title'
          className='text-muted-foreground font-sans text-sm font-medium tracking-normal'
        >
          {t('Balance')}
        </h2>
        <span className='text-muted-foreground inline-flex items-center gap-1.5 text-xs'>
          <span
            className={cn('size-1.5 rounded-full', status.dotClassName)}
            aria-hidden
          />
          {status.label}
        </span>
      </div>

      <p className='mt-2 text-[2.25rem] leading-none font-semibold tracking-tight tabular-nums'>
        {formatQuota(status.available)}
      </p>
      <div className='text-muted-foreground mt-2 min-h-5 text-xs'>
        {props.loading ? <Skeleton className='h-4 w-40' /> : status.runwayText}
      </div>
      {status.subscriptionRemaining > 0 && (
        <div className='text-muted-foreground text-xs'>
          {t('Includes {{amount}} left on your plan', {
            amount: formatQuota(status.subscriptionRemaining),
          })}
        </div>
      )}

      <div className='mt-5 flex flex-wrap gap-2'>
        <Button render={<Link to='/wallet' />}>
          <Wallet data-icon='inline-start' />
          {t('Add credits')}
        </Button>
        <Button
          variant='ghost'
          render={
            <Link to='/usage-logs/$section' params={{ section: 'common' }} />
          }
        >
          {t('Usage Logs')}
          <ArrowRight data-icon='inline-end' />
        </Button>
      </div>

      <nav aria-label={t('Shortcuts')} className='mt-5 mb-4'>
        <ul className='divide-border/70 -mx-2 divide-y'>
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon
            return (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className='hover:bg-accent focus-visible:ring-ring/50 group flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors outline-none focus-visible:ring-3'
                >
                  <Icon className='text-muted-foreground size-4' aria-hidden />
                  <span className='flex-1'>{t(link.labelKey)}</span>
                  <ChevronRight
                    className='text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5'
                    aria-hidden
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <dl className='[&_dt]:text-muted-foreground mt-auto grid grid-cols-3 gap-3 border-t pt-4 [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-medium [&_dd]:tabular-nums [&_dt]:text-xs'>
        <div className='min-w-0'>
          <dt>{t('Today')}</dt>
          <dd className='truncate'>
            {props.loading ? (
              <Skeleton className='h-5 w-14' />
            ) : (
              formatQuota(today)
            )}
          </dd>
        </div>
        <div className='min-w-0'>
          <dt>{t('Total spent')}</dt>
          <dd className='truncate'>{formatQuota(used)}</dd>
        </div>
        <div className='min-w-0'>
          <dt>{t('Requests')}</dt>
          <dd className='truncate'>{formatNumber(requests, locale)}</dd>
        </div>
      </dl>
    </section>
  )
}
