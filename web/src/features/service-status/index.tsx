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
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import { SERVICE_STATUS_QUERY_KEY, getServiceStatus } from './api'
import { GroupCard } from './components/group-card'
import { StatusStrip } from './components/status-strip'
import {
  BUCKET_CLASS,
  STALE_AFTER_S,
  formatClock,
  formatLatency,
  formatPeriod,
  formatRate,
  stripSummary,
} from './lib/format'
import type { OverallStatus, StatusStripData } from './types'

type BannerState = OverallStatus | 'unknown'

const BANNER: Record<BannerState, { icon: LucideIcon; tone: string }> = {
  operational: { icon: CircleCheck, tone: 'text-success' },
  degraded: { icon: CircleAlert, tone: 'text-warning' },
  outage: { icon: CircleX, tone: 'text-destructive' },
  unknown: { icon: CircleHelp, tone: 'text-muted-foreground' },
}

function Stat(props: { label: string; value: string; note?: string }) {
  return (
    <div className='flex min-w-0 flex-col gap-0.5'>
      <span className='text-muted-foreground text-xs'>{props.label}</span>
      <span className='text-lg font-semibold tabular-nums'>{props.value}</span>
      {props.note && (
        <span className='text-muted-foreground text-xs'>{props.note}</span>
      )}
    </div>
  )
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-base font-semibold'>{props.title}</h2>
      {props.children}
    </section>
  )
}

