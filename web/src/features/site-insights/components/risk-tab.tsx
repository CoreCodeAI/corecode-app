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
  joinSentences,
  rangeSpan,
  tableState,
  useHourAxis,
  useInsightsFormat,
  useSharedAddresses,
  useSignupMethodLabel,
  type InsightsRangeInfo,
  type InsightsSources,
  type InsightsTab,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type { RiskInsights } from '../types'
import { useRiskVerdict } from '../verdicts'
import { largestSurge, useSurgeText } from '../verdicts/risk'
import {
  clusteredUserIds,
  exitsOf,
  hasRepeatBuyers,
  materialDebtors,
  MIN_SIGNAL_COUNT,
  neverUsed,
  neverUsedComparable,
  riskRangeStart,
  riskSurges,
  sharedCounts,
  sharedExitSource,
  signalDelta,
  signupUnit,
  suspectInviters,
  unpaidSpend,
  usesGiftPart,
} from './risk-analysis'
import {
  AliasClusterPanel,
  DebtPanel,
  GiftGuardPanel,
  RiskControlLinks,
  SharedAddressPanel,
  UnpaidSpendersPanel,
} from './risk-insights'
import {
  BarSeries,
  Breakdown,
  MetricGrid,
  Panel,
  SimpleTable,
  type BarPoint,
  type MetricItem,
  type Tone,
  Verdict,
} from './shared'

