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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { alignPrevious } from '../analysis'
import {
  claudeCoverage,
  dayInProgress,
  hourSpan,
  lastFullDay,
  perActiveUser,
  signupBurst,
  stickiness,
  viewState,
  type ViewState,
} from '../growth-analysis'
import {
  joinSentences,
  MIN_COHORT,
  tableState,
  useChargeFormat,
  useHourAxis,
  useInsightsDefinitions,
  useInsightsFormat,
  useSignupMethodLabel,
  type InsightsRangeInfo,
  type InsightsSources,
  type InsightsTab,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type {
  ActivityInsights,
  BusinessInsights,
  FunnelRow,
  GrowthInsights,
} from '../types'
import { useActivityVerdict, useGrowthVerdict } from '../verdicts'
import { ACTIVATION_WARN, cohortJudgeable } from '../verdicts/growth'
import {
  HourlyActivePanel,
  HourlyConsumptionPanel,
  RetentionNeedsRange,
  TopCustomersPanel,
} from './activity-insights'
import { FunnelChart } from './advanced-charts'
import { GroupsPanel, ReferralPanel } from './business-panels'
import { SignupDriversPanel } from './growth-insights'
import {
  BarSeries,
  type BarPoint,
  CountRate,
  MetricGrid,
  Panel,
  SimpleTable,
  Verdict,
} from './shared'

export function GrowthTab(props: {
  data: GrowthInsights | undefined
  previous?: GrowthInsights
  /** Read for referrals and groups, which moved here from their own tab. */
  business?: BusinessInsights
  businessPrevious?: BusinessInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('growth')
  const verdict = useGrowthVerdict(props.data, props.previous, props.range)
  const label = useSignupMethodLabel()
  const hours = useHourAxis()
  const data = props.data
  const previous = props.previous
  const range = props.range
  const state = viewState(data, props.sources?.view)
  const failed = state === 'error'
  const viewError = failed ? t('Could not be read') : undefined
  const previousError =
    !previous && props.sources?.previous.status === 'error'
      ? t('The previous period could not be read, so no change is shown.')
      : undefined
  const cohortHelp = t(
    'Accounts created in the range, followed up to now. Activated: a request of theirs came back with usage (tokens or a charge) at any time up to now. Paid: completed a gateway order. Accounts deleted since are left out; the risk tab counts them.'
  )
  const funnel = data?.funnel
  const registered = funnel?.registered ?? 0
  const judgeable = cohortJudgeable(registered, range)
  const young = !!range?.hourly && registered > 0
  const hourly =
    range?.hourly && data?.hourly && data.hourly.length > 0 ? data.hourly : null
  const burst = hourly ? signupBurst(hourly) : null
  const rate = (part: number, whole: number) =>
    whole ? fmt.pct(part / whole) : '-'
  const sofar = (value: string) =>
    young ? t('{{rate}} so far', { rate: value }) : value
  const previousSegments = (rows: FunnelRow[] | null | undefined) =>
    new Map((rows ?? []).map((row) => [row.segment, row.registered]))
  const changeColumn = (before: Map<string, number>) => ({
    key: 'change',
    label: t('vs. previous period'),
    hint: t('Sign-ups against the same segment in the previous period.'),
    align: 'right' as const,
    render: (row: FunnelRow) => {
      const moved = row.registered - (before.get(row.segment) ?? 0)
      return moved > 0 ? `+${fmt.num(moved)}` : fmt.num(moved)
    },
  })
  const funnelColumns = [
    {
      key: 'segment',
      label: t('Segment'),
      render: (row: FunnelRow) => label(row.segment),
    },
    {
      key: 'reg',
      label: t('Registered'),
      align: 'right' as const,
      render: (row: FunnelRow) => fmt.num(row.registered),
    },
    {
      key: 'act',
      label: t('Activated'),
      align: 'right' as const,
      render: (row: FunnelRow) => (
        <CountRate
          count={fmt.num(row.activated)}
          rate={rate(row.activated, row.registered)}
        />
      ),
    },
    {
      key: 'paid',
      label: t('Has paid'),
      align: 'right' as const,
      render: (row: FunnelRow) => (
        <CountRate
          count={fmt.num(row.paid)}
          rate={rate(row.paid, row.registered)}
        />
      ),
    },
    {
      key: 'repeat',
      label: t('Paid again'),
      align: 'right' as const,
      render: (row: FunnelRow) => (
        <CountRate
          count={fmt.num(row.repeat)}
          rate={rate(row.repeat, row.paid)}
        />
      ),
    },
  ]
  const columnsWith = (before: FunnelRow[] | null | undefined) => {
    if (!previous) return funnelColumns
    return [
      ...funnelColumns.slice(0, 2),
      changeColumn(previousSegments(before)),
      ...funnelColumns.slice(2),
    ]
  }
  const small = (row: FunnelRow) => row.registered < MIN_COHORT
  const signupSeries = [
    { label: t('Has paid') },
    { label: t('Activated, not paid') },
    { label: t('Not activated'), muted: true },
  ]
  const previousHours =
    hourly && range
      ? alignPrevious(hourly, previous?.hourly, hourSpan(range))
      : []
  let funnelSentence: string | undefined
  if (funnel && young) {
    funnelSentence = t(
      '{{rate}} of sign-ups in this range have paid so far; they signed up hours ago.',
      { rate: fmt.pct(funnel.paid / registered) }
    )
  } else if (funnel && registered > 0) {
    funnelSentence = t('{{rate}} of sign-ups in this range have paid.', {
      rate: fmt.pct(funnel.paid / registered),
    })
  }

  return (
    <div className='grid gap-4'>
      <Verdict
        loading={state === 'loading'}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
      />
      <MetricGrid
        loading={state === 'loading'}
        items={[
          {
            label: t('Registered'),
            missing: failed,
            featured: true,
            value: fmt.num(funnel?.registered ?? 0),
            help: cohortHelp,
            delta: {
              current: funnel?.registered ?? 0,
              previous: previous?.funnel.registered,
              better: 'up',
            },
            trend: hourly
              ? hourly.map((hour) => ({
                  title: fmt.time(hour.hour),
                  value: hour.registered,
                }))
              : (data?.daily ?? []).map((day) => ({
                  title: fmt.day(day.day),
                  value: day.registered,
                  partial: partialDay(day.day, [day.registered]),
                })),
            trendBars: !!hourly,
          },
          {
            label: t('Activated'),
            missing: failed,
            value: fmt.num(funnel?.activated ?? 0),
            hint: sofar(rate(funnel?.activated ?? 0, registered)),
            help: young
              ? t(
                  'Accounts created in the range that had a request come back with usage (tokens or a charge). They signed up hours ago, so the rate is not judged until a longer range.'
                )
              : cohortHelp,
            tone:
              funnel &&
              judgeable &&
              funnel.activated / registered < ACTIVATION_WARN
                ? 'warning'
                : 'default',
          },
          {
            label: t('Has paid'),
            missing: failed,
            value: fmt.num(funnel?.paid ?? 0),
            hint: sofar(rate(funnel?.paid ?? 0, registered)),
            help: cohortHelp,
          },
          {
            label: t('Paid again'),
            missing: failed,
            value: fmt.num(funnel?.repeat ?? 0),
            hint: t('{{rate}} of payers', {
              rate: rate(funnel?.repeat ?? 0, funnel?.paid ?? 0),
            }),
          },
          {
            label: t('Plan → top-up'),
            missing: failed,
            value: fmt.num(data?.subscription_to_topup ?? 0),
            hint: t('{{rate}} of {{count}} plan buyers', {
              rate: rate(
                data?.subscription_to_topup ?? 0,
                data?.subscription_buyers ?? 0
              ),
              count: data?.subscription_buyers ?? 0,
            }),
          },
        ]}
      />
      {hourly && range ? (
        <Panel
          title={t('Sign-ups by hour and what they did')}
          help={t(
            'Accounts created in each hour, followed up to now. The readout lists the same hour of the previous period. The last hour is still filling.'
          )}
        >
          <BarSeries
            ariaLabel={t('Sign-ups by hour')}
            series={signupSeries}
            points={hours.bars(hourly, range.end, (hour, index) => {
              const before = previousHours[index]
              return {
                values: [
                  hour.paid,
                  Math.max(hour.activated - hour.paid, 0),
                  Math.max(hour.registered - hour.activated, 0),
                ],
                extra: before
                  ? [
                      {
                        label: t('Same hour, previous period'),
                        value: fmt.num(before.registered),
                      },
                    ]
                  : undefined,
                tone: burst?.hour === hour.hour ? 'warning' : undefined,
              }
            })}
          />
        </Panel>
      ) : (
        <Panel
          title={t('Sign-ups by day and what they did')}
          help={cohortHelp}
          error={viewError}
        >
          {!failed && (
            <BarSeries
              ariaLabel={t('Sign-ups by day')}
              series={signupSeries}
              points={(data?.daily ?? []).map((day) => {
                const values = [
                  day.paid,
                  Math.max(day.activated - day.paid, 0),
                  Math.max(day.registered - day.activated, 0),
                ]
                return {
                  key: day.day,
                  title: fmt.day(day.day),
                  values,
                  partial: partialDay(day.day, values),
                }
              })}
            />
          )}
        </Panel>
      )}
      <SignupDriversPanel
        data={data}
        previous={previous}
        previousError={previousError}
        range={range}
        onOpen={props.onOpen}
      />
      <Panel
        title={t('Sign-up funnel')}
        description={funnelSentence}
        help={cohortHelp}
        error={viewError}
      >
        {!failed && (
          <FunnelChart
            loading={!data}
            steps={[
              { label: t('Registered'), value: funnel?.registered ?? 0 },
              { label: t('Activated'), value: funnel?.activated ?? 0 },
              { label: t('Has paid'), value: funnel?.paid ?? 0 },
              { label: t('Paid again'), value: funnel?.repeat ?? 0 },
            ]}
          />
        )}
      </Panel>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel title={t('Funnel by sign-up method')}>
          <SimpleTable
            rows={data?.by_source}
            rowKey={(row) => row.segment}
            faded={small}
            empty={t('No sign-ups in this range')}
            columns={columnsWith(previous?.by_source)}
            state={tableState(props.sources?.view, data?.by_source)}
          />
        </Panel>
        <Panel title={t('Funnel by referral')}>
          <SimpleTable
            rows={data?.by_invite}
            rowKey={(row) => row.segment}
            faded={small}
            empty={t('No sign-ups in this range')}
            columns={columnsWith(previous?.by_invite)}
            state={tableState(props.sources?.view, data?.by_invite)}
          />
        </Panel>
      </div>
      <ReferralPanel
        data={props.business}
        previous={props.businessPrevious}
        source={props.sources?.business}
        previousSource={props.sources?.businessPrevious}
        range={range}
      />
      <GroupsPanel data={props.business} source={props.sources?.business} />
    </div>
  )
}

/** How the daily consumption chart reads a day. */
type SpendMeasure = 'usd' | 'cny' | 'engine'

export function ActivityTab(props: {
  data: ActivityInsights | undefined
  previous?: ActivityInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const defs = useInsightsDefinitions()
  const partialDay = usePartialDays('activity')
  const verdict = useActivityVerdict(props.data, props.previous)
  const data = props.data
  const charge = useChargeFormat(data)
  const previous = props.previous
  const range = props.range
  const state = viewState(data, props.sources?.view)
  const failed = state === 'error'
  const viewError = failed ? t('Could not be read') : undefined
  const previousError =
    !previous && props.sources?.previous.status === 'error'
      ? t('The previous period could not be read, so no change is shown.')
      : undefined
  // An older server counts root in every figure and sends no root_quota_usd.
  const customersOnly = data?.root_quota_usd != null
  const rootQuota = data?.root_quota_usd ?? 0
  const activeHelp = t(
    'A user is active when a request of theirs came back with usage (tokens or a charge); a request that came back with none does not count.'
  )
  const coverage = claudeCoverage(data)
  const daily = data?.daily ?? []
  const last = daily.at(-1)
  const hourly =
    range?.hourly && data?.hourly && data.hourly.length > 0 ? data.hourly : null
  const span = range ? range.end - range.start : 0
  const fullDay = lastFullDay(daily, range)
  const previousFullDay = lastFullDay(
    previous?.daily,
    range ? { start: range.start - span, end: range.start } : undefined
  )
  const sticky = fullDay ? stickiness(fullDay.dau, fullDay.wau) : null
  const stickyBefore = previousFullDay
    ? stickiness(previousFullDay.dau, previousFullDay.wau)
    : null
  const perUser = perActiveUser(data)
  const perUserBefore = perActiveUser(previous)
  const engine = data?.engine_cost
  const engineReady = !!engine?.configured && !engine.error
  const engineByDay = new Map(
    (engine?.daily ?? []).map((day) => [day.day, day])
  )
  const claudeCharged = data?.claude_quota_usd != null
  const engineHelp = claudeCharged
    ? t(
        'What the Claude requests in the range cost at Anthropic’s official prices, as corecode-engine priced each one. Claude’s charge is what new-api charged customers for Claude models at its own ratios, on the days the engine reported, through every channel that served them.'
      )
    : t(
        'What the Claude requests in the range cost at Anthropic’s official prices, as corecode-engine priced each one. Consumption is what new-api charged for every model at its own ratios.'
      )
  const total = data?.engine_total
  const totalReady = !!total?.configured && !total.error
  const totalByDay = new Map(
    (total?.daily ?? []).map((day) => [day.day, day.cost_usd])
  )
  const [picked, setPicked] = useState<SpendMeasure>('usd')
  const measure: SpendMeasure =
    picked === 'engine' && !totalReady ? 'usd' : picked
  const measures: Record<
    SpendMeasure,
    {
      label: string
      value: (day: (typeof daily)[number]) => number
      format: (value: number) => string
      compact: (value: number) => string
    }
  > = {
    usd: {
      label: t('new-api, US$'),
      value: (day) => charge.toUSD(day.quota_usd),
      format: fmt.usd,
      compact: fmt.usdCompact,
    },
    cny: {
      label: t('new-api, ¥'),
      value: (day) => day.quota_usd,
      format: fmt.cny,
      compact: fmt.cnyCompact,
    },
    engine: {
      label: t('gpt-load value'),
      value: (day) => totalByDay.get(day.day) ?? 0,
      format: fmt.usd,
      compact: fmt.usdCompact,
    },
  }
  const shown = measures[measure]
  const busiest = daily.reduce<(typeof daily)[number] | undefined>(
    (top, day) => (!top || shown.value(day) > shown.value(top) ? day : top),
    undefined
  )
  const spendPoints: BarPoint[] = daily.map((day) => ({
    key: day.day,
    title: fmt.day(day.day),
    values: [shown.value(day)],
    partial: partialDay(day.day, [shown.value(day)]),
    extra: [
      ...(['usd', 'cny', 'engine'] as const)
        .filter((key) => key !== measure && (key !== 'engine' || totalReady))
        .map((key) => ({
          label: measures[key].label,
          value: measures[key].format(measures[key].value(day)),
        })),
      { label: t('Requests'), value: fmt.num(day.requests) },
    ],
  }))
  const quota = data?.quota_usd ?? 0
  const spendTotals = totalReady
    ? t(
        'In the range, new-api charged {{usd}} ({{cny}}), and gpt-load’s requests were worth {{engine}} at official prices.',
        {
          usd: fmt.usd(charge.toUSD(quota)),
          cny: fmt.cny(quota),
          engine: fmt.usd(total.cost_usd),
        }
      )
    : t('In the range, new-api charged {{usd}} ({{cny}}).', {
        usd: fmt.usd(charge.toUSD(quota)),
        cny: fmt.cny(quota),
      })
  let claudeSentence: string | undefined
  if (coverage?.claudeOnly) {
    claudeSentence = t(
      'Claude charged {{charged}} against {{official}} at official prices, on the days the engine reported.',
      {
        charged: charge.usd(charge.toUSD(coverage.charged)),
        official: fmt.usd(coverage.official),
      }
    )
  } else if (coverage) {
    claudeSentence = t(
      'Charged {{charged}} against {{official}} at official prices.',
      {
        charged: charge.usd(charge.toUSD(coverage.charged)),
        official: fmt.usd(coverage.official),
      }
    )
  }

  return (
    <div className='grid gap-4'>
      <Verdict
        loading={state === 'loading'}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
      />
      <MetricGrid
        loading={state === 'loading'}
        items={[
          {
            label: t('Active users'),
            missing: failed,
            help: customersOnly
              ? joinSentences(activeHelp, defs.customers)
              : activeHelp,
            featured: true,
            value: fmt.num(data?.active_users ?? 0),
            delta: {
              current: data?.active_users ?? 0,
              previous: previous?.active_users,
              better: 'up',
            },
            trend: hourly
              ? hourly.map((hour) => ({
                  title: fmt.time(hour.hour),
                  value: hour.active_users,
                }))
              : daily.map((day) => ({
                  title: fmt.day(day.day),
                  value: day.dau,
                  // Distinct users do not add up hour by hour, so part of a day
                  // is marked, not projected.
                  partial: partialDay(day.day),
                })),
            trendBars: !!hourly,
            hint: t('DAU {{dau}} · WAU {{wau}} on the last day', {
              dau: fmt.num(last?.dau ?? 0),
              wau: fmt.num(last?.wau ?? 0),
            }),
          },
          {
            label: t('Consumption'),
            missing: failed,
            help: customersOnly
              ? t(
                  'What new-api charged customers, in dollars at the site’s exchange rate: quota dollars that customers pay ¥1 each for, so yuan. Root’s own use is left out and shown below on its own. Below, the yuan, and what gpt-load’s requests for every model were worth at official prices.'
                )
              : t(
                  'What new-api charged, in dollars at the site’s exchange rate: quota dollars that customers pay ¥1 each for, so yuan. Below, the yuan, and what gpt-load’s requests for every model were worth at official prices.'
                ),
            value: fmt.usd(charge.toUSD(quota)),
            hint: [
              totalReady
                ? t('{{cny}} · gpt-load {{engine}}', {
                    cny: fmt.cny(quota),
                    engine: fmt.usd(total.cost_usd),
                  })
                : fmt.cny(quota),
              rootQuota > 0 &&
                t('root {{amount}} apart', {
                  amount: fmt.usd(charge.toUSD(rootQuota)),
                }),
            ]
              .filter(Boolean)
              .join(' · '),
            delta: {
              current: data?.quota_usd ?? 0,
              previous: previous?.quota_usd,
              better: 'up',
            },
          },
          {
            label: t('Requests'),
            missing: failed,
            help: customersOnly
              ? joinSentences(
                  t(
                    'Every logged request, those that came back with no usage included.'
                  ),
                  defs.customers
                )
              : undefined,
            value: fmt.num(data?.requests ?? 0),
            delta: {
              current: data?.requests ?? 0,
              previous: previous?.requests,
              better: 'up',
            },
          },
          {
            label: t('Claude official cost'),
            missing: failed,
            value: engineReady ? fmt.usd(engine.cost_usd) : '-',
            hint: engineReady
              ? t('{{count}} requests in corecode-engine', {
                  count: fmt.num(engine.requests),
                })
              : t('corecode-engine unavailable'),
            help: engineHelp,
            delta: engineReady
              ? {
                  current: engine.cost_usd,
                  previous: previous?.engine_cost?.error
                    ? undefined
                    : previous?.engine_cost?.cost_usd,
                  better: 'up',
                }
              : undefined,
          },
          {
            label: t('Per active user'),
            missing: failed,
            value: perUser == null ? '-' : fmt.usd(charge.toUSD(perUser)),
            hint: t('Consumption per active user'),
            delta:
              perUser == null
                ? undefined
                : { current: perUser, previous: perUserBefore, better: 'up' },
          },
          {
            label: t('Stickiness'),
            missing: failed,
            value: sticky == null ? '-' : fmt.pct(sticky),
            hint: fullDay
              ? t('DAU ÷ WAU on {{day}}', { day: fmt.day(fullDay.day) })
              : t('No full day in this range'),
            help: t(
              'Users active on the last full day of the range, over users active in the seven days to it. Higher means users come back daily rather than now and then.'
            ),
            delta:
              sticky == null
                ? undefined
                : {
                    current: sticky,
                    previous: stickyBefore ?? undefined,
                    better: 'up',
                    points: true,
                  },
          },
          {
            label: t('Top 3 share'),
            missing: failed,
            value: fmt.pct(data?.top3_share ?? 0),
            hint: t('Top 1: {{top1}} · Top 10: {{top10}}', {
              top1: fmt.pct(data?.top1_share ?? 0),
              top10: fmt.pct(data?.top10_share ?? 0),
            }),
            help: joinSentences(
              t(
                'Share of consumption from the three largest customers. Colored above 60%, where losing one customer moves the total.'
              ),
              customersOnly && defs.customers
            ),
            tone: (data?.top3_share ?? 0) > 0.6 ? 'warning' : 'default',
            delta: {
              current: data?.top3_share ?? 0,
              previous: previous?.top3_share,
              better: 'down',
              points: true,
            },
          },
        ]}
      />
      {hourly && range && data ? (
        <div className='grid gap-4 lg:grid-cols-2'>
          <HourlyActivePanel rows={hourly} previous={previous} range={range} />
          <HourlyConsumptionPanel
            data={data}
            rows={hourly}
            previous={previous}
            range={range}
            totals={spendTotals}
          />
        </div>
      ) : (
        <div className='grid gap-4 lg:grid-cols-2'>
          <Panel
            title={t('Daily active users')}
            help={activeHelp}
            error={viewError}
          >
            {!failed && (
              <BarSeries
                ariaLabel={t('Daily active users')}
                series={[{ label: t('DAU') }]}
                points={daily.map((day) => ({
                  key: day.day,
                  title: fmt.day(day.day),
                  values: [day.dau],
                  partial: partialDay(day.day),
                  extra: [{ label: t('WAU'), value: fmt.num(day.wau) }],
                }))}
              />
            )}
          </Panel>
          <Panel
            title={t('Daily consumption')}
            error={viewError}
            help={t(
              'Three measures of the same use. new-api, US$ and ¥: what new-api charged for every model, quota dollars that customers pay ¥1 each for, so yuan, and in dollars at the site’s exchange rate. gpt-load value: what gpt-load’s requests for every model were worth at official prices, the unit the pool’s quota is in.'
            )}
            description={[
              spendTotals,
              busiest && shown.value(busiest) > 0
                ? t('Busiest day {{day}}: {{amount}}.', {
                    day: fmt.day(busiest.day),
                    amount: shown.format(shown.value(busiest)),
                  })
                : undefined,
            ]
              .filter(Boolean)
              .join(' ')}
            actions={
              failed ? undefined : (
                <ToggleGroup
                  variant='outline'
                  size='sm'
                  aria-label={t('Measure')}
                  value={[measure]}
                  onValueChange={(value: string[]) => {
                    const next = value.at(-1) as SpendMeasure | undefined
                    if (next) setPicked(next)
                  }}
                >
                  <ToggleGroupItem value='usd' aria-label={measures.usd.label}>
                    US$
                  </ToggleGroupItem>
                  <ToggleGroupItem value='cny' aria-label={measures.cny.label}>
                    ¥
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value='engine'
                    aria-label={measures.engine.label}
                    disabled={!totalReady}
                  >
                    gpt-load
                  </ToggleGroupItem>
                </ToggleGroup>
              )
            }
          >
            {!failed && (
              <div className='grid gap-2'>
                <BarSeries
                  ariaLabel={t('Daily consumption')}
                  series={[
                    {
                      label: shown.label,
                      format: shown.format,
                      compact: shown.compact,
                    },
                  ]}
                  points={spendPoints}
                />
                {total?.error && (
                  <p className='text-destructive text-xs'>{total.error}</p>
                )}
                {measure === 'engine' &&
                  (total?.unpriced_requests ?? 0) > 0 && (
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        '{{count}} requests had no gpt-load price and are not in its value.',
                        { count: total?.unpriced_requests }
                      )}
                    </p>
                  )}
              </div>
            )}
          </Panel>
        </div>
      )}
      <Panel
        title={t('Daily Claude cost at official prices')}
        help={engineHelp}
        error={viewError}
        description={claudeSentence}
      >
        {engine && !engine.configured && (
          <p className='text-muted-foreground text-sm'>
            {t(
              'Set EngineControlURL and EngineControlKey to read official-price cost from corecode-engine.'
            )}
          </p>
        )}
        {engine?.error && (
          <p className='text-destructive text-sm'>{engine.error}</p>
        )}
        {!failed && (!engine || engineReady) && (
          <BarSeries
            ariaLabel={t('Daily Claude cost at official prices')}
            series={[
              {
                label: t('Official cost'),
                format: fmt.usd,
                compact: fmt.usdCompact,
              },
            ]}
            points={daily.map((day) => {
              const official = engineByDay.get(day.day)
              return {
                key: day.day,
                title: fmt.day(day.day),
                values: [official?.cost_usd ?? 0],
                partial: partialDay(day.day, [official?.cost_usd ?? 0]),
                extra: [
                  claudeCharged
                    ? {
                        label: t('Claude charged'),
                        value: charge.usd(
                          charge.toUSD(day.claude_quota_usd ?? 0)
                        ),
                      }
                    : {
                        label: t('Charged'),
                        value: charge.usd(charge.toUSD(day.quota_usd)),
                      },
                  {
                    label: t('Claude requests'),
                    value: fmt.num(official?.requests ?? 0),
                  },
                ],
              }
            })}
          />
        )}
      </Panel>
      <Panel
        title={t('Retention by sign-up day')}
        help={t(
          'Share of each day’s sign-ups active N days later: a request of theirs came back with usage (tokens or a charge). Day 0 is the sign-up day. A faded cell is a day still in progress.'
        )}
        error={viewError}
      >
        {range?.hourly && <RetentionNeedsRange />}
        {!range?.hourly && !failed && (
          <RetentionGrid data={data} state={state} end={range?.end} />
        )}
      </Panel>
      <TopCustomersPanel
        data={data}
        previous={previous}
        previousError={previousError}
        state={tableState(props.sources?.view, data?.top_users)}
      />
    </div>
  )
}

function RetentionGrid(props: {
  data: ActivityInsights | undefined
  state: ViewState
  /** The range's end, unix seconds: a day that had not ended by it is in progress. */
  end?: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const cohorts = props.data?.retention ?? []
  const end = props.end
  if (props.state === 'loading') {
    return (
      <div role='status' aria-label={t('Loading...')} className='grid gap-2'>
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-full' />
      </div>
    )
  }
  if (cohorts.length === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('No sign-ups in this range')}
      </p>
    )
  }
  const width = Math.max(...cohorts.map((cohort) => cohort.days?.length ?? 0))
  return (
    <TooltipProvider delay={0}>
      <div className='-mx-4 overflow-x-auto px-4'>
        <table className='text-xs tabular-nums'>
          <thead>
            <tr className='text-muted-foreground'>
              <th className='pr-3 text-left font-normal'>{t('Sign-up day')}</th>
              <th className='pr-3 text-right font-normal'>{t('Users')}</th>
              {Array.from({ length: width }, (_, day) => (
                <th key={day} className='w-11 text-center font-normal'>
                  D{day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort.day}>
                <td className='pr-3 whitespace-nowrap'>
                  {fmt.day(cohort.day)}
                </td>
                <td className='pr-3 text-right'>{cohort.size}</td>
                {Array.from({ length: width }, (_, day) => {
                  const value = cohort.days?.[day]
                  const partial =
                    end != null && dayInProgress(cohort.day + day * 86400, end)
                  const reading = {
                    share: fmt.pct(value ?? 0),
                    size: fmt.num(cohort.size),
                    day: fmt.day(cohort.day),
                    n: day,
                  }
                  return (
                    <td key={day} className='p-0.5'>
                      {value == null ? null : (
                        <TapTooltip>
                          <TapTooltipTrigger
                            render={
                              <span
                                tabIndex={0}
                                className={cn(
                                  'hover:ring-foreground/30 focus-visible:ring-ring/50 block cursor-default rounded px-1 py-0.5 text-center outline-none hover:ring-1 focus-visible:ring-2',
                                  value > 0.5 && 'text-primary-foreground',
                                  partial && 'opacity-50'
                                )}
                                style={{
                                  backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(value * 100)}%, transparent)`,
                                }}
                              />
                            }
                          >
                            {Math.round(value * 100)}
                          </TapTooltipTrigger>
                          <TooltipContent>
                            {partial
                              ? t(
                                  '{{share}} of the {{size}} users who signed up {{day}} were active on D{{n}} so far; the day is still in progress.',
                                  reading
                                )
                              : t(
                                  '{{share}} of the {{size}} users who signed up {{day}} were active on D{{n}}',
                                  reading
                                )}
                          </TooltipContent>
                        </TapTooltip>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  )
}
