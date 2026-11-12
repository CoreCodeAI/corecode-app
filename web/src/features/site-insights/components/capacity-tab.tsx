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

import { beforeLogs, closedHours } from '../analysis'
import {
  accountLimits,
  diagnoseRejections,
  enabledInFlight,
  engineRefusals,
  headroom,
  periodSpan,
  POOL_FULL_DANGER,
  poolPeakOf,
  rangeEnd,
} from '../capacity-analysis'
import {
  countsRequestsOnce,
  foldIntoWeek,
  groupProvider,
  HEADROOM_SHARE,
  joinSentences,
  PROVIDER_LABELS,
  previousBeforeLogs,
  rangeHours,
  SMALL_SAMPLE,
  tableState,
  useErrorCategoryLabel,
  useHourAxis,
  useInsightsDefinitions,
  useInsightsFormat,
  type InsightsRangeInfo,
  type InsightsSources,
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
  EngineCapsNote,
  FailureRatePanel,
  HourlyPeakChart,
  PeakTrendPanel,
  RejectionDiagnosisNote,
} from './capacity-insights'
import { ConcurrencyLimitsPanel } from './concurrency-limits-panel'
import { SampleNote, StaleNote } from './insight-kit'
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

// The engine's count is this old or less when shown in seconds.
const AGE_IN_SECONDS = 120

/** What the capacity tab covers: every provider, or one. */
export type CapacityVendor = 'all' | PoolProvider

