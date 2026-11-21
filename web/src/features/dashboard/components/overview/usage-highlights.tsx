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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getCacheGrade,
  type CacheGrade,
} from '@/features/usage-logs/lib/cost-check'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type {
  DailySpend,
  RecentUsageSummary,
} from '../../lib/customer-overview'

const WEEK_DAYS = 7

const CACHE_GRADE_STYLES: Record<
  CacheGrade,
  { className: string; labelKey: string }
> = {
  good: {
    className: 'bg-success/12 text-success',
    labelKey: 'Cache grade: good',
  },
  fair: {
    className: 'bg-warning/12 text-warning',
    labelKey: 'Cache grade: fair',
  },
  poor: {
    className: 'bg-destructive/10 text-destructive',
    labelKey: 'Cache grade: low',
  },
}

function Highlight(props: {
  label: string
  value: ReactNode
  note: ReactNode
  badge?: ReactNode
  loading?: boolean
}) {
  return (
    <div className='bg-card flex min-w-0 flex-col gap-1.5 px-4 py-4 sm:px-5'>
      <dt className='text-muted-foreground flex items-center justify-between gap-2 text-xs'>
        <span className='truncate'>{props.label}</span>
        {props.badge}
      </dt>
      <dd className='text-2xl leading-tight font-semibold tracking-tight tabular-nums'>
        {props.loading ? <Skeleton className='h-7 w-20' /> : props.value}
      </dd>
      <dd className='text-muted-foreground truncate text-xs'>{props.note}</dd>
    </div>
  )
}

export function UsageHighlights(props: {
  daily: DailySpend[]
  trendLoading: boolean
  recent: RecentUsageSummary
  logsLoading: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const today = props.daily.at(-1)
  const week = props.daily.slice(-WEEK_DAYS)
  const weekSpend = week.reduce((sum, day) => sum + day.quota, 0)
  const weekRequests = week.reduce((sum, day) => sum + day.requests, 0)
  const sampleNote = t('Last {{value}} requests', {
    value: formatNumber(props.recent.requests, locale),
  })
  const noRecent = props.recent.requests === 0

  const hitRate = props.recent.cacheHitRate
  const grade = hitRate === null ? null : getCacheGrade(hitRate)
  const gradeStyle = grade ? CACHE_GRADE_STYLES[grade] : null

  const firstToken = props.recent.avgFirstTokenMs
  const firstTokenText =
    firstToken === null
      ? '—'
      : `${Intl.NumberFormat(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(firstToken / 1000)}s`

  return (
    // gap-px over a border-colored grid draws hairlines between cells at
    // every breakpoint without per-cell border rules.
    <dl className='bg-border grid grid-cols-2 gap-px overflow-hidden rounded-2xl border shadow-xs lg:grid-cols-4'>
      <Highlight
        label={t("Today's spend")}
        value={formatQuota(today?.quota ?? 0)}
        note={t('{{amount}} in the last 7 days', {
          amount: formatQuota(weekSpend),
        })}
        loading={props.trendLoading}
      />
      <Highlight
        label={t("Today's requests")}
        value={formatNumber(today?.requests ?? 0, locale)}
        note={t('{{value}} requests in the last 7 days', {
          value: formatNumber(weekRequests, locale),
        })}
        loading={props.trendLoading}
      />
      <Highlight
        label={t('Cache hit rate')}
        value={
          hitRate === null
            ? '—'
            : Intl.NumberFormat(locale, {
                style: 'percent',
                maximumFractionDigits: 1,
              }).format(hitRate)
        }
        badge={
          gradeStyle && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className={cn(
                        'cursor-help rounded-full px-1.5 py-px text-[11px] font-medium',
                        gradeStyle.className
                      )}
                      tabIndex={0}
                    >
                      {t(gradeStyle.labelKey)}
                    </span>
                  }
                />
                <TooltipContent className='max-w-64'>
                  {t(
                    'Grades by cache hit rate: 80% and above is good, 50% to 80% is fair, below 50% is low.'
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        }
        note={noRecent ? t('No requests yet') : sampleNote}
        loading={props.logsLoading}
      />
      <Highlight
        label={t('Avg. time to first token')}
        value={firstTokenText}
        note={noRecent ? t('No requests yet') : sampleNote}
        loading={props.logsLoading}
      />
    </dl>
  )
}
