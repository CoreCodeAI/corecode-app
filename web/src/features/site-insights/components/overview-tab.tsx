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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InsightsView } from '../api'
import {
  ATTENTION,
  countsRequestsOnce,
  DEBT_ALERT_USD,
  failureTone,
  joinSentences,
  namedHead,
  OVERVIEW_VIEWS,
  previousBeforeLogs,
  rangeHours,
  rangeSpan,
  SECTIONS,
  SMALL_SAMPLE,
  sourceState,
  useChargeFormat,
  useHourAxis,
  useInsightsDefinitions,
  useInsightsFormat,
  useSharedAddresses,
  useTabLabel,
  useVendorName,
  type InsightsRangeInfo,
  type InsightsTab,
  attentionLabel,
} from '../lib'
import { usePartialDays } from '../partial-days'
import { onSale } from '../quality-analysis'
import type {
  ActivityInsights,
  CapacityInsights,
  EngineHorizon,
  EngineOutlook,
  EnginePool,
  FinanceInsights,
  QualityInsights,
  ModelBehavior,
  RiskInsights,
  UpstreamInsights,
  UpstreamRunway,
} from '../types'
import { checkoutLossFindings, refundedCheckoutFindings } from './checkout-loss'
import { DigestSettings } from './digest-settings'
import { StaleNote, type Finding } from './insight-kit'
import {
  FAILING_RATE,
  marginCard,
  overviewExtraSignals,
} from './overview-analysis'
import {
  ProvidersPanel,
  ShareCharts,
  TopModelsPanel,
  type OverviewSources,
} from './overview-charts'
import { TabCards, WhatChanged } from './overview-insights'
import { KpiGrid, TopCustomersPanel } from './overview-kpis'
import { overviewTrends } from './overview-series'
import {
  overviewBehaviorSignals,
  overviewQuotaSignals,
  overviewRunwaySignals,
  overviewServiceSignals,
  peakTone,
  poolPeakAgainstSlots,
} from './overview-signals'
import { AttentionPanel, StatusBar } from './overview-status'
import { OverviewTrendCharts } from './overview-trend-charts'
import { useOverviewVerdicts } from './overview-verdicts'
import { rankClusters, riskRangeStart } from './risk-analysis'
import { MetricGrid, Panel, type MetricItem } from './shared'

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
const NAMED_VENDORS = new Set(['claude', 'codex', 'grok', 'gemini', 'media'])

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
  onOpen?: (tab: InsightsTab, section?: string) => void
  range?: InsightsRangeInfo
  /** The Claude pool's quota outlook, read by the overview's quota signal and capacity line. */
  outlook?: EngineOutlook
  /** How long each upstream account's balance lasts, read by the overview's runway signal. */
  runway?: UpstreamRunway
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const hours = useHourAxis()
  const tabLabel = useTabLabel()
  const vendorName = useVendorName()
  const definitions = useInsightsDefinitions()
  const financeDay = usePartialDays('finance')
  const qualityDay = usePartialDays('quality')
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
  const behavior = now<ModelBehavior>('model-behavior')
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
  // The logs of the request views begin here; the capacity view is the one
  // the overview already reads for its figures.
  const logsSince = capacity?.logs_since
  const previousMissing = range ? previousBeforeLogs(range, logsSince) : false

  const state = (view: (typeof OVERVIEW_VIEWS)[number]) =>
    sourceState(current[OVERVIEW_VIEWS.indexOf(view)])
  const sources: OverviewSources = {
    pool: state('pool'),
    quality: state('quality'),
    finance: state('finance'),
  }

  // The all-clear waits for every view and every comparison, so it never
  // speaks for figures still on their way.
  const loading =
    current.filter((result) => result.isPending).length +
    earlier.filter((result) => result.isPending).length
  const signals: Finding[] = [
    ...overviewExtraSignals(t, fmt, {
      capacity,
      previousCapacity,
      upstream,
      activity,
      range,
    }),
    ...overviewServiceSignals(t, fmt, {
      capacity,
      quality,
      finance,
      previousFinance,
    }),
    ...overviewQuotaSignals(t, fmt, props.outlook),
    ...overviewBehaviorSignals(t, behavior),
    ...overviewRunwaySignals(t, fmt, props.runway),
  ]

  OVERVIEW_VIEWS.forEach((view, index) => {
    // The behavior view is a bonus signal: an older server lacks it, and its
    // failure is no reason to flag the whole overview.
    if (view === 'model-behavior') return
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
  EARLIER_VIEWS.forEach((view, index) => {
    if (earlier[index].isError) {
      signals.push({
        key: `error-previous-${view}`,
        tone: 'default',
        title: t('{{view}}: the previous period could not be read', {
          view: tabLabel(view),
        }),
        detail: t('Its figures show no change against it.'),
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
          .map(
            (account) =>
              `#${account.credential_id} ${attentionLabel(account.status, t)}`
          )
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
    if (capacity.limit_rejection_total > 0) {
      const top = capacity.limit_rejected_users?.[0]
      signals.push({
        key: 'capacity-limit',
        tone: 'warning',
        // The same unit as the capacity tab: refused attempts, not requests.
        title: t(
          '{{count}} attempts refused by per-user limits, retries included.',
          { count: fmt.num(capacity.limit_rejection_total) }
        ),
        detail: top
          ? t('Most: {{user}} #{{id}}, {{count}} times', {
              user: top.username,
              id: top.user_id,
              count: top.count,
            })
          : undefined,
        tab: 'capacity',
        section: SECTIONS.limitRejections,
        impact: capacity.limit_rejection_total,
      })
    }
  }

  if (quality) {
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
        !NAMED_VENDORS.has(vendor.vendor) ||
        vendor.requests < SMALL_SAMPLE ||
        vendor.error_rate <= FAILING_RATE
      ) {
        continue
      }
      signals.push({
        key: `quality-vendor-${vendor.vendor}`,
        tone: 'warning',
        title: t('{{vendor}} fails {{rate}} of requests.', {
          vendor: vendorName(vendor.vendor),
          rate: fmt.pct(vendor.error_rate),
        }),
        detail: t('{{count}} failed', { count: vendor.errors }),
        tab: 'quality',
        impact: vendor.errors,
      })
    }
    const fails = (row: { requests: number; error_rate: number }) =>
      row.requests >= SMALL_SAMPLE && failureTone(row.error_rate) === 'danger'
    // A model taken off sale cannot be fixed: it is counted, not named.
    const failing = onSale(quality.models, quality)
      .filter(fails)
      .sort((a, b) => b.errors - a.errors)
    const retired = (quality.models ?? []).filter(fails).length - failing.length
    if (failing.length > 0) {
      signals.push({
        key: 'quality-models',
        tone: 'warning',
        title: t('{{count}} models fail more than 5% of requests', {
          count: failing.length,
        }),
        detail: joinSentences(
          namedHead(
            t,
            failing.map((row) => `${row.model} ${fmt.pct(row.error_rate)}`)
          ),
          retired > 0 &&
            t('{{count}} more were taken off sale and are left out.', {
              count: retired,
            })
        ),
        tab: 'quality',
        section: SECTIONS.models,
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
      section: SECTIONS.debtors,
      impact: -finance.debt_usd,
    })
  }

  // Checkouts that mostly fail, each method named with what its unpaid ones
  // could be worth at most; the finance tab's orders panel lists the same.
  signals.push(
    ...checkoutLossFindings(t, fmt, finance?.order_methods),
    ...refundedCheckoutFindings(t, fmt, finance?.order_methods)
  )

  if (risk) {
    // Named in the risk tab's order, so the first is the one it reviews first.
    const buyers = rankClusters(
      clusters.filter(
        (cluster) => cluster.subscription_buyers > 1 && !cluster.shared_exit
      ),
      riskRangeStart(risk, range)
    )
    if (buyers.length > 0) {
      signals.push({
        key: 'risk-buyers',
        tone: 'danger',
        title: t('{{count}} addresses have several plan buyers', {
          count: buyers.length,
        }),
        detail: namedHead(
          t,
          buyers.map((cluster) => cluster.ip)
        ),
        tab: 'risk',
        section: SECTIONS.sharedAddresses,
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
  // longer one by the day. The cards and the charts read the same series.
  const hourly = range?.hourly ?? false
  const end = range?.end ?? 0
  const span = range ? rangeSpan(range) : 0
  const trends = overviewTrends({
    hourly,
    end,
    span,
    previousMissing,
    logsSince,
    dayTitle: fmt.day,
    hourTitle: (hour) => hours.title(hour),
    financeDay,
    qualityDay,
    finance,
    previousFinance,
    quality,
    previousQuality,
    capacity,
    previousCapacity,
    risk,
    previousRisk,
    activity,
    previousActivity,
  })
  const once = countsRequestsOnce(quality)
  const qualitySampled = (quality?.requests ?? 0) >= SMALL_SAMPLE
  const five = pool?.five_hour_estimate
  const hoursInRange = range ? rangeHours(range) : 0
  const staleHours = Math.max(
    capacity?.stale_hours ?? 0,
    quality?.stale_hours ?? 0,
    finance?.stale_hours ?? 0
  )
  const headlinePending = (['finance', 'quality', 'risk'] as const).every(
    (view) => state(view).status === 'pending'
  )

  const attemptRate =
    once &&
    capacity?.attempts != null &&
    capacity.attempt_errors != null &&
    capacity.attempts > 0 &&
    capacity.attempts !== capacity.requests
      ? capacity.attempt_errors / capacity.attempts
      : undefined
  let failureHint: string | undefined
  if (quality && !qualitySampled) {
    failureHint = t('Too few requests to judge')
  } else if (attemptRate !== undefined) {
    failureHint = t('Attempts: {{rate}} failed', {
      rate: fmt.pct(attemptRate),
    })
  }
  const failureCard: MetricItem = {
    label: once ? t('Requests failed') : t('Failure rate'),
    help: once ? definitions.requests : definitions.requestsAsAttempts,
    missing: !quality,
    value: fmt.pct(quality?.error_rate ?? 0),
    delta:
      quality && qualitySampled
        ? {
            current: quality.error_rate,
            previous:
              countsRequestsOnce(previousQuality) === once
                ? previousQuality?.error_rate
                : undefined,
            better: 'down',
            points: true,
            missing: previousMissing,
          }
        : undefined,
    tone: qualitySampled ? failureTone(quality?.error_rate ?? 0) : 'default',
    hint: failureHint,
    trend: trends.failureRate,
    trendFormat: fmt.pct,
  }

  const poolPeak = poolPeakAgainstSlots(capacity)
  const peakCard: MetricItem = poolPeak
    ? {
        label: t('Pool peak'),
        help: joinSentences(definitions.poolPeak, definitions.sitePeak),
        value: fmt.num(poolPeak.peak),
        tone: peakTone(poolPeak.share),
        delta: {
          current: poolPeak.peak,
          previous: previousCapacity?.pool_peak,
          better: 'neutral',
          missing: previousMissing,
        },
        hint: t('{{slots}} slots now · site {{peak}}', {
          slots: fmt.num(poolPeak.slots),
          peak: fmt.num(capacity?.peak_concurrency ?? 0),
        }),
      }
    : {
        label: t('Peak concurrency'),
        help: definitions.sitePeak,
        missing: !capacity,
        value: fmt.num(capacity?.peak_concurrency ?? 0),
        delta: capacity
          ? {
              current: capacity.peak_concurrency,
              previous: previousCapacity?.peak_concurrency,
              better: 'neutral',
              missing: previousMissing,
            }
          : undefined,
        hint: capacity ? fmt.time(capacity.peak_at) : undefined,
      }

  const chargeOf = (data: FinanceInsights) =>
    data.consumption_usd + (data.root_consumption_usd ?? 0)
  const earned = finance?.recognized_revenue
  const kpis: MetricItem[] = [
    {
      label: t('Revenue'),
      help: definitions.paidRevenue,
      missing: !finance,
      value: fmt.cny(finance?.revenue ?? 0),
      delta: finance
        ? {
            current: finance.revenue,
            previous: previousFinance?.revenue,
            better: 'up',
          }
        : undefined,
      trend: trends.revenue,
      trendFormat: fmt.cny,
      trendBars: true,
      hint: finance
        ? t('{{orders}} orders · {{users}} payers', {
            orders: finance.orders,
            users: finance.paying_users,
          })
        : undefined,
    },
    {
      label: t('Revenue earned'),
      help: definitions.earnedRevenue,
      missing: !finance || earned === undefined,
      value: fmt.cny(earned ?? 0),
      delta:
        finance && earned !== undefined
          ? {
              current: earned,
              previous: previousFinance?.recognized_revenue,
              better: 'up',
            }
          : undefined,
      trend: trends.recognized,
      trendFormat: fmt.cny,
      trendBars: true,
      hint: finance
        ? t('Wallets {{wallet}} · plans {{plans}}', {
            wallet: fmt.cny(finance.recognized_wallet_revenue ?? 0),
            plans: fmt.cny(finance.recognized_subscription_revenue ?? 0),
          })
        : undefined,
    },
    margin,
    {
      label: t('Consumption'),
      help: definitions.listCharge,
      missing: !finance,
      value: fmt.cny(finance ? chargeOf(finance) : 0),
      delta: finance
        ? {
            current: chargeOf(finance),
            previous: previousFinance ? chargeOf(previousFinance) : undefined,
            better: 'up',
          }
        : undefined,
      trend: trends.consumption,
      trendFormat: fmt.cny,
      trendBars: true,
      hint: finance ? t('At list price, root and staff included.') : undefined,
    },
    {
      label: t('Requests'),
      help: joinSentences(
        once ? definitions.requests : definitions.requestsAsAttempts,
        definitions.everyone
      ),
      missing: !quality,
      value: fmt.num(quality?.requests ?? 0),
      delta: quality
        ? {
            current: quality.requests,
            previous:
              countsRequestsOnce(previousQuality) === once
                ? previousQuality?.requests
                : undefined,
            better: 'neutral',
            missing: previousMissing,
          }
        : undefined,
      trend: trends.requests,
      trendBars: true,
    },
    failureCard,
    {
      label: t('Active users'),
      missing: !activity,
      value: fmt.num(activity?.active_users ?? 0),
      delta: activity
        ? {
            current: activity.active_users,
            previous: previousActivity?.active_users,
            better: 'up',
            missing: previousMissing,
          }
        : undefined,
      trend: trends.activeUsers,
    },
    {
      label: t('Sign-ups'),
      missing: !risk,
      value: fmt.num(risk?.signups ?? 0),
      delta: risk
        ? {
            current: risk.signups,
            previous: previousRisk?.signups,
            better: 'neutral',
          }
        : undefined,
      trend: trends.signups,
      trendBars: true,
    },
  ]

  const verdicts = useOverviewVerdicts({
    capacity: [capacity, previousCapacity],
    quality: [quality, previousQuality],
    finance: [finance, previousFinance],
    risk,
    upstream: [upstream, previousUpstream],
    range,
    outlook: props.outlook,
  })
  const [attentionOpen, setAttentionOpen] = useState(false)
  const showAttention = () => {
    setAttentionOpen(true)
    // After the folded findings are drawn.
    requestAnimationFrame(() =>
      document
        .querySelector('#overview-attention')
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    )
  }
  const unreadable = (view: 'quality' | 'finance') =>
    state(view).status === 'error' && !(view === 'quality' ? quality : finance)

  return (
    <div className='grid gap-4'>
      <StatusBar
        signals={signals}
        verdicts={verdicts}
        loading={loading}
        read={{
          capacity: !!capacity,
          pool: !!pool,
          quality: !!quality,
          upstream: !!upstream,
          finance: !!finance,
          risk: !!risk,
        }}
        onOpen={props.onOpen}
        onShowAttention={showAttention}
        actions={<DigestSettings />}
      />
      <StaleNote staleHours={staleHours} rangeHours={hoursInRange} />
      <KpiGrid items={kpis} loading={headlinePending} />
      <OverviewTrendCharts
        trends={trends}
        loading={headlinePending}
        hourly={hourly}
        failed={{
          finance: unreadable('finance'),
          quality: unreadable('quality'),
        }}
      />

      <ShareCharts quality={quality} finance={finance} sources={sources} />
      <div className='grid gap-4 lg:grid-cols-2'>
        <TopModelsPanel
          quality={quality}
          source={sources.quality}
          onOpen={props.onOpen ? () => props.onOpen?.('quality') : undefined}
        />
        <TopCustomersPanel
          activity={activity}
          failed={state('activity').status === 'error'}
          onOpen={props.onOpen ? (tab) => props.onOpen?.(tab) : undefined}
        />
      </div>

      <WhatChanged
        quality={[quality, previousQuality]}
        finance={[finance, previousFinance]}
      />

      <Panel title={t('Right now')}>
        <MetricGrid
          className={
            pool?.configured && !pool.error
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
              : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-3'
          }
          items={[
            peakCard,
            {
              label: t('Debt (negative balances)'),
              help: definitions.live,
              missing: !finance,
              value: fmt.cny(finance?.debt_usd ?? 0),
              tone:
                (finance?.debt_usd ?? 0) < DEBT_ALERT_USD
                  ? 'danger'
                  : 'default',
              hint: definitions.now,
            },
            {
              label: t('Shared addresses'),
              missing: !risk,
              value: fmt.num(clusters.length),
            },
            ...(pool?.configured && !pool.error
              ? [
                  {
                    label: t('Schedulable accounts'),
                    help: definitions.live,
                    value: `${pool.eligible_accounts} / ${pool.accounts.length}`,
                    tone:
                      pool.eligible_accounts <= ELIGIBLE_ACCOUNTS_LOW
                        ? ('danger' as const)
                        : ('default' as const),
                    hint: definitions.now,
                  },
                  {
                    label: t('In flight now'),
                    help: definitions.live,
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
                    help: definitions.live,
                    value: five ? `≈ ${fmt.usdWhole(five.remaining_usd)}` : '-',
                    meter: five
                      ? {
                          value: share(five),
                          tone:
                            share(five) < REMAINING_DANGER
                              ? ('danger' as const)
                              : ('default' as const),
                          label: t('5-hour left'),
                        }
                      : undefined,
                    hint: definitions.now,
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      <ProvidersPanel
        pool={pool}
        quality={quality}
        finance={finance}
        sources={sources}
      />
      <TabCards verdicts={verdicts} onOpen={props.onOpen} />
      <AttentionPanel
        signals={signals}
        loading={loading}
        open={attentionOpen}
        onToggle={() => setAttentionOpen((open) => !open)}
        onOpen={props.onOpen}
        help={joinSentences(
          t(
            'Signals use the thresholds the tabs color by: failure rate above 2% over at least 100 requests, Claude TTFT p95 above 10 s, under a quarter of a quota budget left, debt beyond ¥1, two or fewer schedulable accounts. The last full hour is compared with the same hour of the previous period. The worst and largest come first.'
          ),
          t(
            'The pool’s peak is read against its slots from 80% of them; image and video tasks when over 5% of at least 100 finished failed; checkouts when the share paid fell under half the previous period’s, over at least 5 in each. Debt and the pool are as they stand now.'
          )
        )}
      />
    </div>
  )
}
