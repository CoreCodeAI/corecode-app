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
 * CoreCode fork: fourteen daily bars are plain elements rather than a VChart
 * instance. The chart has no axes to configure, follows the theme tokens
 * without a chart theme, and each bar carries its own accessible label.
 */
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import {
  getCacheGrade,
  type CacheGrade,
} from '@/features/usage-logs/lib/cost-check'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  getDailyCacheHitRate,
  type DailySpend,
} from '../../lib/customer-overview'
import { PanelWrapper } from '../ui/panel-wrapper'

type TrendMetric = 'spend' | 'cache'

const CACHE_BAR_CLASS_NAMES: Record<CacheGrade, string> = {
  good: 'bg-success/70 group-hover/bar:bg-success',
  fair: 'bg-warning/70 group-hover/bar:bg-warning',
  poor: 'bg-destructive/60 group-hover/bar:bg-destructive',
}

export function SpendTrendPanel(props: {
  daily: DailySpend[]
  loading: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [metric, setMetric] = useState<TrendMetric>('spend')
  const max = Math.max(0, ...props.daily.map((day) => day.quota))
  const total = props.daily.reduce((sum, day) => sum + day.quota, 0)
  const cacheRead = props.daily.reduce(
    (sum, day) => sum + day.cacheReadTokens,
    0
  )
  const cacheAll =
    cacheRead + props.daily.reduce((sum, day) => sum + day.cacheWriteTokens, 0)
  const percent = (value: number) =>
    Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(value)
  const dayFormat = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
  })
  const lastIndex = props.daily.length - 1
  const showCache = metric === 'cache'

  let description = t('{{amount}} in total', { amount: formatQuota(total) })
  if (showCache) {
    description =
      cacheAll > 0
        ? t('{{rate}} of cached context was reused', {
            rate: percent(cacheRead / cacheAll),
          })
        : t('No cache data in this period yet')
  }

  return (
    <PanelWrapper
      title={
        showCache ? t('Cache hit rate, last 14 days') : t('Spend, last 14 days')
      }
      description={description}
      loading={props.loading}
      empty={!props.loading && max === 0}
      emptyMessage={t('Your daily spend shows here after the first request.')}
      height='h-52'
      className='h-full'
      contentClassName='flex flex-col'
      headerActions={
        <div className='flex items-center gap-1'>
          <Tabs
            value={metric}
            onValueChange={(value) => setMetric(value as TrendMetric)}
          >
            <TabsList aria-label={t('Chart metric')}>
              <TabsTrigger value='spend' className='px-2 text-xs'>
                {t('Spend')}
              </TabsTrigger>
              <TabsTrigger value='cache' className='px-2 text-xs'>
                {t('Cache')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('Details')}
            render={
              <Link to='/dashboard/$section' params={{ section: 'models' }} />
            }
          >
            <ArrowRight />
          </Button>
        </div>
      }
    >
      {/* Each <li> is its day's trigger, spacing included, so every pixel
          across the chart opens a day, on a tap as well as on hover, and the
          provider opens it without a delay. */}
      <TooltipProvider delay={0}>
        <ol
          className='flex min-h-52 flex-1 items-end px-1'
          aria-label={showCache ? t('Daily cache hit rate') : t('Daily spend')}
        >
          {props.daily.map((day, index) => {
            const label = dayFormat.format(new Date(day.day * 1000))
            const amount = formatQuota(day.quota)
            const requests = formatNumber(day.requests, locale)
            const hitRate = getDailyCacheHitRate(day)
            const isToday = index === lastIndex
            let height = max > 0 ? (day.quota / max) * 100 : 0
            let barClassName = cn(
              isToday
                ? 'bg-primary'
                : 'bg-primary/30 group-hover/bar:bg-primary/55',
              day.quota > 0 ? 'min-h-1' : 'bg-border min-h-px'
            )
            let barLabel = t('{{date}}: {{amount}}, {{requests}} requests', {
              date: label,
              amount,
              requests,
            })
            if (showCache) {
              height = hitRate === null ? 0 : hitRate * 100
              barClassName =
                hitRate === null
                  ? 'bg-border min-h-px'
                  : cn('min-h-1', CACHE_BAR_CLASS_NAMES[getCacheGrade(hitRate)])
              barLabel =
                hitRate === null
                  ? t('{{date}}: no cache data', { date: label })
                  : t('{{date}}: {{rate}} cache hit', {
                      date: label,
                      rate: percent(hitRate),
                    })
            }
            return (
              <TapTooltip key={day.day}>
                <TapTooltipTrigger
                  render={
                    <li
                      tabIndex={0}
                      aria-label={barLabel}
                      className='group/bar focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 flex-col rounded-md outline-none focus-visible:ring-3'
                    />
                  }
                >
                  <div className='flex flex-1 items-end px-[3px]'>
                    <span
                      className={cn(
                        'w-full rounded-t-[5px] rounded-b-[2px] transition-[height,background-color] duration-300 ease-out',
                        barClassName
                      )}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  {/* A phone's column is narrower than a date, so every
                      other one is hidden, counting back from today, and the
                      rest spill into their hidden neighbours, not "10...". */}
                  <span
                    className={cn(
                      'text-muted-foreground mt-1.5 truncate text-center text-[10px] tabular-nums max-sm:overflow-visible',
                      (lastIndex - index) % 2 === 1 && 'invisible sm:visible',
                      isToday && 'text-foreground font-medium'
                    )}
                    aria-hidden
                  >
                    {isToday ? t('Today') : label}
                  </span>
                </TapTooltipTrigger>
                <TooltipContent>
                  <div className='flex flex-col gap-0.5 text-xs'>
                    <span className='font-medium'>{label}</span>
                    <span className='tabular-nums'>{amount}</span>
                    <span className='opacity-70'>
                      {t('{{value}} requests', { value: requests })}
                    </span>
                    {hitRate !== null && (
                      <span className='opacity-70'>
                        {t('Cache {{rate}}', { rate: percent(hitRate) })}
                      </span>
                    )}
                  </div>
                </TooltipContent>
              </TapTooltip>
            )
          })}
        </ol>
      </TooltipProvider>
    </PanelWrapper>
  )
}
