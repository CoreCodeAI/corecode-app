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
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { InsightsView } from '../api'
import {
  ATTENTION,
  DEBT_ALERT_USD,
  failureTone,
  OVERVIEW_VIEWS,
  SMALL_SAMPLE,
  useInsightsFormat,
  useSharedAddresses,
} from '../lib'
import type {
  CapacityInsights,
  EngineHorizon,
  EnginePool,
  FinanceInsights,
  QualityInsights,
  RiskInsights,
} from '../types'
import { ProvidersPanel, ShareCharts, TopModelsPanel } from './overview-charts'
import { MetricGrid, Panel } from './shared'

type InsightsQuery = {
  queryKey: readonly unknown[]
  queryFn: () => Promise<unknown>
  staleTime: number
}

type Signal = {
  key: string
  tone: 'danger' | 'warning'
  title: string
  detail?: string
  tab: Exclude<InsightsView, 'business'>
}

// The thresholds the tabs color by, so a signal here matches a colored
// figure there.
const ELIGIBLE_ACCOUNTS_LOW = 2
const REMAINING_DANGER = 0.1
const REMAINING_WARNING = 0.25
const TTFT_P95_SLOW_MS = 10_000

/**
 * The first tab: headline figures from several views, and a list of what
 * needs attention now, each linked to the tab that explains it. It reads
 * the same queries the tabs read, so opening one after it is instant.
 */