export function ServiceStatus() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: SERVICE_STATUS_QUERY_KEY,
    queryFn: getServiceStatus,
    refetchInterval: 60_000,
    retry: 1,
  })

  const levels: Record<OverallStatus, [string, string, string]> = {
    operational: [
      t('All systems operational'),
      t('The API is handling requests normally.'),
      t('Fully available'),
    ],
    degraded: [
      t('Partially degraded'),
      t('Some requests may fail or be slow. We are working on it.'),
      t('Partly available'),
    ],
    outage: [
      t('Service outage'),
      t('The API cannot handle requests right now. We are working on it.'),
      t('Not available'),
    ],
  }

  const snapshot = query.data
  const data = snapshot?.data
  const age = snapshot
    ? Math.round(snapshot.serverNow / 1000 - snapshot.data.generated_at)
    : 0
  const stale = age > STALE_AFTER_S
  const level = data && !stale ? levels[data.status] : undefined

  let banner: BannerState = 'unknown'
  let headline = t('Status unknown')
  let subline = ''
  if (query.isError && !data) {
    subline = t(
      'Monitoring data cannot be read right now, so the current status cannot be confirmed. Refresh later to retry.'
    )
  } else if (data && stale) {
    subline = t(
      'Monitoring data has not updated for {{minutes}} minutes, so the current status cannot be confirmed. The history below ends at {{time}}.',
      {
        minutes: Math.floor(age / 60),
        time: formatClock(data.generated_at, locale, true),
      }
    )
  } else if (data && level) {
    banner = data.status
    headline = level[0]
    subline = data.maintenance
      ? t('An update is rolling out; a few requests may need a retry.')
      : level[1]
  } else if (data) {
    subline = t('Received an unrecognized status.')
  }
  const BannerIcon = BANNER[banner].icon

  const stripCells = (strip: StatusStripData, withDate: boolean) =>
    strip.buckets.map((bucket) => ({
      key: bucket.t,
      state: bucket.state,
      title: formatPeriod(bucket.t, strip.bucket_s, locale, withDate),
      detail: bucket.requests
        ? t('Success rate {{rate}}, {{count}} requests', {
            rate: formatRate(bucket.success_rate, locale),
            count: bucket.requests.toLocaleString(locale),
          })
        : t('No requests'),
    }))
  const stripText = (strip: StatusStripData) => {
    const summary = stripSummary(strip.buckets)
    if (!summary.requests) return t('No requests in this period')
    return t('Success rate {{rate}}, {{count}} requests in total', {
      rate: formatRate(summary.rate, locale),
      count: summary.requests.toLocaleString(locale),
    })
  }
  const current = data?.current
  const groups = data?.groups
  let currentNote: string | undefined
  if (level && current) {
    currentNote = current.requests
      ? t('{{count}} requests', {
          count: current.requests.toLocaleString(locale),
        })
      : t('No requests in the last 10 minutes')
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Service Status')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex items-center gap-2'>
          {data && (
            <span className='text-muted-foreground text-xs'>
              {t('Updated {{time}}', {
                time: formatClock(data.generated_at, locale, age > 6 * 3600),
              })}
            </span>
          )}
          <Button
            variant='outline'
            size='sm'
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={cn('size-4', query.isFetching && 'animate-spin')}
              aria-hidden
            />
            {t('Refresh')}
          </Button>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-6'>
          {query.isPending ? (
            <Skeleton className='h-36 w-full rounded-xl' />
          ) : (
            <Card>
              <CardContent className='flex flex-col gap-5'>
                <div role='status' className='flex items-start gap-3'>
                  <BannerIcon
                    className={cn(
                      'mt-0.5 size-6 shrink-0',
                      BANNER[banner].tone
                    )}
                    aria-hidden
                  />
                  <div className='flex min-w-0 flex-col gap-1'>
                    <span className='text-lg font-semibold'>{headline}</span>
                    {subline && (
                      <span className='text-muted-foreground text-sm'>
                        {subline}
                      </span>
                    )}
                  </div>
                </div>
                <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
                  <Stat
                    label={t('API availability')}
                    value={level ? level[2] : t('Unknown')}
                  />
                  <Stat
                    label={t('Success rate, last 10 minutes')}
                    value={
                      level && current?.requests
                        ? formatRate(current.success_rate, locale)
                        : '—'
                    }
                    note={currentNote}
                  />
                  <Stat
                    label={t('Time to first token (median)')}
                    value={level ? formatLatency(current?.p50_ms, locale) : '—'}
                    note={t('Last 10 minutes, streaming requests')}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {data && (
            <Section title={t('Group status')}>
              {groups && groups.length > 0 ? (
                <div className='grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3'>
                  {groups.map((group) => (
                    <GroupCard key={group.name} group={group} />
                  ))}
                </div>
              ) : (
                <p className='text-muted-foreground text-sm'>
                  {groups
                    ? t('No groups to show.')
                    : t(
                        'Group data cannot be read right now; the overall status above is unaffected.'
                      )}
                </p>
              )}
            </Section>
          )}

          {data && (
            <Section title={t('Overall trend')}>
              <Card>
                <CardContent className='flex flex-col gap-6'>
                  <div className='flex flex-col gap-2'>
                    <h3 className='text-sm font-medium'>
                      {t('Last 24 hours')}
                    </h3>
                    <StatusStrip
                      cells={stripCells(data.day, false)}
                      label={t(
                        'Request success rate each hour over the last 24 hours'
                      )}
                      startLabel={t('24 hours ago')}
                      endLabel={t('Now')}
                      summary={stripText(data.day)}
                    />
                  </div>
                  <div className='flex flex-col gap-2'>
                    <h3 className='text-sm font-medium'>{t('Last 7 days')}</h3>
                    <StatusStrip
                      cells={stripCells(data.week, true)}
                      label={t(
                        'Request success rate every 6 hours over the last 7 days'
                      )}
                      startLabel={t('7 days ago')}
                      endLabel={t('Now')}
                      summary={stripText(data.week)}
                    />
                  </div>
                  <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
                    {(
                      [
                        ['ok', t('Success rate above 95%')],
                        ['degraded', t('50% to 95%')],
                        ['outage', t('Below 50%')],
                        ['none', t('No requests in this period')],
                      ] as const
                    ).map(([state, label]) => (
                      <span key={state} className='flex items-center gap-1.5'>
                        <span
                          aria-hidden
                          className={cn(
                            'size-2.5 rounded-[2px]',
                            BUCKET_CLASS[state]
                          )}
                        />
                        {label}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Section>
          )}

          {data && (
            <p className='text-muted-foreground text-xs leading-relaxed'>
              {t(
                'Each cell is the share of requests in that period that succeeded, not counting requests the client cancelled. On the group cards only failures on our side (5xx, timeouts, rate limits) count; errors in the request itself, such as an invalid parameter or an empty balance, do not. Time to first token is the median of streaming requests; image and video groups do not stream, so they show the time of the whole request. Data updates every 2 minutes; if it has not updated for more than 10 minutes, this page shows "Status unknown" rather than normal.'
              )}
            </p>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
