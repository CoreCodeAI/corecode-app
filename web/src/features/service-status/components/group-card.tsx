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
import { Activity, Clock, Database, KeyRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  RATE_TONE_CLASS,
  STATE_VARIANT,
  formatLatency,
  formatPeriod,
  formatRate,
  rateTone,
} from '../lib/format'
import { groupVendor } from '../lib/vendor'
import type { BucketState, StatusGroup } from '../types'
import { StatusStrip } from './status-strip'

function Metric(props: {
  icon: ReactNode
  label: string
  note: string
  value: string
  className?: string
}) {
  return (
    <div className='bg-muted/30 flex min-w-0 flex-col gap-1 rounded-xl border p-3'>
      <span className='text-muted-foreground flex min-w-0 items-center gap-1 text-xs'>
        <span className='shrink-0'>{props.icon}</span>
        <span className='truncate'>{props.label}</span>
      </span>
      <span className='text-muted-foreground truncate text-[11px]'>
        {props.note}
      </span>
      <span
        className={cn(
          'truncate text-lg font-semibold tabular-nums sm:text-xl',
          props.className
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

function Tag(props: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={props.title}
      className={cn(
        'inline-flex h-6 max-w-full items-center truncate rounded-full border px-2.5 text-xs',
        props.className
      )}
    >
      {props.children}
    </span>
  )
}

export function GroupCard(props: { group: StatusGroup }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const group = props.group
  const streams = group.latency === 'ttft'
  const provider = groupVendor(group)
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
    <Card className='gap-0 rounded-2xl py-5'>
      <CardContent className='flex flex-col gap-4 px-5'>
        <div className='flex items-start gap-3'>
          <span className='bg-muted/60 flex size-12 shrink-0 items-center justify-center rounded-full border'>
            {provider ? (
              getLobeIcon(provider.icon, 26)
            ) : (
              <span className='text-muted-foreground text-lg font-semibold'>
                {group.name.charAt(0)}
              </span>
            )}
          </span>
          <div className='flex min-w-0 flex-1 flex-col gap-2'>
            <div className='flex items-start justify-between gap-2'>
              <h3 className='min-w-0 truncate text-base leading-6 font-semibold'>
                {group.name}
              </h3>
              <StatusBadge
                label={stateLabel[group.state] ?? t('Unknown')}
                variant={STATE_VARIANT[group.state] ?? 'neutral'}
                showDot
                copyable={false}
                className='shrink-0'
              />
            </div>
            <div className='flex min-w-0 flex-wrap gap-1.5'>
              {provider && (
                <Tag className='border-info/20 bg-info/10 text-info'>
                  {provider.name}
                </Tag>
              )}
              {group.ratio !== null && group.ratio !== undefined && (
                <Tag className='border-warning/30 bg-warning/10 text-warning'>
                  {t('Rate ×{{ratio}}', { ratio: group.ratio })}
                </Tag>
              )}
              {group.model && (
                <Tag className='font-mono' title={group.model}>
                  {group.model}
                </Tag>
              )}
            </div>
          </div>
        </div>
        <div className='grid grid-cols-3 gap-2 sm:gap-3'>
          <Metric
            icon={<Activity className='size-3.5' aria-hidden />}
            label={t('Success rate')}
            note={t('Last 24 hours')}
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
            note={t('Last 24 hours')}
            value={formatLatency(group.p50_ms, locale)}
          />
          <Metric
            icon={<Database className='size-3.5' aria-hidden />}
            label={t('Cache hits')}
            note={t('Last 24 hours')}
            value={streams ? formatRate(group.cache_hit_rate, locale) : '—'}
          />
        </div>
        <StatusStrip
          className='border-t pt-4'
          cells={cells}
          title={t('Last 24 hours')}
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
          aside={
            <Button
              variant='outline'
              size='sm'
              className='shrink-0 rounded-full'
              render={<Link to='/keys' />}
            >
              <KeyRound className='size-4' aria-hidden />
              {t('Create API Key')}
            </Button>
          }
        />
      </CardContent>
    </Card>
  )
}
