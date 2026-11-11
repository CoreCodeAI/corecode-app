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
import { useTranslation } from 'react-i18next'

import {
  useHourAxis,
  useInsightsFormat,
  useSharedAddresses,
  useSignupMethodLabel,
  type InsightsRangeInfo,
  type InsightsTab,
} from '../lib'
import type { RiskInsights } from '../types'
import { useRiskVerdict } from '../verdicts'
import { largestSurge, useSurgeText } from '../verdicts/risk'
import {
  clusteredUserIds,
  materialDebtors,
  neverUsed,
  neverUsedComparable,
  rankClusters,
  riskRangeStart,
  riskSurges,
  signalDelta,
  signupUnit,
} from './risk-analysis'
import { ClusterList, DebtPanel, RiskControlLinks } from './risk-insights'
import {
  BarSeries,
  Breakdown,
  MetricGrid,
  Panel,
  SimpleTable,
  type BarPoint,
  type Tone,
  Verdict,
} from './shared'

export function RiskTab(props: {
  data: RiskInsights | undefined
  previous?: RiskInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const hourAxis = useHourAxis()
  const surgeText = useSurgeText()
  const verdict = useRiskVerdict(props.data, props.previous, props.range)
  const methodLabel = useSignupMethodLabel()
  const data = props.data
  const previous = props.previous
  const clusters = useSharedAddresses(data)
  const previousClusters = useSharedAddresses(previous)
  const ranked = data
    ? rankClusters(clusters, riskRangeStart(data, props.range))
    : []
  const repeatBuyers = clusters.some(
    (cluster) => cluster.subscription_buyers > 1
  )
  let sharedTone: Tone = clusters.length > 0 ? 'warning' : 'default'
  if (repeatBuyers) sharedTone = 'danger'

  const daily = data?.series_unit === 'day'
  const unit = daily ? 'day' : 'hour'
  const hourly = props.range?.hourly ?? !daily
  const end = props.range?.end ?? Number.POSITIVE_INFINITY
  const series = data?.signup_series ?? []
  const surges = data ? riskSurges(data, previous, props.range) : []
  const surgeAt = new Map(surges.map((surge) => [surge.at, surge]))
  const surge = largestSurge(surges)
  const span = props.range ? props.range.end - props.range.start : undefined
  const previousAt = new Map(
    (previous?.signup_series ?? []).map((point) => [point.at, point.count])
  )
  const pointTitle = (at: number) => (daily ? fmt.day(at) : fmt.time(at))
  const sameHourExtra = (at: number) => {
    if (daily || span == null || !previous) return undefined
    const before = previousAt.get(at - span)
    if (before == null) return undefined
    return [{ label: t('Same hour, previous period'), value: fmt.num(before) }]
  }
  const points: BarPoint[] = daily
    ? series.map((point) => ({
        key: point.at,
        title: pointTitle(point.at),
        values: [point.count],
        tone: surgeAt.has(point.at) ? 'danger' : undefined,
        faded: data ? point.at + signupUnit(data) > end : false,
      }))
    : hourAxis.bars(
        series.map((point) => ({ hour: point.at, count: point.count })),
        end,
        (row) => ({
          values: [row.count],
          extra: sameHourExtra(row.hour),
          tone: surgeAt.has(row.hour) ? 'danger' : undefined,
        })
      )

  let signupHint: string | undefined
  if (surge) {
    signupHint = surgeText(surge, unit)
  } else if (data?.peak_signups?.count) {
    signupHint = t('Busiest {{unit}}: {{count}} at {{time}}', {
      unit: daily ? t('day') : t('hour'),
      count: fmt.num(data.peak_signups.count),
      time: fmt.time(data.peak_signups.at),
    })
  }

  const cohort = data ? neverUsed(data) : undefined
  const previousCohort = previous ? neverUsed(previous) : undefined
  const share = (part: { zero: number; signups: number }) =>
    part.signups ? part.zero / part.signups : 0
  const comparable =
    !!cohort && neverUsedComparable(cohort, previousCohort, hourly)
  let neverUsedHint: string | undefined
  if (cohort?.signups) {
    neverUsedHint = cohort.mature
      ? t('{{share}} of sign-ups at least 6 hours old', {
          share: fmt.pct(share(cohort)),
        })
      : fmt.pct(share(cohort))
  }

  const debtors = materialDebtors(data?.debtors)
  const clustered = clusteredUserIds(clusters)

  return (
    <div className='grid gap-4'>
      <Verdict
        loading={!props.data}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
      />
      <RiskControlLinks />
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Sign-ups'),
            featured: true,
            value: fmt.num(data?.signups ?? 0),
            delta: {
              current: data?.signups ?? 0,
              previous: previous?.signups,
              better: 'neutral',
            },
            trend: series.map((point) => ({
              title: pointTitle(point.at),
              value: point.count,
            })),
            tone: surge ? 'warning' : undefined,
            hint: signupHint,
          },
          {
            label: t('Never sent a request'),
            value: fmt.num(cohort?.zero ?? 0),
            hint: neverUsedHint,
            help: cohort?.mature
              ? t(
                  'Counts only sign-ups at least 6 hours old, so new accounts have had time to send a first request.'
                )
              : undefined,
            delta:
              cohort && previousCohort && comparable
                ? {
                    current: share(cohort),
                    previous: share(previousCohort),
                    better: 'down',
                    points: true,
                  }
                : undefined,
          },
          {
            label: t('Alias emails'),
            value: fmt.num(data?.alias_emails ?? 0),
            tone: (data?.alias_emails ?? 0) > 0 ? 'warning' : 'default',
            delta: signalDelta(data?.alias_emails ?? 0, previous?.alias_emails),
          },
          {
            label: t('Off the domain allowlist'),
            value: fmt.num(data?.off_whitelist ?? 0),
            tone: (data?.off_whitelist ?? 0) > 0 ? 'warning' : 'default',
            delta: signalDelta(
              data?.off_whitelist ?? 0,
              previous?.off_whitelist
            ),
          },
          {
            label: t('Shared addresses'),
            value: fmt.num(clusters.length),
            hint: repeatBuyers ? t('One has several plan buyers') : undefined,
            tone: sharedTone,
            delta: signalDelta(
              clusters.length,
              previous ? previousClusters.length : undefined
            ),
          },
        ]}
      />

      <Panel
        title={t('Sign-ups over time')}
        description={surge ? surgeText(surge, unit) : undefined}
      >
        <BarSeries
          ariaLabel={t('Sign-ups over time')}
          series={[{ label: t('Sign-ups') }]}
          points={points}
        />
      </Panel>

      <Panel
        title={t('Accounts sharing an address')}
        description={
          data &&
          (clusters.length
            ? t(
                '{{count}} addresses are shared by several accounts, the riskiest first.',
                { count: clusters.length }
              )
            : undefined)
        }
        help={t(
          'Addresses several accounts sent requests or signed in from: one person with several accounts, a shared machine, or a reseller. Ranked by accounts created in the range, registrations within 10 minutes of each other, several plan buyers, and unpaid accounts with nothing left; an address where every account paid ranks low.'
        )}
      >
        {clusters.length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            {t('No address is shared in this range')}
          </p>
        ) : (
          <ClusterList clusters={ranked} />
        )}
      </Panel>

      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel title={t('Sign-up method')}>
          <Breakdown
            items={data?.signup_methods}
            label={methodLabel}
            empty={t('No sign-ups in this range')}
          />
        </Panel>
        <Panel title={t('Email domains')}>
          <SimpleTable
            rows={data?.email_domains}
            rowKey={(row) => row.domain}
            empty={t('No sign-ups in this range')}
            columns={[
              {
                key: 'domain',
                label: t('Domain'),
                render: (row) => (
                  <span
                    className={
                      row.whitelisted
                        ? undefined
                        : 'text-amber-600 dark:text-amber-400'
                    }
                  >
                    {row.domain}
                  </span>
                ),
              },
              {
                key: 'n',
                label: t('Accounts'),
                align: 'right',
                render: (row) => row.count,
              },
            ]}
          />
        </Panel>
        <DebtPanel debtors={debtors} clustered={clustered} loading={!data} />
      </div>
    </div>
  )
}
