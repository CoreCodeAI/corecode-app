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
import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { InsightsView } from '../api'
import {
  ATTENTION,
  DEBT_ALERT_USD,
  failureTone,
  OVERVIEW_VIEWS,
  SMALL_SAMPLE,
  useChargeFormat,
  useHourAxis,
  useInsightsFormat,
  useSharedAddresses,
  useTabLabel,
  type InsightsRangeInfo,
  type InsightsTab,
} from '../lib'
import type {
  ActivityInsights,
  CapacityInsights,
  EngineHorizon,
  EnginePool,
  FinanceInsights,
  QualityInsights,
  RiskInsights,
  UpstreamInsights,
} from '../types'
import { Findings, type Finding } from './insight-kit'
import {
  closedTrend,
  FAILING_RATE,
  marginCard,
  overviewExtraSignals,
} from './overview-analysis'
import { ProvidersPanel, ShareCharts, TopModelsPanel } from './overview-charts'
import { TabDigest, WhatChanged } from './overview-insights'
import { MetricGrid, Panel, type TrendPoint } from './shared'

type InsightsQuery = {
  queryKey: readonly unknown[]
  queryFn: () => Promise<unknown>
  staleTime: number
}

// The thresholds the tabs color by, so a signal here matches a colored
// figure there.
const ELIGIBLE_ACCOUNTS_LOW = 2
const REMAINING_DANGER = 0.1
const REMAINING_WARNING = 0.25
const TTFT_P95_SLOW_MS = 10_000

/** The views compared with the period before. */
const EARLIER_VIEWS = [
  'capacity',
  'quality',
  'finance',
  'risk',
  'upstream',
  'activity',
] as const satisfies readonly InsightsView[]

/** Vendors the quality verdict names when they fail. */
const NAMED_VENDORS: Record<string, string> = {
  claude: 'Claude',
  codex: 'GPT',
  grok: 'Grok',
  gemini: 'Gemini',
}

/**
 * The first tab: headline figures from several views, each tab's verdict,
 * what drove the headline changes, and a list of what needs attention now,
 * each linked to the tab that explains it. It reads the same queries the
 * tabs read, so opening one after it is instant.
 */
