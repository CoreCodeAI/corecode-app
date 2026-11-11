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

import { closedHours } from '../analysis'
import {
  diagnoseRejections,
  headroom,
  periodSpan,
  rangeEnd,
} from '../capacity-analysis'
import {
  foldIntoWeek,
  groupProvider,
  HEADROOM_SHARE,
  PROVIDER_LABELS,
  SMALL_SAMPLE,
  useErrorCategoryLabel,
  useHourAxis,
  useInsightsFormat,
  type InsightsRangeInfo,
  type InsightsTab,
} from '../lib'
import {
  POOL_PROVIDERS,
  type CapacityInsights,
  type PoolProvider,
} from '../types'
import { useCapacityVerdict } from '../verdicts'
import { WeekHeatmap } from './advanced-charts'
import {
  FailureRatePanel,
  HourlyPeakChart,
  PeakTrendPanel,
  RejectionDiagnosisNote,
} from './capacity-insights'
import { ConcurrencyLimitsPanel } from './concurrency-limits-panel'
import {
  BarSeries,
  Breakdown,
  MetricGrid,
  Panel,
  ProviderSwitch,
  SimpleTable,
  TruncatedNotice,
  UserLabel,
  Verdict,
  type Tone,
} from './shared'

// Where a live user's limit comes from, marked after the limit.
const LIMIT_MARKS: Record<string, string> = { user: '*', tier: '↑' }

/** What the capacity tab covers: every provider, or one. */
export type CapacityVendor = 'all' | PoolProvider