export function RiskTab(props: {
  data: RiskInsights | undefined
  previous?: RiskInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('risk')
  const hourAxis = useHourAxis()
  const surgeText = useSurgeText()
  const verdict = useRiskVerdict(props.data, props.previous, props.range)
  const methodLabel = useSignupMethodLabel()
  const data = props.data
  const previous = props.previous
  const viewSource = props.sources?.view
  // With no data, a failed view shows - on every card; a pending one, skeletons.
  const failed = !data && viewSource?.status === 'error'
  const listState = tableState(viewSource, data)
  const clusters = useSharedAddresses(data)
  const previousClusters = useSharedAddresses(previous)
  const topExits = useSharedAddresses(sharedExitSource(data))
  const previousTopExits = useSharedAddresses(sharedExitSource(previous))
  const exits = exitsOf(data, clusters, topExits)
  const previousExits = exitsOf(previous, previousClusters, previousTopExits)
  const shared = sharedCounts(data, clusters, exits)
  const previousShared = previous
    ? sharedCounts(previous, previousClusters, previousExits)
    : undefined
  const repeatBuyers = hasRepeatBuyers(clusters)
  const limitedBuyers = clusters.some((cluster) => cluster.shared_exit != null)
  let sharedTone: Tone = shared.total > 0 ? 'warning' : 'default'
  if (repeatBuyers) sharedTone = 'danger'
  let buyersHint: string | undefined
  if (repeatBuyers) {
    buyersHint = limitedBuyers
      ? t('One has several recent buyers of one-per-user plans')
      : t('One has several plan buyers')
  }
  const exitsHint =
    shared.exits > 0
      ? t('{{count}} shared exits left out', { count: shared.exits })
      : undefined
  const previousMissing =
    !previous && props.sources?.previous.status === 'error'

  const daily = data?.series_unit === 'day'
  const unit = daily ? 'day' : 'hour'
  const hourly = props.range?.hourly ?? !daily
  const end = props.range?.end ?? Number.POSITIVE_INFINITY
  const series = data?.signup_series ?? []
  const surges = data ? riskSurges(data, previous, props.range) : []
  const surgeAt = new Map(surges.map((surge) => [surge.at, surge]))
  const surge = largestSurge(surges)
  const span = props.range ? rangeSpan(props.range) : undefined
  const previousAt = new Map(
    (previous?.signup_series ?? []).map((point) => [point.at, point.count])
  )
  const pointTitle = (at: number) => (daily ? fmt.day(at) : fmt.time(at))
  // Only a series by day has days the range covers in part.
  const pointPartial = (point: { at: number; count: number }) =>
    data?.series_unit === 'day'
      ? partialDay(point.at, [point.count])
      : undefined
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
        partial: pointPartial(point),
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
  } else if (data?.deleted_signups) {
    signupHint = t('{{count}} deleted since', {
      count: fmt.num(data.deleted_signups),
    })
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
  if (cohort?.failed) {
    // A middle dot, not a full stop: the hint's first part is a figure, and
    // a typed stop would be the wrong mark in half the languages.
    neverUsedHint = [
      neverUsedHint,
      t('{{count}} of them tried and every request failed.', {
        count: fmt.num(cohort.failed),
      }),
    ]
      .filter(Boolean)
      .join(' · ')
  }
  const neverUsedHelp = joinSentences(
    t(
      'Sign-ups with no successful request: a request that failed does not count as use.'
    ),
    cohort?.mature &&
      t(
        'Counts only sign-ups at least 6 hours old, so new accounts have had time to send a first request.'
      ),
    cohort?.failed != null &&
      t(
        'Those that tried and only failed are lost conversions more than junk sign-ups: check quality for the hours they tried.'
      )
  )

  const debtors = materialDebtors(data?.debtors)
  const clustered = clusteredUserIds([...clusters, ...exits])
  const spend = unpaidSpend(data)
  const previousSpend = unpaidSpend(previous)
  const inviters = suspectInviters(data)

  const canonicalAlias = data?.alias_pattern_emails != null
  const aliasHint =
    canonicalAlias && data?.alias_pattern_emails
      ? t('{{count}} with a +tag or dotted Gmail address', {
          count: fmt.num(data.alias_pattern_emails),
        })
      : undefined
  const restrictionOff = data?.email_restriction === false
  const offTone: Tone =
    !restrictionOff && (data?.off_whitelist ?? 0) > 0 ? 'warning' : 'default'

  const items: MetricItem[] = [
    {
      label: t('Sign-ups'),
      featured: true,
      value: fmt.num(data?.signups ?? 0),
      missing: failed,
      delta: {
        current: data?.signups ?? 0,
        previous: previous?.signups,
        better: 'neutral',
      },
      trend: series.map((point) => ({
        title: pointTitle(point.at),
        value: point.count,
        partial: pointPartial(point),
      })),
      tone: surge ? 'warning' : undefined,
      hint:
        previousMissing && !surge
          ? t('The previous period could not be read, so no change is shown.')
          : signupHint,
      help:
        data?.deleted_signups != null
          ? t(
              'Accounts created in the range, root and staff left out, deleted accounts included.'
            )
          : undefined,
    },
    {
      label: t('No successful request'),
      value: fmt.num(cohort?.zero ?? 0),
      missing: failed,
      hint: neverUsedHint,
      help: neverUsedHelp,
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
      missing: failed,
      tone: (data?.alias_emails ?? 0) > 0 ? 'warning' : 'default',
      hint: aliasHint,
      help: canonicalAlias
        ? t(
            'Sign-ups whose inbox another account already has, once case, the +tag and Gmail dots are ignored. A +tag or dotted Gmail address alone is not counted.'
          )
        : undefined,
      delta: signalDelta(data?.alias_emails ?? 0, previous?.alias_emails),
    },
    {
      label: t('Off the domain allowlist'),
      value: fmt.num(data?.off_whitelist ?? 0),
      missing: failed,
      tone: offTone,
      hint: restrictionOff
        ? t('Domain restriction is off: not checked')
        : undefined,
      help:
        data?.email_restriction != null
          ? t(
              'Email sign-ups whose domain is not on the allowlist, counted only while the domain restriction is on and the list is not empty.'
            )
          : undefined,
      delta: restrictionOff
        ? undefined
        : signalDelta(data?.off_whitelist ?? 0, previous?.off_whitelist),
    },
    {
      label: t('Shared addresses'),
      value: fmt.num(shared.total),
      missing: failed,
      hint: buyersHint ?? exitsHint,
      tone: sharedTone,
      delta: signalDelta(shared.total, previousShared?.total),
    },
  ]
  if (spend) {
    let spendHint: string | undefined
    if (spend.unpaid > 0) {
      spendHint = t('{{amount}} used; {{share}} of new accounts that spent', {
        amount: fmt.cny(spend.spend),
        share: fmt.pct(spend.share),
      })
    }
    items.push({
      label: t('Spent without paying'),
      value: fmt.num(spend.unpaid),
      missing: failed,
      hint: spendHint,
      tone: inviters.unpaid > 0 ? 'warning' : 'default',
      help: usesGiftPart(data)
        ? t(
            'New accounts of the range that consumed in it and have never paid. An inviter with {{min}} or more of them and some gift credit turns this amber; credit an administrator granted by hand does not count.',
            { min: MIN_SIGNAL_COUNT }
          )
        : t(
            'New accounts of the range that consumed in it and have never paid. An inviter with {{min}} or more of them turns this amber.',
            { min: MIN_SIGNAL_COUNT }
          ),
      delta: signalDelta(spend.unpaid, previousSpend?.unpaid),
    })
  }

  return (
    <div className='grid gap-4'>
      <Verdict
        loading={!props.data && !failed}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
      />
      <RiskControlLinks />
      <MetricGrid loading={!data && !failed} items={items} />

      <Panel
        title={t('Sign-ups over time')}
        description={surge ? surgeText(surge, unit) : undefined}
      >
        {failed ? (
          <p className='text-muted-foreground text-xs'>
            {t('Could not be read')}
          </p>
        ) : (
          <BarSeries
            ariaLabel={t('Sign-ups over time')}
            series={[{ label: t('Sign-ups') }]}
            points={points}
          />
        )}
      </Panel>

      <SharedAddressPanel
        data={data}
        clusters={clusters}
        exits={exits}
        start={data ? riskRangeStart(data, props.range) : undefined}
        state={listState}
      />

      {(spend || data?.signup_gifts != null) && (
        <div className='grid gap-4 lg:grid-cols-2'>
          {spend && <UnpaidSpendersPanel data={data} state={listState} />}
          {data?.signup_gifts != null && (
            <GiftGuardPanel data={data} state={listState} />
          )}
        </div>
      )}

      {(data?.alias_clusters?.length ?? 0) > 0 && (
        <AliasClusterPanel data={data} />
      )}

      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel title={t('Sign-up method')}>
          <Breakdown
            items={data?.signup_methods}
            label={methodLabel}
            state={listState}
            empty={t('No sign-ups in this range')}
          />
        </Panel>
        <Panel title={t('Email domains')}>
          <SimpleTable
            rows={data?.email_domains}
            rowKey={(row) => row.domain}
            state={tableState(viewSource, data?.email_domains)}
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
        <DebtPanel
          debtors={debtors}
          clustered={clustered}
          loading={!data}
          state={listState}
        />
      </div>
    </div>
  )
}
