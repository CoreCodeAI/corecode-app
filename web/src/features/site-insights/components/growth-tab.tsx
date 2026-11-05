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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  useChargeFormat,
  useInsightsFormat,
  useSignupMethodLabel,
} from '../lib'
import type {
  ActivityInsights,
  BusinessInsights,
  FunnelRow,
  GrowthInsights,
} from '../types'
import { GroupsPanel, ReferralPanel } from './business-panels'
import {
  BarSeries,
  type BarPoint,
  CountRate,
  MetricGrid,
  Panel,
  SimpleTable,
  UserLabel,
} from './shared'

export function GrowthTab(props: {
  data: GrowthInsights | undefined
  previous?: GrowthInsights
  /** Read for referrals and groups, which moved here from their own tab. */
  business?: BusinessInsights
  businessPrevious?: BusinessInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useSignupMethodLabel()
  const data = props.data
  const previous = props.previous
  const cohortHelp = t(
    'Accounts created in the range, followed up to now. Activated: sent a request. Paid: completed a gateway order.'
  )
  const funnel = data?.funnel
  const rate = (part: number, whole: number) =>
    whole ? fmt.pct(part / whole) : '-'
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

  return (
    <div className='grid gap-4'>
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Registered'),
            featured: true,
            value: fmt.num(funnel?.registered ?? 0),
            help: cohortHelp,
            delta: {
              current: funnel?.registered ?? 0,
              previous: previous?.funnel.registered,
              better: 'up',
            },
            trend: (data?.daily ?? []).map((day) => ({
              title: fmt.day(day.day),
              value: day.registered,
            })),
          },
          {
            label: t('Activated'),
            value: fmt.num(funnel?.activated ?? 0),
            hint: rate(funnel?.activated ?? 0, funnel?.registered ?? 0),
            help: cohortHelp,
            tone:
              funnel &&
              funnel.registered > 0 &&
              funnel.activated / funnel.registered < 0.3
                ? 'warning'
                : 'default',
          },
          {
            label: t('Has paid'),
            value: fmt.num(funnel?.paid ?? 0),
            hint: rate(funnel?.paid ?? 0, funnel?.registered ?? 0),
            help: cohortHelp,
          },
          {
            label: t('Paid again'),
            value: fmt.num(funnel?.repeat ?? 0),
            hint: t('{{rate}} of payers', {
              rate: rate(funnel?.repeat ?? 0, funnel?.paid ?? 0),
            }),
          },
          {
            label: t('Plan → top-up'),
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
      <Panel title={t('Sign-ups by day and what they did')} help={cohortHelp}>
        <BarSeries
          ariaLabel={t('Sign-ups by day')}
          series={[
            { label: t('Has paid') },
            { label: t('Activated, not paid') },
            { label: t('Not activated'), muted: true },
          ]}
          points={(data?.daily ?? []).map((day) => ({
            key: day.day,
            title: fmt.day(day.day),
            values: [
              day.paid,
              Math.max(day.activated - day.paid, 0),
              Math.max(day.registered - day.activated, 0),
            ],
          }))}
        />
      </Panel>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel title={t('Funnel by sign-up method')}>
          <SimpleTable
            rows={data?.by_source}
            rowKey={(row) => row.segment}
            empty={t('No sign-ups in this range')}
            columns={funnelColumns}
          />
        </Panel>
        <Panel title={t('Funnel by referral')}>
          <SimpleTable
            rows={data?.by_invite}
            rowKey={(row) => row.segment}
            empty={t('No sign-ups in this range')}
            columns={funnelColumns}
          />
        </Panel>
      </div>
      <ReferralPanel data={props.business} previous={props.businessPrevious} />
      <GroupsPanel data={props.business} />
    </div>
  )
}

/** How the daily consumption chart reads a day. */
type SpendMeasure = 'usd' | 'cny' | 'engine'

export function ActivityTab(props: {
  data: ActivityInsights | undefined
  previous?: ActivityInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  const charge = useChargeFormat(data)
  const previous = props.previous
  const daily = data?.daily ?? []
  const last = daily.at(-1)
  const engine = data?.engine_cost
  const engineReady = !!engine?.configured && !engine.error
  const engineByDay = new Map(
    (engine?.daily ?? []).map((day) => [day.day, day])
  )
  const engineHelp = t(
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

  return (
    <div className='grid gap-4'>
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Active users'),
            featured: true,
            value: fmt.num(data?.active_users ?? 0),
            delta: {
              current: data?.active_users ?? 0,
              previous: previous?.active_users,
              better: 'up',
            },
            trend: daily.map((day) => ({
              title: fmt.day(day.day),
              value: day.dau,
            })),
            hint: t('DAU {{dau}} · WAU {{wau}} on the last day', {
              dau: fmt.num(last?.dau ?? 0),
              wau: fmt.num(last?.wau ?? 0),
            }),
          },
          {
            label: t('Consumption'),
            help: t(
              'What new-api charged, in dollars at the site’s exchange rate: quota dollars that customers pay ¥1 each for, so yuan. Below, the yuan, and what gpt-load’s requests for every model were worth at official prices.'
            ),
            value: fmt.usd(charge.toUSD(quota)),
            hint: totalReady
              ? t('{{cny}} · gpt-load {{engine}}', {
                  cny: fmt.cny(quota),
                  engine: fmt.usd(total.cost_usd),
                })
              : fmt.cny(quota),
            delta: {
              current: data?.quota_usd ?? 0,
              previous: previous?.quota_usd,
              better: 'up',
            },
          },
          {
            label: t('Requests'),
            value: fmt.num(data?.requests ?? 0),
            delta: {
              current: data?.requests ?? 0,
              previous: previous?.requests,
              better: 'up',
            },
          },
          {
            label: t('Claude official cost'),
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
            value: data?.active_users
              ? fmt.usd(charge.toUSD(data.quota_usd) / data.active_users)
              : '-',
            hint: t('Consumption per active user'),
          },
          {
            label: t('Top 3 share'),
            value: fmt.pct(data?.top3_share ?? 0),
            hint: t('Top 1: {{top1}} · Top 10: {{top10}}', {
              top1: fmt.pct(data?.top1_share ?? 0),
              top10: fmt.pct(data?.top10_share ?? 0),
            }),
            help: t(
              'Share of consumption from the three largest customers. Colored above 60%, where losing one customer moves the total.'
            ),
            tone: (data?.top3_share ?? 0) > 0.6 ? 'warning' : 'default',
          },
        ]}
      />
      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel title={t('Daily active users')}>
          <BarSeries
            ariaLabel={t('Daily active users')}
            series={[{ label: t('DAU') }]}
            points={daily.map((day) => ({
              key: day.day,
              title: fmt.day(day.day),
              values: [day.dau],
              extra: [{ label: t('WAU'), value: fmt.num(day.wau) }],
            }))}
          />
        </Panel>
        <Panel
          title={t('Daily consumption')}
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
          }
        >
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
            {measure === 'engine' && (total?.unpriced_requests ?? 0) > 0 && (
              <p className='text-muted-foreground text-xs'>
                {t(
                  '{{count}} requests had no gpt-load price and are not in its value.',
                  { count: total?.unpriced_requests }
                )}
              </p>
            )}
          </div>
        </Panel>
      </div>
      <Panel
        title={t('Daily Claude cost at official prices')}
        help={engineHelp}
        description={
          engineReady && engine.cost_usd > 0
            ? t(
                'Charged {{charged}} against {{official}} at official prices.',
                {
                  charged: charge.usd(charge.toUSD(quota)),
                  official: fmt.usd(engine.cost_usd),
                }
              )
            : undefined
        }
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
        {(!engine || engineReady) && (
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
                extra: [
                  {
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
          'Share of each day’s sign-ups that sent a request N days later. Day 0 is the sign-up day.'
        )}
      >
        <RetentionGrid data={data} />
      </Panel>
      <Panel title={t('Top customers by consumption')}>
        <SimpleTable
          rows={data?.top_users}
          rowKey={(row) => row.user_id}
          empty={t('No consumption in this range')}
          columns={[
            {
              key: 'user',
              label: t('User'),
              render: (row) => <UserLabel {...row} />,
            },
            {
              key: 'usd',
              label: t('Consumption'),
              align: 'right',
              render: (row) => charge.usd(charge.toUSD(row.quota_usd)),
            },
            {
              key: 'share',
              label: t('Share'),
              align: 'right',
              render: (row) => fmt.pct(row.share),
            },
            {
              key: 'req',
              label: t('Requests'),
              align: 'right',
              render: (row) => fmt.num(row.requests),
            },
          ]}
        />
      </Panel>
    </div>
  )
}

function RetentionGrid(props: { data: ActivityInsights | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const cohorts = props.data?.retention ?? []
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
                                  value > 0.5 && 'text-primary-foreground'
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
                            {t(
                              '{{share}} of the {{size}} users who signed up {{day}} sent requests on D{{n}}',
                              {
                                share: fmt.pct(value),
                                size: fmt.num(cohort.size),
                                day: fmt.day(cohort.day),
                                n: day,
                              }
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
