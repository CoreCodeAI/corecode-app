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
import { useTranslation } from 'react-i18next'

import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { formatPaymentMoney } from '@/features/wallet/lib'
import { getPaymentMethodName } from '@/features/wallet/lib/billing'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { TopupStats } from '../types'

type TopupSummaryProps = {
  stats: TopupStats | undefined
  loading: boolean
}

export function TopupSummary(props: TopupSummaryProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const stats = props.stats
  const daily = stats?.daily ?? []
  const max = Math.max(0, ...daily.map((day) => day.money))
  const firstDay = daily[0]
  const lastDay = daily.at(-1)
  const dayFormat = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
  })

  const tiles = [
    [t('Top-up revenue'), formatPaymentMoney(stats?.money ?? 0)],
    [t('Successful orders'), formatNumber(stats?.count ?? 0, locale)],
    [t('Paying users'), formatNumber(stats?.user_count ?? 0, locale)],
  ] as const

  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
        <div className='grid content-start gap-3'>
          <dl className='grid grid-cols-3 gap-3'>
            {tiles.map(([label, value]) => (
              <div key={label} className='min-w-0'>
                <dt className='text-muted-foreground truncate text-xs'>
                  {label}
                </dt>
                <dd className='mt-0.5 truncate text-base font-semibold tabular-nums'>
                  {props.loading ? <Skeleton className='h-6 w-16' /> : value}
                </dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className='text-muted-foreground mb-1.5 text-xs'>
              {t('By payment method')}
            </h3>
            {stats && stats.methods.length > 0 ? (
              <ul className='grid gap-1 text-sm'>
                {stats.methods.map((method) => (
                  <li
                    key={method.payment_method}
                    className='flex items-center justify-between gap-2'
                  >
                    <span className='truncate'>
                      {getPaymentMethodName(method.payment_method, t) ||
                        t('Unknown')}
                    </span>
                    <span className='text-muted-foreground shrink-0 tabular-nums'>
                      {formatPaymentMoney(method.money)} ·{' '}
                      {t('{{count}} orders', {
                        count: method.count,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-muted-foreground text-xs'>
                {props.loading ? '…' : t('No successful top-ups in this range')}
              </p>
            )}
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Successful orders paid through a payment gateway. Purchases paid from the wallet balance are not counted.'
            )}
          </p>
        </div>
        {/* Spacing sits inside each bar's trigger, so every pixel across the
            chart opens a day, and the provider opens it without a delay. */}
        <div className='grid min-h-40 grid-rows-[minmax(0,1fr)_auto] gap-1'>
          <TooltipProvider delay={0}>
            <ol
              className='flex items-end'
              aria-label={t('Daily top-up revenue')}
            >
              {daily.map((day) => {
                const label = t('{{date}}: {{amount}}, {{count}} orders', {
                  date: dayFormat.format(new Date(day.day * 1000)),
                  amount: formatPaymentMoney(day.money),
                  count: day.count,
                })
                return (
                  // The item is the trigger itself, so no sub-pixel sliver
                  // between an item's edge and its trigger reads nothing.
                  <TapTooltip key={day.day}>
                    <TapTooltipTrigger
                      render={
                        <li
                          tabIndex={0}
                          aria-label={label}
                          className='group/bar focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-end rounded-sm px-[0.5px] outline-none focus-visible:ring-3 sm:px-0.5'
                        />
                      }
                    >
                      <span
                        className={cn(
                          'w-full rounded-t-[3px] transition-[height] duration-300 ease-out',
                          day.money > 0
                            ? 'bg-primary/40 group-hover/bar:bg-primary group-data-popup-open/bar:bg-primary min-h-1'
                            : 'bg-border min-h-px'
                        )}
                        style={{
                          height: `${max > 0 ? (day.money / max) * 100 : 0}%`,
                        }}
                      />
                    </TapTooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </TapTooltip>
                )
              })}
            </ol>
          </TooltipProvider>
          {/* The range's first and last day, so the bars read as dates. */}
          {firstDay && lastDay && firstDay !== lastDay && (
            <div
              aria-hidden
              className='text-muted-foreground flex justify-between text-[10px] leading-none tabular-nums'
            >
              <span>{dayFormat.format(new Date(firstDay.day * 1000))}</span>
              <span>{dayFormat.format(new Date(lastDay.day * 1000))}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