export function OverviewTab(props: {
  current: (view: InsightsView) => InsightsQuery
  previous: (view: InsightsView) => InsightsQuery
  refreshMs: Partial<Record<InsightsView, number>>
  onOpen: (view: Exclude<InsightsView, 'business'>) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const current = useQueries({
    queries: OVERVIEW_VIEWS.map((view) => ({
      ...props.current(view),
      refetchInterval: props.refreshMs[view] ?? false,
    })),
  })
  const earlier = useQueries({
    queries: (['quality', 'finance', 'risk'] as const).map((view) =>
      props.previous(view)
    ),
  })
  const capacity = current[0].data as CapacityInsights | undefined
  const pool = current[1].data as EnginePool | undefined
  const quality = current[2].data as QualityInsights | undefined
  const finance = current[3].data as FinanceInsights | undefined
  const risk = current[4].data as RiskInsights | undefined
  const previousQuality = earlier[0].data as QualityInsights | undefined
  const previousFinance = earlier[1].data as FinanceInsights | undefined
  const previousRisk = earlier[2].data as RiskInsights | undefined
  const clusters = useSharedAddresses(risk)

  const viewLabels: Record<Exclude<InsightsView, 'business'>, string> = {
    capacity: t('Capacity'),
    pool: t('Account pool'),
    quality: t('Service quality'),
    finance: t('Funds'),
    growth: t('Growth'),
    channels: t('Promotion channels'),
    activity: t('Activity & retention'),
    risk: t('Risk'),
  }
  const loading = current.filter((result) => result.isPending).length
  const signals: Signal[] = []

  OVERVIEW_VIEWS.forEach((view, index) => {
    if (current[index].isError) {
      signals.push({
        key: `error-${view}`,
        tone: 'warning',
        title: t('{{view}} could not be read', { view: viewLabels[view] }),
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
    const slots = capacity.pool.configured ? capacity.pool.effective_slots : 0
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
      })
    }
    if (engine > 0) {
      signals.push({
        key: 'capacity-engine',
        tone: 'warning',
        title: t('The pool was full {{count}} times', { count: engine }),
        detail: t('Requests the engine turned away with 429'),
        tab: 'capacity',
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
      })
    }
  }

  if (quality) {
    const tone = failureTone(quality.error_rate)
    if (tone === 'danger' || tone === 'warning') {
      signals.push({
        key: 'quality-rate',
        tone,
        title: t('Failure rate {{rate}}', {
          rate: fmt.pct(quality.error_rate),
        }),
        detail: t('{{count}} failed', { count: quality.errors }),
        tab: 'quality',
      })
    }
    if (quality.ttft_p95_ms > TTFT_P95_SLOW_MS) {
      signals.push({
        key: 'quality-ttft',
        tone: 'warning',
        title: t('TTFT p95 is {{value}}', {
          value: fmt.measuredMs(quality.ttft_p95_ms),
        }),
        tab: 'quality',
      })
    }
    const failing = (quality.models ?? []).filter(
      (row) =>
        row.requests >= SMALL_SAMPLE && failureTone(row.error_rate) === 'danger'
    )
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

  // Danger first; within a tone, the order the checks run.
  const rank = (signal: Signal) => (signal.tone === 'danger' ? 0 : 1)
  signals.sort((a, b) => rank(a) - rank(b))
  const five = pool?.five_hour_estimate

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
            trend: (finance?.daily ?? []).map((day) => ({
              title: fmt.day(day.day),
              value: day.topup + day.subscription,
            })),
            trendFormat: fmt.cny,
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
            trend: (quality?.daily ?? []).map((day) => ({
              title: fmt.day(day.day),
              value: day.requests,
            })),
            hint: t('Consumption {{amount}} at list price', {
              amount: fmt.cny(
                (finance?.consumption_usd ?? 0) +
                  (finance?.root_consumption_usd ?? 0)
              ),
            }),
          },
          {
            label: t('Failure rate'),
            value: fmt.pct(quality?.error_rate ?? 0),
            delta: {
              current: quality?.error_rate ?? 0,
              previous: previousQuality?.error_rate,
              better: 'down',
              points: true,
            },
            tone: failureTone(quality?.error_rate ?? 0),
          },
          {
            label: t('Sign-ups'),
            value: fmt.num(risk?.signups ?? 0),
            delta: {
              current: risk?.signups ?? 0,
              previous: previousRisk?.signups,
              better: 'neutral',
            },
          },
        ]}
      />
      {pool?.configured && !pool.error && (
        <MetricGrid
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
            {
              label: t('Peak concurrency'),
              value: fmt.num(capacity?.peak_concurrency ?? 0),
              hint: capacity ? fmt.time(capacity.peak_at) : undefined,
            },
            {
              label: t('Debt (negative balances)'),
              value: fmt.cny(finance?.debt_usd ?? 0),
              tone:
                (finance?.debt_usd ?? 0) < DEBT_ALERT_USD
                  ? 'danger'
                  : 'default',
            },
            {
              label: t('Shared addresses'),
              value: fmt.num(clusters.length),
            },
          ]}
        />
      )}

      <Panel
        title={t('Needs attention')}
        description={
          loading > 0
            ? t('Reading {{count}} more views…', { count: loading })
            : undefined
        }
        help={t(
          'Signals use the thresholds the tabs color by: failure rate above 2%, TTFT p95 above 10 s, under a quarter of a quota budget left, debt beyond $1, two or fewer schedulable accounts.'
        )}
      >
        {signals.length === 0 && loading === 0 ? (
          <p className='text-muted-foreground flex items-center gap-2 text-sm'>
            <CircleCheck className='size-4 text-emerald-600 dark:text-emerald-400' />
            {t('Nothing needs attention in this range.')}
          </p>
        ) : (
          <ul className='-my-2 divide-y'>
            {signals.map((signal) => {
              const Icon =
                signal.tone === 'danger' ? CircleAlert : TriangleAlert
              return (
                <li key={signal.key} className='flex items-start gap-3 py-2.5'>
                  <Icon
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      signal.tone === 'danger'
                        ? 'text-destructive'
                        : 'text-amber-600 dark:text-amber-400'
                    )}
                  />
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-medium'>{signal.title}</p>
                    {signal.detail && (
                      <p className='text-muted-foreground text-xs break-words'>
                        {signal.detail}
                      </p>
                    )}
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='shrink-0'
                    onClick={() => props.onOpen(signal.tab)}
                  >
                    {viewLabels[signal.tab]} →
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <ProvidersPanel pool={pool} quality={quality} finance={finance} />
      <ShareCharts quality={quality} finance={finance} />
      <TopModelsPanel
        quality={quality}
        onOpen={() => props.onOpen('quality')}
      />
    </div>
  )
}
