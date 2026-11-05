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
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { useErrorCategoryLabel, useInsightsFormat } from '../lib'
import type { CapacityInsights } from '../types'
import { useCapacityVerdict } from '../verdicts'
import { ConcurrencyLimitsPanel } from './concurrency-limits-panel'
import {
  BarSeries,
  Breakdown,
  MetricGrid,
  Panel,
  SimpleTable,
  TruncatedNotice,
  UserLabel,
  Verdict,
} from './shared'

// Where a live user's limit comes from, marked after the limit.
const LIMIT_MARKS: Record<string, string> = { user: '*', tier: '↑' }

export function CapacityTab(props: {
  data: CapacityInsights | undefined
  previous?: CapacityInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const verdict = useCapacityVerdict(props.data, props.previous)
  const categoryLabel = useErrorCategoryLabel()
  const data = props.data
  const previous = props.previous
  const pool = data?.pool
  const slots = pool?.configured ? pool.effective_slots : 0
  const engineRejectionsOf = (insights: CapacityInsights | undefined) =>
    insights?.error_categories.find(
      (item) => item.name === 'engine_concurrency'
    )?.count ?? 0
  const engineRejections = engineRejectionsOf(data)
  const limitRejections = new Map(
    (data?.limit_rejections ?? []).map((point) => [point.at, point.count])
  )
  const hourly = data?.hourly ?? []
  // An hourly series marks each day where the viewer's day starts.
  const dayAxis = (hour: number) =>
    new Date(hour * 1000).getHours() === 0 ? fmt.day(hour) : undefined
  const rejectionTotals = [
    {
      name: t('Engine account concurrency full'),
      count: hourly.reduce((sum, hour) => sum + hour.engine_rejections, 0),
    },
    {
      name: t('Claude upstream rate limit'),
      count: hourly.reduce((sum, hour) => sum + hour.upstream_rate_limits, 0),
    },
    { name: t('Per-user limit'), count: data?.limit_rejection_total ?? 0 },
  ]
  const rejected = rejectionTotals.reduce((sum, item) => sum + item.count, 0)
  const mainCause = rejectionTotals.reduce((a, b) =>
    b.count > a.count ? b : a
  )

  let peakSummary: string | undefined
  if (data && data.peak_concurrency > 0) {
    peakSummary = slots
      ? t(
          'Highest {{peak}} at {{time}}, {{share}} of the {{slots}} pool slots.',
          {
            peak: data.peak_concurrency,
            time: fmt.time(data.peak_at),
            share: fmt.pct(data.peak_concurrency / slots),
            slots,
          }
        )
      : t('Highest {{peak}} at {{time}}.', {
          peak: data.peak_concurrency,
          time: fmt.time(data.peak_at),
        })
  }

  return (
    <div className='grid gap-4'>
      <Verdict
        loading={!props.data}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
      />
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Requests'),
            featured: true,
            value: fmt.num(data?.requests ?? 0),
            delta: {
              current: data?.requests ?? 0,
              previous: previous?.requests,
              better: 'neutral',
            },
            trend: hourly.map((hour) => ({
              title: fmt.time(hour.hour),
              value: hour.requests,
            })),
            hint: data
              ? t('{{count}} failed · peak {{rpm}}/min at {{time}}', {
                  count: data.errors,
                  rpm: fmt.num(data.peak_rpm),
                  time: fmt.time(data.peak_rpm_at),
                })
              : undefined,
          },
          {
            label: t('Peak concurrency'),
            value: fmt.num(data?.peak_concurrency ?? 0),
            hint: data ? fmt.time(data.peak_at) : undefined,
            delta: {
              current: data?.peak_concurrency ?? 0,
              previous: previous?.peak_concurrency,
              better: 'neutral',
            },
            tone:
              slots && (data?.peak_concurrency ?? 0) > slots
                ? 'danger'
                : 'default',
          },
          {
            label: t('In flight now'),
            value: fmt.num(data?.in_flight ?? 0),
            hint: slots
              ? t('{{slots}} pool slots', { slots: pool?.effective_slots })
              : undefined,
            meter: slots
              ? {
                  value: (data?.in_flight ?? 0) / slots,
                  tone:
                    (data?.in_flight ?? 0) >= slots * 0.8
                      ? 'danger'
                      : 'default',
                  label: t('In flight now'),
                }
              : undefined,
          },
          {
            label: t('Pool full (engine 429)'),
            value: fmt.num(engineRejections),
            help: t(
              'Requests the engine turned away because every schedulable account was at its concurrency limit.'
            ),
            delta: {
              current: engineRejections,
              previous: previous ? engineRejectionsOf(previous) : undefined,
              better: 'down',
            },
            tone: engineRejections > 0 ? 'warning' : 'default',
          },
          {
            label: t('Per-user limit 429'),
            value: fmt.num(data?.limit_rejection_total ?? 0),
            help: t('Turned away before reaching the pool'),
            delta: {
              current: data?.limit_rejection_total ?? 0,
              previous: previous?.limit_rejection_total,
              better: 'down',
            },
            tone:
              (data?.limit_rejection_total ?? 0) > 0 ? 'warning' : 'default',
          },
        ]}
      />
      <TruncatedNotice show={!!data?.truncated} />

      {pool?.error && <p className='text-destructive text-xs'>{pool.error}</p>}
      {pool && !pool.configured && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Set EngineControlURL and EngineControlKey to read the pool from corecode-engine.'
          )}
        </p>
      )}
      {pool?.configured && !pool.error && (
        <p className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
          <span
            className={cn(
              pool.eligible_accounts <= 2 && 'text-destructive font-medium'
            )}
          >
            {t('Pool: {{eligible}} of {{accounts}} accounts schedulable', {
              eligible: pool.eligible_accounts,
              accounts: pool.accounts.length,
            })}
          </span>
          <span>
            {t('{{slots}} slots ({{per}} per account)', {
              slots: pool.effective_slots,
              per: pool.credential_concurrency,
            })}
          </span>
          <Link
            to='/site-insights'
            search={(prev) => ({ ...prev, tab: 'pool' as const })}
            className='text-primary font-medium hover:underline'
          >
            {t('See every account in the account pool')}
          </Link>
        </p>
      )}

      <Panel
        title={t('Hourly peak concurrency')}
        description={peakSummary}
        help={t(
          'Reconstructed from request logs: each request was in flight from its start to its end.'
        )}
      >
        <BarSeries
          ariaLabel={t('Hourly peak concurrency')}
          series={[{ label: t('Peak concurrency') }]}
          points={hourly.map((hour) => ({
            key: hour.hour,
            title: fmt.time(hour.hour),
            axis: dayAxis(hour.hour),
            values: [hour.peak_concurrency],
            extra: [{ label: t('Requests'), value: fmt.num(hour.requests) }],
          }))}
        />
      </Panel>

      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel
          title={t('Rejections by hour')}
          description={
            data &&
            (rejected
              ? t('{{count}} rejected; most were {{cause}}.', {
                  count: fmt.num(rejected),
                  cause: mainCause.name,
                })
              : t('Nothing was rejected in this range.'))
          }
        >
          <BarSeries
            ariaLabel={t('Rejections by hour')}
            series={[
              { label: t('Engine account concurrency full') },
              { label: t('Claude upstream rate limit') },
              { label: t('Per-user limit') },
            ]}
            points={hourly.map((hour) => ({
              key: hour.hour,
              title: fmt.time(hour.hour),
              axis: dayAxis(hour.hour),
              values: [
                hour.engine_rejections,
                hour.upstream_rate_limits,
                limitRejections.get(hour.hour) ?? 0,
              ],
            }))}
          />
        </Panel>
        <Panel
          title={t('Users turned away by their limit')}
          help={t(
            'Requests the per-user concurrency limit answered with 429. They never reach the request logs.'
          )}
        >
          <SimpleTable
            rows={data?.limit_rejected_users}
            rowKey={(row) => row.user_id}
            empty={t('No user hit their limit in this range')}
            columns={[
              {
                key: 'user',
                label: t('User'),
                render: (row) => <UserLabel {...row} />,
              },
              {
                key: 'count',
                label: t('Times turned away'),
                align: 'right',
                render: (row) => fmt.num(row.count),
              },
            ]}
          />
        </Panel>
        <Panel
          title={t('Failures by cause')}
          help={t(
            'The performance panel leaves out capacity rejections; this counts every failed request in the logs.'
          )}
        >
          <Breakdown
            items={data?.error_categories}
            label={categoryLabel}
            empty={t('No failed requests in this range')}
          />
        </Panel>
      </div>

      <ConcurrencyLimitsPanel data={data} />

      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel
          title={t('In flight by user')}
          help={t(
            'Live, on this server. * marks a user limit and ↑ a paid-total tier; otherwise the limit comes from the group.'
          )}
        >
          <SimpleTable
            rows={data?.in_flight_users}
            rowKey={(row) => row.user_id}
            empty={t('No requests in flight')}
            columns={[
              {
                key: 'user',
                label: t('User'),
                render: (row) => <UserLabel {...row} />,
              },
              {
                key: 'n',
                label: t('In flight'),
                align: 'right',
                render: (row) =>
                  row.limit
                    ? `${row.in_flight} / ${row.limit}${LIMIT_MARKS[row.limit_source] ?? ''}`
                    : row.in_flight,
              },
            ]}
          />
        </Panel>
        <Panel title={t('Peak concurrency by user')}>
          <SimpleTable
            rows={data?.user_peaks}
            rowKey={(row) => row.user_id}
            empty={t('No requests in this range')}
            columns={[
              {
                key: 'user',
                label: t('User'),
                render: (row) => <UserLabel {...row} />,
              },
              {
                key: 'peak',
                label: t('Peak'),
                align: 'right',
                render: (row) => row.peak,
              },
              {
                key: 'at',
                label: t('At'),
                align: 'right',
                render: (row) => fmt.time(row.peak_at),
              },
              {
                key: 'requests',
                label: t('Requests'),
                align: 'right',
                render: (row) => fmt.num(row.requests),
              },
            ]}
          />
        </Panel>
      </div>
    </div>
  )
}