export function OverviewTab(props: {
  current: (view: InsightsView) => InsightsQuery
  previous: (view: InsightsView) => InsightsQuery
  refreshMs: Partial<Record<InsightsView, number>>
  onOpen?: (tab: InsightsTab) => void
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const hours = useHourAxis()
  const tabLabel = useTabLabel()
  const current = useQueries({
    queries: OVERVIEW_VIEWS.map((view) => ({
      ...props.current(view),
      refetchInterval: props.refreshMs[view] ?? false,
    })),
  })
  const earlier = useQueries({
    queries: EARLIER_VIEWS.map((view) => props.previous(view)),
  })
  const now = <T,>(view: (typeof OVERVIEW_VIEWS)[number]) =>
    (current[OVERVIEW_VIEWS.indexOf(view)].data ?? undefined) as T | undefined
  const before = <T,>(view: (typeof EARLIER_VIEWS)[number]) =>
    (earlier[EARLIER_VIEWS.indexOf(view)].data ?? undefined) as T | undefined
  const capacity = now<CapacityInsights>('capacity')
  const pool = now<EnginePool>('pool')
  const quality = now<QualityInsights>('quality')
  const finance = now<FinanceInsights>('finance')
  const risk = now<RiskInsights>('risk')
  const upstream = now<UpstreamInsights>('upstream')
  const activity = now<ActivityInsights>('activity')
  const previousCapacity = before<CapacityInsights>('capacity')
  const previousQuality = before<QualityInsights>('quality')
  const previousFinance = before<FinanceInsights>('finance')
  const previousRisk = before<RiskInsights>('risk')
  const previousUpstream = before<UpstreamInsights>('upstream')
  const previousActivity = before<ActivityInsights>('activity')
  const clusters = useSharedAddresses(risk)
  const charge = useChargeFormat(finance)
  const margin = marginCard(t, fmt, finance, charge.rate)
  const range = props.range

  const loading = current.filter((result) => result.isPending).length
  const signals: Finding[] = overviewExtraSignals(t, fmt, {
    capacity,
    previousCapacity,
    upstream,
    activity,
    range,
  })

  OVERVIEW_VIEWS.forEach((view, index) => {
    if (current[index].isError) {
      signals.push({
        key: `error-${view}`,
        tone: 'warning',
        title: t('{{view}} could not be read', { view: tabLabel(view) }),
        detail:
          current[index].error instanceof Error
            ? current[index].error.message
            : undefined,
        tab: view,
      })
    }
  })

  const share = (horizon: EngineHorizon | null | undefined) =>
    horizon?.capacity_usd ? horizon.remaining_usd / horizon.capacity_usd : 1
  if (pool?.error) {
    signals.push({
      key: 'pool-error',
      tone: 'danger',
      title: t('The account pool could not be read'),
      detail: pool.error,
      tab: 'pool',
    })
  } else if (pool?.configured) {
    const attention = pool.accounts.filter((account) =>
      ATTENTION.has(account.status)
    )
    if (attention.length > 0) {
      signals.push({
        key: 'pool-attention',
        tone: 'danger',
        title: t('{{count}} pool accounts need attention', {
          count: attention.length,
        }),
        detail: attention
          .map((account) => `#${account.credential_id} ${account.status}`)
          .join(', '),
        tab: 'pool',
      })
    }
    if (pool.eligible_accounts <= ELIGIBLE_ACCOUNTS_LOW) {
      signals.push({
        key: 'pool-eligible',
        tone: 'danger',
        title: t('Only {{count}} accounts are schedulable', {
          count: pool.eligible_accounts,
        }),
        tab: 'pool',
      })
    }
    const empty = pool.groups.filter(
      (group) => group.enabled && group.accounts > 0 && group.eligible === 0
    )
    if (empty.length > 0) {
      signals.push({
        key: 'pool-groups',
        tone: 'warning',
        title: t('No schedulable account in {{groups}}.', {
          groups: empty.map((group) => group.name).join(', '),
        }),
        tab: 'pool',
      })
    }
    for (const [key, label, horizon] of [
      ['five', t('5-hour left'), pool.five_hour_estimate],
      ['seven', t('7-day left'), pool.week_estimate],
    ] as const) {
      const left = share(horizon)
      if (horizon && left < REMAINING_WARNING) {
        signals.push({
          key: `pool-${key}`,
          tone: left < REMAINING_DANGER ? 'danger' : 'warning',
          title: t('{{label}}: {{share}} of the pool’s budget', {
            label,
            share: fmt.pct(left),
          }),
          detail: t('≈ {{amount}} of {{capacity}}', {
            amount: fmt.usdWhole(horizon.remaining_usd),
            capacity: fmt.usdWhole(horizon.capacity_usd),
          }),
          tab: 'pool',
        })
      }
    }
  }

  if (capacity) {
    const slots = capacity.pool?.configured ? capacity.pool.effective_slots : 0
    const engine =
      capacity.error_categories.find(
        (item) => item.name === 'engine_concurrency'
      )?.count ?? 0
    if (slots && capacity.peak_concurrency > slots) {
      signals.push({
        key: 'capacity-peak',
        tone: 'danger',
        title: t('Peak concurrency {{peak}} passed the {{slots}} pool slots', {
          peak: capacity.peak_concurrency,
          slots,
        }),
        detail: fmt.time(capacity.peak_at),
        tab: 'capacity',
        impact: capacity.peak_concurrency - slots,
      })
    }
    if (engine > 0) {
      signals.push({
        key: 'capacity-engine',
        tone: 'danger',
        title: t('The pool was full {{count}} times', { count: engine }),
        detail: t('Requests the engine turned away with 429'),
        tab: 'capacity',
        impact: engine,
      })
    }
    if (capacity.limit_rejection_total > 0) {
      const top = capacity.limit_rejected_users?.[0]
      signals.push({
        key: 'capacity-limit',
        tone: 'warning',
        title: t('Per-user limits turned away {{count}} requests', {
          count: capacity.limit_rejection_total,
        }),
        detail: top
          ? t('Most: {{user}} #{{id}}, {{count}} times', {
              user: top.username,
              id: top.user_id,
              count: top.count,
            })
          : undefined,
        tab: 'capacity',
        impact: capacity.limit_rejection_total,
      })
    }
  }

  if (quality) {
    const tone =
      quality.requests >= SMALL_SAMPLE
        ? failureTone(quality.error_rate)
        : 'default'
    if (tone === 'danger' || tone === 'warning') {
      signals.push({
        key: 'quality-rate',
        tone,
        title: t('Failure rate {{rate}}', {
          rate: fmt.pct(quality.error_rate),
        }),
        detail: t('{{count}} failed', { count: quality.errors }),
        tab: 'quality',
        impact: quality.errors,
      })
    }
    const claude = (quality.vendors ?? []).find(
      (vendor) => vendor.vendor === 'claude' && vendor.ttft_p50_ms > 0
    )
    if (claude && claude.ttft_p95_ms > TTFT_P95_SLOW_MS) {
      signals.push({
        key: 'quality-ttft',
        tone: 'warning',
        title: t('Claude TTFT p95 is {{value}}', {
          value: fmt.measuredMs(claude.ttft_p95_ms),
        }),
        tab: 'quality',
        impact: claude.requests,
      })
    }
    for (const vendor of quality.vendors ?? []) {
      if (
        !NAMED_VENDORS[vendor.vendor] ||
        vendor.requests < SMALL_SAMPLE ||
        vendor.error_rate <= FAILING_RATE
      ) {
        continue
      }
      signals.push({
        key: `quality-vendor-${vendor.vendor}`,
        tone: 'warning',
        title: t('{{vendor}} fails {{rate}} of requests.', {
          vendor: NAMED_VENDORS[vendor.vendor],
          rate: fmt.pct(vendor.error_rate),
        }),
        detail: t('{{count}} failed', { count: vendor.errors }),
        tab: 'quality',
        impact: vendor.errors,
      })
    }
    const failing = (quality.models ?? [])
      .filter(
        (row) =>
          row.requests >= SMALL_SAMPLE &&
          failureTone(row.error_rate) === 'danger'
      )
      .sort((a, b) => b.errors - a.errors)
    if (failing.length > 0) {
      signals.push({
        key: 'quality-models',
        tone: 'warning',
        title: t('{{count}} models fail more than 5% of requests', {
          count: failing.length,
        }),
        detail: failing
          .map((row) => `${row.model} ${fmt.pct(row.error_rate)}`)
          .join(', '),
        tab: 'quality',
        impact: failing.reduce((sum, row) => sum + row.errors, 0),
      })
    }
  }

  if (finance && finance.debt_usd < DEBT_ALERT_USD) {
    signals.push({
      key: 'finance-debt',
      tone: 'danger',
      title: t('{{count}} customers owe {{amount}}', {
        count: finance.debtors.length,
        amount: fmt.cny(-finance.debt_usd),
      }),
      tab: 'finance',
      impact: -finance.debt_usd,
    })
  }

  if (risk) {
    const buyers = clusters.filter((cluster) => cluster.subscription_buyers > 1)
    if (buyers.length > 0) {
      signals.push({
        key: 'risk-buyers',
        tone: 'danger',
        title: t('{{count}} addresses have several plan buyers', {
          count: buyers.length,
        }),
        detail: buyers.map((cluster) => cluster.ip).join(', '),
        tab: 'risk',
      })
    }
    const flagged = risk.alias_emails + risk.off_whitelist
    if (flagged > 0) {
      signals.push({
        key: 'risk-emails',
        tone: 'warning',
        title: t(
          '{{alias}} alias emails and {{off}} sign-ups off the allowlist',
          { alias: risk.alias_emails, off: risk.off_whitelist }
        ),
        tab: 'risk',
      })
    }
  }

  // A short range reads by the hour, the hour still filling left out; a
  // longer one by the day.
  const hourly = range?.hourly ?? false
  const end = range?.end ?? 0
  const hourPoints = (points: { hour: number; value: number }[]) =>
    points.map((point) => ({
      title: hours.title(point.hour),
      value: point.value,
    }))
  let revenueTrend: TrendPoint[] | undefined = (finance?.daily ?? []).map(
    (day) => ({ title: fmt.day(day.day), value: day.topup + day.subscription })
  )
  let requestsTrend: TrendPoint[] | undefined = (quality?.daily ?? []).map(
    (day) => ({ title: fmt.day(day.day), value: day.requests })
  )
  let signupTrend: TrendPoint[] | undefined
  if (hourly) {
    revenueTrend = finance?.hourly
      ? hourPoints(
          closedTrend(
            finance.hourly,
            end,
            (row) => row.topup + row.subscription
          )
        )
      : undefined
    const requestHours: { hour: number; requests: number }[] | undefined =
      quality?.hourly ?? capacity?.hourly
    requestsTrend = requestHours
      ? hourPoints(closedTrend(requestHours, end, (row) => row.requests))
      : undefined
  }
  if (risk?.signup_series) {
    const series = risk.signup_series.map((point) => ({
      hour: point.at,
      value: point.count,
    }))
    signupTrend =
      risk.series_unit === 'hour'
        ? hourPoints(closedTrend(series, end || Infinity, (row) => row.value))
        : series.map((point) => ({
            title: fmt.day(point.hour),
            value: point.value,
          }))
  }
  const qualitySampled = (quality?.requests ?? 0) >= SMALL_SAMPLE
  const five = pool?.five_hour_estimate
  const slots = capacity?.pool?.configured ? capacity.pool.effective_slots : 0

  return (
    <div className='grid gap-4'>
      <MetricGrid
        loading={!finance && !quality}
        items={[
          {
            label: t('Revenue'),
            featured: true,
            value: fmt.cny(finance?.revenue ?? 0),
            delta: {
              current: finance?.revenue ?? 0,
              previous: previousFinance?.revenue,
              better: 'up',
            },
            trend: revenueTrend,
            trendFormat: fmt.cny,
            trendBars: hourly,
            hint: t('{{orders}} orders · {{users}} payers', {
              orders: finance?.orders ?? 0,
              users: finance?.paying_users ?? 0,
            }),
          },
          {
            label: t('Requests'),
            featured: true,
            value: fmt.num(quality?.requests ?? 0),
            delta: {
              current: quality?.requests ?? 0,
              previous: previousQuality?.requests,
              better: 'neutral',
            },
            trend: requestsTrend,
            trendBars: hourly,
            hint: t('Consumption {{amount}} at list price', {
              amount: fmt.cny(
                (finance?.consumption_usd ?? 0) +
                  (finance?.root_consumption_usd ?? 0)
              ),
            }),
          },
          {
            label: t('Sign-ups'),
            featured: true,
            value: fmt.num(risk?.signups ?? 0),
            delta: {
              current: risk?.signups ?? 0,
              previous: previousRisk?.signups,
              better: 'neutral',
            },
            trend: signupTrend,
            trendBars: true,
          },
        ]}
      />
      <MetricGrid
        items={[
          {
            label: t('Failure rate'),
            value: fmt.pct(quality?.error_rate ?? 0),
            delta: qualitySampled
              ? {
                  current: quality?.error_rate ?? 0,
                  previous: previousQuality?.error_rate,
                  better: 'down',
                  points: true,
                }
              : undefined,
            tone: qualitySampled
              ? failureTone(quality?.error_rate ?? 0)
              : 'default',
            hint:
              quality && !qualitySampled
                ? t('Too few requests to judge')
                : undefined,
          },
          margin,
          {
            label: t('Active users'),
            value: fmt.num(activity?.active_users ?? 0),
            delta: {
              current: activity?.active_users ?? 0,
              previous: previousActivity?.active_users,
              better: 'up',
            },
          },
          {
            label: t('Peak concurrency'),
            value: fmt.num(capacity?.peak_concurrency ?? 0),
            tone:
              slots && (capacity?.peak_concurrency ?? 0) > slots
                ? 'danger'
                : 'default',
            delta: capacity
              ? {
                  current: capacity.peak_concurrency,
                  previous: previousCapacity?.peak_concurrency,
                  better: 'neutral',
                }
              : undefined,
            hint: capacity ? fmt.time(capacity.peak_at) : undefined,
          },
          {
            label: t('Debt (negative balances)'),
            value: fmt.cny(finance?.debt_usd ?? 0),
            tone:
              (finance?.debt_usd ?? 0) < DEBT_ALERT_USD ? 'danger' : 'default',
          },
          {
            label: t('Shared addresses'),
            value: fmt.num(clusters.length),
          },
        ]}
      />
      {pool?.configured && !pool.error && (
        <MetricGrid
          className='grid-cols-2 sm:grid-cols-3'
          items={[
            {
              label: t('Schedulable accounts'),
              value: `${pool.eligible_accounts} / ${pool.accounts.length}`,
              tone:
                pool.eligible_accounts <= ELIGIBLE_ACCOUNTS_LOW
                  ? 'danger'
                  : 'default',
            },
            {
              label: t('In flight now'),
              value: `${pool.in_flight} / ${pool.effective_slots}`,
              meter: pool.effective_slots
                ? {
                    value: pool.in_flight / pool.effective_slots,
                    label: t('In flight now'),
                  }
                : undefined,
            },
            {
              label: t('5-hour left'),
              value: five ? `≈ ${fmt.usdWhole(five.remaining_usd)}` : '-',
              meter: five
                ? {
                    value: share(five),
                    tone: share(five) < REMAINING_DANGER ? 'danger' : 'default',
                    label: t('5-hour left'),
                  }
                : undefined,
            },
          ]}
        />
      )}

      <TabDigest
        capacity={[capacity, previousCapacity]}
        quality={[quality, previousQuality]}
        finance={[finance, previousFinance]}
        risk={risk}
        upstream={[upstream, previousUpstream]}
        range={range}
        onOpen={props.onOpen}
      />
      <Panel
        title={t('Needs attention')}
        description={
          loading > 0
            ? t('Reading {{count}} more views…', { count: loading })
            : undefined
        }
        help={t(
          'Signals use the thresholds the tabs color by: failure rate above 2% over at least 100 requests, Claude TTFT p95 above 10 s, under a quarter of a quota budget left, debt beyond ¥1, two or fewer schedulable accounts. The last full hour is compared with the same hour of the previous period. The worst and largest come first.'
        )}
      >
        <Findings
          items={signals}
          empty={
            loading === 0
              ? t('Nothing needs attention in this range.')
              : undefined
          }
          onOpen={props.onOpen}
        />
      </Panel>

      <WhatChanged
        quality={[quality, previousQuality]}
        finance={[finance, previousFinance]}
      />

      <ProvidersPanel pool={pool} quality={quality} finance={finance} />
      <ShareCharts quality={quality} finance={finance} />
      <TopModelsPanel
        quality={quality}
        onOpen={props.onOpen ? () => props.onOpen?.('quality') : undefined}
      />
    </div>
  )
}