export function CapacityTab(props: {
  data: CapacityInsights | undefined
  previous?: CapacityInsights
  vendor?: CapacityVendor
  onVendor?: (vendor: CapacityVendor) => void
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const definitions = useInsightsDefinitions()
  const errorCategoryLabel = useErrorCategoryLabel()
  const data = props.data
  const previous = props.previous
  const pool = data?.pool
  const vendor = props.vendor ?? 'all'
  const all = vendor === 'all'
  // No figures and a failed read: nothing below is zero, it is unknown.
  const failed = !data && props.sources?.view.status === 'error'
  const viewError = failed
    ? props.sources?.view.error || t('Could not be read')
    : undefined
  const loading = !data && !failed
  const viewState = (rows: unknown) => tableState(props.sources?.view, rows)
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
  const poolRead = !!pool?.configured && !pool.error
  let slots = 0
  if (pool?.configured) {
    slots = all
      ? pool.effective_slots
      : groups.reduce((sum, row) => sum + (row.enabled ? row.slots : 0), 0)
  }
  // The engine's count over the groups the slots cover, on every server.
  const inFlight = enabledInFlight(groups)
  const verdict = useCapacityVerdict(
    props.data,
    props.previous,
    { slots, userLimits: all },
    props.range
  )
  const axis = useHourAxis()
  const engine = engineRefusals(data?.error_categories)
  const previousEngine = previous
    ? engineRefusals(previous.error_categories)
    : undefined
  const limitRejections = new Map(
    (data?.limit_rejections ?? []).map((point) => [point.at, point.count])
  )
  const hourly = data?.hourly ?? []
  const end = rangeEnd(props.range)
  const span = periodSpan(props.range, hourly, previous?.hourly)
  const closed = closedHours(hourly, end)
  // Before the logs begin an hour has no data, so it is drawn missing; a
  // previous period wholly before them has nothing to compare with.
  const logsSince = data?.logs_since
  const previousMissing = props.range
    ? previousBeforeLogs(props.range, logsSince)
    : false
  const room = headroom(hourly, slots, end)
  const diagnosis = diagnoseRejections(hourly, slots)
  const once = countsRequestsOnce(data)
  const requestDefinition = once
    ? definitions.requests
    : definitions.requestsAsAttempts
  // A week of hours fills the weekday grid; a shorter range leaves it
  // one or two rows that say nothing.
  const weekly = (props.range?.days ?? hourly.length / 24) >= 7
  const hoursInRange = props.range ? rangeHours(props.range) : hourly.length

  // The pool's own peak where the server sends it at the top level; the
  // site's otherwise. A stale range sends none, so it reads as the site's
  // everywhere (chart, trend and headline alike).
  const ownPeak = data?.pool_peak != null
  const peak = data ? poolPeakOf(data) : 0
  // A zero pool_peak_at is no time, so the card does not print one.
  const peakAt =
    (ownPeak && data?.pool_peak_at ? data.pool_peak_at : undefined) ??
    data?.peak_at ??
    0
  const previousPeak =
    previous && (previous.pool_peak != null) === (data?.pool_peak != null)
      ? poolPeakOf(previous)
      : undefined
  const peakLabel = ownPeak ? t('Pool peak') : t('Peak concurrency')
  // While some hours are rebuilt the server withholds the pool's peak, so
  // the figure shown is the site's; the help says so.
  const peakHelp = ownPeak
    ? joinSentences(definitions.poolPeak, definitions.sitePeak)
    : joinSentences(
        definitions.sitePeak,
        (data?.stale_hours ?? 0) > 0 &&
          t(
            'While some hours of the range are rebuilt, the pool’s own peak is withheld, so this is the site’s, every channel.'
          )
      )
  // A pool that served nothing has no time to read: it says so instead.
  const poolIdle = ownPeak && peak === 0

  // Only Claude's upstream says which limit it hit, and only one provider's
  // view is that upstream alone.
  const upstreamLabel =
    vendor === 'claude'
      ? t('Claude upstream rate limit')
      : t('Upstream rate limit')
  const categoryLabel = (name: string) => {
    if (vendor === 'claude') return errorCategoryLabel(name)
    if (name === 'upstream_rate_limit') return t('Upstream rate limit')
    if (name === 'upstream_overloaded') return t('Upstream overloaded')
    return errorCategoryLabel(name)
  }
  const eligible = all
    ? (pool?.eligible_accounts ?? 0)
    : vendorAccounts.filter((account) => account.eligible).length
  const limits = accountLimits(groups, pool?.credential_concurrency ?? 0)
  const rejectionTotals = [
    {
      name: t('Engine account concurrency full'),
      count: hourly.reduce((sum, hour) => sum + hour.engine_rejections, 0),
    },
    { name: errorCategoryLabel('engine_limit'), count: engine.limit },
    { name: errorCategoryLabel('engine_budget'), count: engine.budget },
    {
      name: upstreamLabel,
      count: hourly.reduce((sum, hour) => sum + hour.upstream_rate_limits, 0),
    },
    ...(all
      ? [
          {
            name: t('Per-user limit (attempts)'),
            count: data?.limit_rejection_total ?? 0,
          },
        ]
      : []),
  ]
  const rejected = rejectionTotals.reduce((sum, item) => sum + item.count, 0)
  const mainCause = rejectionTotals.reduce((a, b) =>
    b.count > a.count ? b : a
  )

  let peakSummary: string | undefined
  if (data && (peak > 0 || data.peak_concurrency > 0)) {
    const values = {
      peak,
      time: fmt.time(peakAt),
      share: slots ? fmt.pct(peak / slots) : '',
      slots,
      site: fmt.num(data.peak_concurrency),
    }
    if (poolIdle) {
      peakSummary = t(
        "No request was served through the pool in this range; the site's, every channel, was {{site}}.",
        values
      )
    } else if (ownPeak && slots) {
      peakSummary = t(
        "Pool peak {{peak}} at {{time}}, {{share}} of the {{slots}} pool slots; the site's, every channel, was {{site}}.",
        values
      )
    } else if (ownPeak) {
      peakSummary = t(
        "Pool peak {{peak}} at {{time}}; the site's, every channel, was {{site}}.",
        values
      )
    } else if (slots) {
      peakSummary = t(
        'Highest {{peak}} at {{time}}, {{share}} of the {{slots}} pool slots.',
        values
      )
    } else {
      peakSummary = t('Highest {{peak}} at {{time}}.', values)
    }
  }

  // Slots are the pool's value now, so past hours read against today's.
  let peakHint: string | undefined = data ? fmt.time(peakAt) : undefined
  if (poolIdle) peakHint = t('No request was served through the pool')
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
  // The pool's own peak holds a slot per request, so reaching the slots is
  // full; the site's, with every channel, is only flagged past them.
  const overSlots = ownPeak ? peak >= slots : peak > slots
  let peakTone: Tone = 'default'
  if (slots && overSlots) peakTone = 'danger'
  else if (room && room.near > 0) peakTone = 'warning'

  let requestsHint: string | undefined
  if (data) {
    const values = {
      count: data.errors,
      rpm: fmt.num(data.peak_rpm),
      time: fmt.time(data.peak_rpm_at),
    }
    // Too few requests leave the failure rate to chance, and a range with no
    // request has no peak minute to name.
    let failures = t('{{count}} failed', { count: data.errors })
    if (data.requests >= SMALL_SAMPLE) {
      failures = t(
        '{{count}} failed ({{rate}}) · peak {{rpm}}/min at {{time}}',
        {
          ...values,
          rate: fmt.pct(data.errors / data.requests),
        }
      )
    } else if (data.peak_rpm > 0) {
      failures = t('{{count}} failed · peak {{rpm}}/min at {{time}}', values)
    }
    // Tries beside requests, where retries made them differ.
    const attempts =
      data.attempts != null && data.attempts !== data.requests
        ? t('{{attempts}} attempts, {{failed}} failed', {
            attempts: fmt.num(data.attempts),
            failed: fmt.num(data.attempt_errors ?? 0),
          })
        : undefined
    requestsHint = attempts ? `${failures} · ${attempts}` : failures
  }

  let inFlightHint: string | undefined
  if (data && !poolRead) {
    inFlightHint = t('The engine pool could not be read')
  } else if (pool && slots) {
    const observed = pool.observed_at_ms
    const age = observed
      ? Math.max(0, Math.round((Date.now() - observed) / 1000))
      : undefined
    if (age === undefined) {
      inFlightHint = t('{{slots}} pool slots', { slots })
    } else if (age < AGE_IN_SECONDS) {
      inFlightHint = t('{{slots}} pool slots · counted {{seconds}} s ago', {
        slots,
        seconds: fmt.num(age),
      })
    } else {
      inFlightHint = t('{{slots}} pool slots · counted {{minutes}} min ago', {
        slots,
        minutes: fmt.num(Math.round(age / 60)),
      })
    }
  }

  let poolFullHint: string | undefined
  if (engine.limit > 0 || engine.budget > 0) {
    poolFullHint = t(
      'Also {{limit}} at engine caps, {{budget}} at account budgets',
      { limit: fmt.num(engine.limit), budget: fmt.num(engine.budget) }
    )
  }
  let poolFullTone: Tone = 'default'
  if (engine.full >= POOL_FULL_DANGER) poolFullTone = 'danger'
  else if (engine.full > 0) poolFullTone = 'warning'

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
      {viewError ? (
        <p className='text-destructive text-xs'>{viewError}</p>
      ) : (
        <Verdict
          loading={loading}
          tone={verdict?.tone ?? 'default'}
          text={verdict?.text}
        />
      )}
      <MetricGrid
        loading={loading}
        // Two headline cards and three more do not fit six columns.
        className={all ? 'lg:grid-cols-4' : undefined}
        items={[
          {
            label: t('Requests'),
            featured: true,
            missing: failed,
            value: fmt.num(data?.requests ?? 0),
            help: joinSentences(
              requestDefinition,
              definitions.customers,
              data?.attempts != null && definitions.attempts
            ),
            delta: {
              current: data?.requests ?? 0,
              previous: previous?.requests,
              better: 'neutral',
              missing: previousMissing,
            },
            // The open hour is still filling and would read as a drop.
            trend: closed.map((hour) => ({
              title: axis.title(hour.hour),
              value: hour.requests,
              missing: beforeLogs(hour.hour, 3600, logsSince),
            })),
            trendBars: true,
            hint: requestsHint,
          },
          {
            label: ownPeak ? t('Pool peak concurrency') : t('Peak concurrency'),
            featured: true,
            missing: failed,
            value: fmt.num(peak),
            help: peakHelp,
            hint: peakHint,
            delta: {
              current: peak,
              // An idle pool last period had no peak: "New this period" would
              // read as the pool being new, so no change is shown.
              previous:
                ownPeak && previousPeak === 0 ? undefined : previousPeak,
              better: 'neutral',
              missing: previousMissing,
            },
            tone: peakTone,
            trend: closed.map((hour) => ({
              title: axis.title(hour.hour),
              value: poolPeakOf(hour),
              missing: beforeLogs(hour.hour, 3600, logsSince),
            })),
          },
          {
            label: t('In flight now'),
            // Without the pool there is no count on the slots' terms.
            missing: failed || !poolRead,
            value: fmt.num(inFlight),
            help: t(
              "The engine's count of requests in flight in the enabled groups, across every server; it can be up to two minutes old."
            ),
            hint: inFlightHint,
            meter:
              poolRead && slots
                ? {
                    value: inFlight / slots,
                    tone: inFlight >= slots * 0.8 ? 'danger' : 'default',
                    label: t('In flight now'),
                  }
                : undefined,
          },
          {
            label: t('Pool full (engine 429)'),
            missing: failed,
            value: fmt.num(engine.full),
            help: t(
              'Requests the engine turned away because every schedulable account was at its concurrency limit.'
            ),
            hint: poolFullHint,
            delta: {
              current: engine.full,
              previous: previousEngine?.full,
              better: 'down',
              missing: previousMissing,
            },
            tone: poolFullTone,
          },
          // The per-user limit applies before a provider is chosen, so it
          // has no provider's share.
          ...(all
            ? [
                {
                  label: t('Per-user limit 429'),
                  missing: failed,
                  value: fmt.num(data?.limit_rejection_total ?? 0),
                  help: t(
                    "Attempts the per-user concurrency limit refused before they reached the pool, a client's retries included, so one stuck client counts many times."
                  ),
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
      <StaleNote staleHours={data?.stale_hours} rangeHours={hoursInRange} />
      {props.sources?.previous.status === 'error' && data && !previous && (
        <SampleNote>
          {t('The previous period could not be read, so no change is shown.')}
        </SampleNote>
      )}

      {pool?.error && <p className='text-destructive text-xs'>{pool.error}</p>}
      {pool && !pool.configured && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Set EngineControlURL and EngineControlKey to read the pool from corecode-engine.'
          )}
        </p>
      )}
      {poolRead && pool && (
        <p className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
          <span className={cn(eligible <= 2 && 'text-destructive font-medium')}>
            {t('Pool: {{eligible}} of {{accounts}} accounts schedulable', {
              eligible,
              accounts: all ? pool.accounts.length : vendorAccounts.length,
            })}
          </span>
          <span>
            {limits.length > 1
              ? t(
                  '{{slots}} slots ({{low}} to {{high}} per account, by group)',
                  {
                    slots,
                    low: limits[0],
                    high: limits.at(-1),
                  }
                )
              : t('{{slots}} slots ({{per}} per account)', {
                  slots,
                  per: limits[0],
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
        error={viewError}
        help={joinSentences(
          t(
            'Reconstructed from request logs: each request was in flight from its start to its end.'
          ),
          t(
            'Times are logged in whole seconds and each request holds at least one, so a burst of short requests reads higher than it was.'
          ),
          peakHelp
        )}
      >
        <HourlyPeakChart
          own={ownPeak}
          hourly={hourly}
          previous={previous?.hourly}
          span={span}
          end={end}
          slots={slots}
          logsSince={logsSince}
        />
      </Panel>

      {weekly ? (
        <div className='grid gap-4 lg:grid-cols-2'>
          <PeakTrendPanel
            own={ownPeak}
            hourly={hourly}
            end={end}
            slots={slots}
            logsSince={logsSince}
          />
          <Panel
            title={t('Peak concurrency by weekday and hour')}
            help={
              ownPeak
                ? t(
                    "Each cell is the highest pool peak that hour reached on any matching day in the range. A red ring marks one past the pool's slots."
                  )
                : t(
                    'Each cell is the highest concurrency that hour reached on any matching day in the range. A red ring marks one past the pool slots.'
                  )
            }
          >
            <WeekHeatmap
              cells={foldIntoWeek(
                hourly
                  .filter((hour) => !beforeLogs(hour.hour, 3600, logsSince))
                  .map((hour) => ({
                    hour: hour.hour,
                    value: poolPeakOf(hour),
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
          definition={requestDefinition}
          logsSince={logsSince}
        />
      )}

      <div
        className={cn('grid gap-4', all ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}
      >
        <Panel
          title={t('Rejections by hour')}
          error={viewError}
          description={
            data &&
            (rejected
              ? t('{{count}} rejected; most were {{cause}}.', {
                  count: fmt.num(rejected),
                  cause: mainCause.name,
                })
              : t('Nothing was rejected in this range.'))
          }
          help={
            all
              ? t(
                  "The engine's and the upstreams' 429s count failed requests; the per-user limit counts refused attempts, a client's retries included."
                )
              : undefined
          }
        >
          <RejectionDiagnosisNote
            diagnosis={diagnosis}
            slots={slots}
            vendor={vendor}
          />
          <EngineCapsNote refusals={engine} />
          <BarSeries
            ariaLabel={t('Rejections by hour')}
            series={[
              { label: t('Engine account concurrency full') },
              { label: upstreamLabel },
              ...(all ? [{ label: t('Per-user limit (attempts)') }] : []),
            ]}
            points={axis.bars(
              hourly,
              end,
              (hour) => ({
                values: [
                  hour.engine_rejections,
                  hour.upstream_rate_limits,
                  ...(all ? [limitRejections.get(hour.hour) ?? 0] : []),
                ],
                extra: [
                  {
                    label: peakLabel,
                    value: slots
                      ? t('{{peak}} of {{slots}}', {
                          peak: fmt.num(poolPeakOf(hour)),
                          slots: fmt.num(slots),
                        })
                      : fmt.num(poolPeakOf(hour)),
                  },
                ],
              }),
              logsSince
            )}
          />
        </Panel>
        {all && (
          <Panel
            title={t('Users turned away by their limit')}
            help={t(
              "Attempts the per-user concurrency limit answered with 429, a client's retries included. They never reach the request logs."
            )}
          >
            <SimpleTable
              rows={data?.limit_rejected_users}
              state={viewState(data?.limit_rejected_users)}
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
                  label: t('Refused attempts'),
                  align: 'right',
                  render: (row) => fmt.num(row.count),
                },
              ]}
            />
          </Panel>
        )}
        <Panel
          title={t('Failures by cause')}
          help={joinSentences(
            t("Customers' failed requests by cause."),
            definitions.customers,
            requestDefinition
          )}
        >
          <Breakdown
            items={data?.error_categories}
            state={viewState(data?.error_categories)}
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
              "Live, on the server that answered this page only; another server's requests are not here. * marks a user limit and ↑ a paid-total tier; otherwise the limit comes from the group."
            )}
          >
            <SimpleTable
              rows={data?.in_flight_users}
              state={viewState(data?.in_flight_users)}
              rowKey={(row) => row.user_id}
              empty={t('No requests in flight on this server')}
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
          <Panel
            title={t('Peak concurrency by user')}
            help={t(
              "Each customer's own peak on every channel, not only the pool."
            )}
          >
            <SimpleTable
              rows={data?.user_peaks}
              state={viewState(data?.user_peaks)}
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