export function CapacityTab(props: {
  data: CapacityInsights | undefined
  previous?: CapacityInsights
  vendor?: CapacityVendor
  onVendor?: (vendor: CapacityVendor) => void
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const errorCategoryLabel = useErrorCategoryLabel()
  const data = props.data
  const previous = props.previous
  const pool = data?.pool
  const vendor = props.vendor ?? 'all'
  const all = vendor === 'all'
  // One provider's groups, as the account pool tab reads them.
  const groups = (pool?.groups ?? []).filter(
    (row) => all || groupProvider(row) === vendor
  )
  const groupIds = new Set(groups.map((row) => row.id))
  const vendorAccounts = (pool?.accounts ?? []).filter((account) =>
    groupIds.has(account.group_id)
  )
  const accountCounts = new Map<string, number>()
  for (const row of pool?.groups ?? []) {
    const key = groupProvider(row)
    accountCounts.set(key, (accountCounts.get(key) ?? 0) + row.accounts)
  }
  let slots = 0
  if (pool?.configured) {
    slots = all
      ? pool.effective_slots
      : groups.reduce((sum, row) => sum + (row.enabled ? row.slots : 0), 0)
  }
  // new-api counts requests in flight per user, for every provider; the
  // engine counts them per group.
  const inFlight = all
    ? (data?.in_flight ?? 0)
    : groups.reduce((sum, row) => sum + row.in_flight, 0)
  const verdict = useCapacityVerdict(
    props.data,
    props.previous,
    { slots, userLimits: all },
    props.range
  )
  const axis = useHourAxis()
  const engineRejectionsOf = (insights: CapacityInsights | undefined) =>
    insights?.error_categories.find(
      (item) => item.name === 'engine_concurrency'
    )?.count ?? 0
  const engineRejections = engineRejectionsOf(data)
  const limitRejections = new Map(
    (data?.limit_rejections ?? []).map((point) => [point.at, point.count])
  )
  const hourly = data?.hourly ?? []
  const end = rangeEnd(props.range)
  const span = periodSpan(props.range, hourly, previous?.hourly)
  const closed = closedHours(hourly, end)
  const room = headroom(hourly, slots, end)
  const diagnosis = diagnoseRejections(hourly, slots)
  // A week of hours fills the weekday grid; a shorter range leaves it
  // one or two rows that say nothing.
  const weekly = (props.range?.days ?? hourly.length / 24) >= 7
  // Only Claude's upstream says which limit it hit; the rest say rate limit.
  const upstreamLabel =
    all || vendor === 'claude'
      ? t('Claude upstream rate limit')
      : t('Upstream rate limit')
  const categoryLabel = (name: string) => {
    if (all || vendor === 'claude') return errorCategoryLabel(name)
    if (name === 'upstream_rate_limit') return t('Upstream rate limit')
    if (name === 'upstream_overloaded') return t('Upstream overloaded')
    return errorCategoryLabel(name)
  }
  const eligible = all
    ? (pool?.eligible_accounts ?? 0)
    : vendorAccounts.filter((account) => account.eligible).length
  const rejectionTotals = [
    {
      name: t('Engine account concurrency full'),
      count: hourly.reduce((sum, hour) => sum + hour.engine_rejections, 0),
    },
    {
      name: upstreamLabel,
      count: hourly.reduce((sum, hour) => sum + hour.upstream_rate_limits, 0),
    },
    ...(all
      ? [{ name: t('Per-user limit'), count: data?.limit_rejection_total ?? 0 }]
      : []),
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

  // Slots are the pool's value now, so past hours read against today's.
  let peakHint: string | undefined = data ? fmt.time(data.peak_at) : undefined
  const tightest = room?.tightest
  if (room && tightest) {
    const time = fmt.time(tightest.hour)
    if (tightest.free < 0) {
      peakHint = t(
        "{{hours}} hours past today's slots · {{over}} over at {{time}}",
        { hours: fmt.num(room.over), over: fmt.num(-tightest.free), time }
      )
    } else if (room.near > 0) {
      peakHint = t(
        "{{hours}} hours at {{share}} of today's slots or more · tightest {{time}}, {{free}} free",
        {
          hours: fmt.num(room.near),
          share: fmt.pct(HEADROOM_SHARE),
          time,
          free: fmt.num(tightest.free),
        }
      )
    } else {
      peakHint = t(
        "Tightest {{time}}: {{free}} of today's {{slots}} slots free",
        { time, free: fmt.num(tightest.free), slots: fmt.num(slots) }
      )
    }
  }
  let peakTone: Tone = 'default'
  if (slots && (data?.peak_concurrency ?? 0) > slots) peakTone = 'danger'
  else if (room && room.near > 0) peakTone = 'warning'

  let requestsHint: string | undefined
  if (data) {
    const values = {
      count: data.errors,
      rpm: fmt.num(data.peak_rpm),
      time: fmt.time(data.peak_rpm_at),
    }
    // Too few requests leave the failure rate to chance.
    requestsHint =
      data.requests >= SMALL_SAMPLE
        ? t('{{count}} failed ({{rate}}) · peak {{rpm}}/min at {{time}}', {
            ...values,
            rate: fmt.pct(data.errors / data.requests),
          })
        : t('{{count}} failed · peak {{rpm}}/min at {{time}}', values)
  }

  return (
    <div className='grid gap-4'>
      <ProviderSwitch
        ariaLabel={t('Provider')}
        value={vendor}
        onChange={props.onVendor}
        items={[
          { key: 'all' as const, label: t('All providers') },
          ...POOL_PROVIDERS.map((key) => ({
            key,
            label: PROVIDER_LABELS[key],
            count: accountCounts.get(key) ?? 0,
          })),
        ]}
      />
      <Verdict
        loading={!props.data}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
      />
      <MetricGrid
        loading={!data}
        // Two headline cards and three more do not fit six columns.
        className={all ? 'lg:grid-cols-4' : undefined}
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
            // The open hour is still filling and would read as a drop.
            trend: closed.map((hour) => ({
              title: axis.title(hour.hour),
              value: hour.requests,
            })),
            trendBars: true,
            hint: requestsHint,
          },
          {
            label: t('Peak concurrency'),
            featured: true,
            value: fmt.num(data?.peak_concurrency ?? 0),
            hint: peakHint,
            delta: {
              current: data?.peak_concurrency ?? 0,
              previous: previous?.peak_concurrency,
              better: 'neutral',
            },
            tone: peakTone,
            trend: closed.map((hour) => ({
              title: axis.title(hour.hour),
              value: hour.peak_concurrency,
            })),
          },
          {
            label: t('In flight now'),
            value: fmt.num(inFlight),
            hint: slots ? t('{{slots}} pool slots', { slots }) : undefined,
            meter: slots
              ? {
                  value: inFlight / slots,
                  tone: inFlight >= slots * 0.8 ? 'danger' : 'default',
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
          // The per-user limit applies before a provider is chosen, so it
          // has no provider's share.
          ...(all
            ? [
                {
                  label: t('Per-user limit 429'),
                  value: fmt.num(data?.limit_rejection_total ?? 0),
                  help: t('Turned away before reaching the pool'),
                  delta: {
                    current: data?.limit_rejection_total ?? 0,
                    previous: previous?.limit_rejection_total,
                    better: 'down' as const,
                  },
                  tone:
                    (data?.limit_rejection_total ?? 0) > 0
                      ? ('warning' as const)
                      : ('default' as const),
                },
              ]
            : []),
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
          <span className={cn(eligible <= 2 && 'text-destructive font-medium')}>
            {t('Pool: {{eligible}} of {{accounts}} accounts schedulable', {
              eligible,
              accounts: all ? pool.accounts.length : vendorAccounts.length,
            })}
          </span>
          <span>
            {t('{{slots}} slots ({{per}} per account)', {
              slots,
              per: pool.credential_concurrency,
            })}
          </span>
          <Link
            to='/site-insights'
            search={(prev) => ({
              ...prev,
              tab: 'pool' as const,
              provider: vendor === 'all' ? prev.provider : vendor,
              vendor: vendor === 'all' ? undefined : vendor,
            })}
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
        <HourlyPeakChart
          hourly={hourly}
          previous={previous?.hourly}
          span={span}
          end={end}
          slots={slots}
        />
      </Panel>

      {weekly ? (
        <div className='grid gap-4 lg:grid-cols-2'>
          <PeakTrendPanel hourly={hourly} end={end} slots={slots} />
          <Panel
            title={t('Peak concurrency by weekday and hour')}
            help={t(
              'Each cell is the highest concurrency that hour reached on any matching day in the range. A red ring marks one past the pool slots.'
            )}
          >
            <WeekHeatmap
              cells={foldIntoWeek(
                hourly.map((hour) => ({
                  hour: hour.hour,
                  value: hour.peak_concurrency,
                }))
              )}
              format={fmt.num}
              limit={slots || undefined}
              empty={t('No requests in this range')}
            />
          </Panel>
        </div>
      ) : null}

      {hourly.length > 0 && (
        <FailureRatePanel
          hourly={hourly}
          previous={previous?.hourly}
          span={span}
          end={end}
        />
      )}

      <div
        className={cn('grid gap-4', all ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}
      >
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
          <RejectionDiagnosisNote
            diagnosis={diagnosis}
            slots={slots}
            vendor={vendor}
          />
          <BarSeries
            ariaLabel={t('Rejections by hour')}
            series={[
              { label: t('Engine account concurrency full') },
              { label: upstreamLabel },
              ...(all ? [{ label: t('Per-user limit') }] : []),
            ]}
            points={axis.bars(hourly, end, (hour) => ({
              values: [
                hour.engine_rejections,
                hour.upstream_rate_limits,
                ...(all ? [limitRejections.get(hour.hour) ?? 0] : []),
              ],
              extra: [
                {
                  label: t('Peak concurrency'),
                  value: slots
                    ? t('{{peak}} of {{slots}}', {
                        peak: fmt.num(hour.peak_concurrency),
                        slots: fmt.num(slots),
                      })
                    : fmt.num(hour.peak_concurrency),
                },
              ],
            }))}
          />
        </Panel>
        {all && (
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
        )}
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

      {/* Per-user figures span every provider, so one provider's view
          leaves them out. */}
      {all && <ConcurrencyLimitsPanel data={data} />}

      {all && (
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
      )}
    </div>
  )
}
