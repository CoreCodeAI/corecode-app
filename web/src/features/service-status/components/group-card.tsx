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
import { Activity, Clock, Database } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import {
  RATE_TONE_CLASS,
  STATE_VARIANT,
  formatLatency,
  formatPeriod,
  formatRate,
  rateTone,
} from '../lib/format'
import type { BucketState, StatusGroup } from '../types'
import { StatusStrip } from './status-strip'

function Metric(props: {
  icon: ReactNode
  label: string
  value: string
  className?: string
}) {
  return (
    <div className='flex min-w-0 flex-col gap-0.5'>
      <span className='text-muted-foreground flex items-center gap-1 text-xs'>
        {props.icon}
        {props.label}
      </span>
      <span
        className={cn(
          'truncate text-base font-semibold tabular-nums',
          props.className
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

export function GroupCard(props: { group: StatusGroup }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const group = props.group
  const streams = group.latency === 'ttft'
  const stateLabel: Record<BucketState, string> = {
    ok: t('Normal'),
    degraded: t('Degraded'),
    outage: t('Failing'),
    none: t('Idle'),
  }
  const lastSeen = [...group.buckets]
    .reverse()
    .find((bucket) => bucket.state !== 'none')
  const cells = group.buckets.map((bucket) => {
    const parts =
      bucket.state === 'none'
        ? [t('No requests')]
        : [
            `${t('Success rate')} ${formatRate(bucket.success_rate, locale)}`,
            `${t('Latency')} ${formatLatency(bucket.p50_ms, locale)}`,
            streams
              ? `${t('Cache')} ${formatRate(bucket.cache_hit_rate, locale)}`
              : null,
          ]
    return {
      key: bucket.t,
      state: bucket.state,
      title: formatPeriod(bucket.t, 3600, locale),
      detail: parts.filter(Boolean).join(' · '),
    }
  })

  return (
    <Card className='gap-4'>
      <CardHeader className='gap-2'>
        <div className='flex items-start justify-between gap-2'>
          <CardTitle className='min-w-0 truncate text-base'>
            {group.name}
          </CardTitle>
          <StatusBadge
            label={stateLabel[group.state] ?? t('Unknown')}
            variant={STATE_VARIANT[group.state] ?? 'neutral'}
            showDot
            copyable={false}
          />
        </div>
        <div className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs'>
          {group.ratio !== null && group.ratio !== undefined && (
            <span>{t('Rate ×{{ratio}}', { ratio: group.ratio })}</span>
          )}
          {group.model && (
            <span className='truncate font-mono' title={group.model}>
              {group.model}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='grid grid-cols-3 gap-3'>
          <Metric
            icon={<Activity className='size-3.5' aria-hidden />}
            label={t('Success rate')}
            value={formatRate(group.success_rate, locale)}
            className={RATE_TONE_CLASS[rateTone(group.success_rate)]}
          />
          <Metric
            icon={<Clock className='size-3.5' aria-hidden />}
            label={
              group.latency === 'total'
                ? t('Request duration')
                : t('First token')
            }
            value={formatLatency(group.p50_ms, locale)}
          />
          <Metric
            icon={<Database className='size-3.5' aria-hidden />}
            label={t('Cache hits')}
            value={streams ? formatRate(group.cache_hit_rate, locale) : '—'}
          />
        </div>
        <StatusStrip
          cells={cells}
          label={t('{{name}}: success rate each hour over the last 24 hours', {
            name: group.name,
          })}
          startLabel={t('24 hours ago')}
          endLabel={t('Now')}
          summary={
            lastSeen
              ? t('Last requests {{period}}', {
                  period: formatPeriod(lastSeen.t, 3600, locale),
                })
              : t('No requests in 24 hours')
          }
        />
      </CardContent>
    </Card>
  )
}
