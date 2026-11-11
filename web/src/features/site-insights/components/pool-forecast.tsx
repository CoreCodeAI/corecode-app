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

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import { accountPrice, useInsightsFormat } from '../lib'
import {
  OUTLOOK_WINDOWS,
  type EngineOutlook,
  type EngineOutlookAddition,
  type EngineOutlookModel,
  type OutlookModelId,
} from '../types'
import {
  accountsToAdd,
  coverage,
  COVERAGE_TONES,
  pickModel,
  samplesWithin,
  useWindowLabel,
  windowOf,
  type Coverage,
} from './outlook'
import { OutlookChart, type OutlookChartReset } from './outlook-chart'
import {
  HelpLabel,
  Meter,
  Panel,
  ReadoutTip,
  SimpleTable,
  type Tone,
} from './shared'

const HOUR_MS = 3_600_000

type ModelKind = 'linear' | 'history' | 'smart'
type LinearModel = 'linear_1h' | 'linear_12h' | 'linear_24h'

const LINEAR_MODELS: LinearModel[] = ['linear_1h', 'linear_12h', 'linear_24h']
const LINEAR_HOURS: Record<LinearModel, number> = {
  linear_1h: 1,
  linear_12h: 12,
  linear_24h: 24,
}

// The pick is what the panel's figures are read under, so the picked item
// stands out more than the console's plain pressed toggle does.
const PICK =
  'text-muted-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary'

const TEXT_TONES: Record<Tone, string> = {
  default: '',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
  good: 'text-emerald-600 dark:text-emerald-400',
}

function kindOf(id: OutlookModelId): ModelKind {
  if (id === 'history' || id === 'smart') return id
  return 'linear'
}

function useModelLabel() {
  const { t } = useTranslation()
  return (id: OutlookModelId) => {
    if (id === 'history') return t('Same hours, last 7 days')
    if (id === 'smart') return t('Smart forecast')
    if (id === 'linear_1h') return t('Linear · last hour')
    return t('Linear · last {{count}} hours', { count: LINEAR_HOURS[id] })
  }
}

function useCoverageLabel() {
  const { t } = useTranslation()
  const labels: Record<Coverage, string> = {
    enough: t('Enough'),
    tight: t('Tight'),
    short: t('Short'),
  }
  return (value: Coverage) => labels[value]
}

function CoverageBadge(props: { value: Coverage }) {
  const label = useCoverageLabel()
  const variants = {
    enough: 'outline',
    tight: 'warning',
    short: 'destructive',
  } as const
  return <Badge variant={variants[props.value]}>{label(props.value)}</Badge>
}

/**
 * Whether the Claude pool's supply meets its demand over the next 5 hours,
 * 24 hours and 7 days, under a forecast the reader picks: the latest spend
 * rate held flat, the same hours of the last week, or the two combined with
 * the trend. Supply always counts the resets. Each window's figures are the
 * end of the curve drawn below them, and a table sets the forecasts side by
 * side.
 */
export function ForecastPanel(props: { outlook: EngineOutlook }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const windowLabel = useWindowLabel()
  const modelLabel = useModelLabel()
  const [kind, setKind] = useState<ModelKind>('smart')
  const [linear, setLinear] = useState<LinearModel>('linear_24h')
  const [picked, setPicked] = useState<number | null>(null)
  const outlook = props.outlook
  const model = pickModel(outlook, kind === 'linear' ? linear : kind)

  const help = t(
    'Demand is the forecast picked above, in the pool’s own dollars: gpt-load spend at official prices, weighted by the quota each model draws. The pool is then run forward under it: demand is spread over the accounts in proportion to what each can spend at once, a 5-hour window restarts 5 hours after an account’s first request in it, and a week restarts at its reset, dropping what was left. Supply is the most the pool can spend in the window, resets included. A window is short when demand goes unserved in it, which can happen while supply exceeds demand: quota that arrives after it was needed. Turned-away requests are not in the demand.'
  )

  if (!model) {
    return (
      <Panel title={t('Supply and demand')} help={help}>
        <p className='text-muted-foreground text-sm'>
          {t('No forecast could be built from the pool’s readings.')}
        </p>
      </Panel>
    )
  }

  const select = (id: OutlookModelId) => {
    setKind(kindOf(id))
    if (id !== 'history' && id !== 'smart') setLinear(id)
  }
  const at = (hours: number) =>
    fmt.time(Math.floor((outlook.observed_at_ms + hours * HOUR_MS) / 1000))
  const duration = (hours: number) => {
    if (hours < 1) {
      return t('{{minutes}} minutes', { minutes: Math.round(hours * 60) })
    }
    if (hours < 48) return t('{{hours}} hours', { hours: hours.toFixed(1) })
    return t('{{days}} days', { days: (hours / 24).toFixed(1) })
  }
  const planName = (item: EngineOutlookAddition) =>
    accountPrice(item.plan, item.tier)?.label ?? item.tier
  const additionCount = (item: EngineOutlookAddition) => {
    const count = accountsToAdd(item)
    return count == null ? t('over {{count}}', { count: 30 }) : String(count)
  }

  const week = windowOf(model.windows, 168)
  const firstShort = model.windows.find((row) => row.short_usd > 0)
  // The window drawn: the one picked, or the first that runs short, or the
  // day when none does.
  const hours = picked ?? firstShort?.hours ?? 24
  const drawn = windowOf(model.windows, hours)
  const addition = model.additions[0]
  const toAdd = addition ? accountsToAdd(addition) : null

  let verdict: string
  if (model.average_usd_per_hour <= 0) {
    verdict = t('No Claude spend logged in the last 24 hours.')
  } else if (week && week.short_usd > 0 && week.first_short_hours != null) {
    verdict = t(
      'Not enough under this forecast: the pool first has nothing to spend around {{time}}, and over the next 7 days {{amount}} of demand goes unserved across {{length}}.',
      {
        time: at(week.first_short_hours),
        amount: fmt.usdWhole(week.short_usd),
        length: duration(week.short_hours),
      }
    )
  } else {
    verdict = t(
      'Enough under this forecast: the next 7 days’ demand of {{demand}} is served in full.',
      { demand: fmt.usdWhole(week?.demand_usd ?? 0) }
    )
  }

  let blurb: string
  if (kind === 'history') {
    blurb = t(
      'Each hour of the day at its average over the last {{days}} days: {{rate}}/h on average. It knows the daily rhythm but lags a pool that is growing.',
      {
        days: Math.max(1, Math.round(outlook.history_hours / 24)),
        rate: fmt.usdWhole(model.average_usd_per_hour),
      }
    )
  } else if (kind === 'smart') {
    blurb = t(
      'The level the latest hours hold, moved through the day by the last week’s rhythm and grown by the trend of {{growth}} a day, damped. The last two hours run {{momentum}} their expected level, which fades within hours. {{rate}}/h now, {{average}}/h over the 7 days. Backtested, it comes closest of the three at every window.',
      {
        growth: fmt.pct(outlook.growth_per_day),
        momentum: fmt.multiple(outlook.momentum || 1),
        rate: fmt.usdWhole(model.rate_usd_per_hour),
        average: fmt.usdWhole(model.average_usd_per_hour),
      }
    )
  } else if (model.id === 'linear_1h') {
    blurb = t(
      'The spend rate of the last hour, {{rate}}/h, held flat. It follows the latest use at once but knows neither the time of day nor the trend.',
      { rate: fmt.usdWhole(model.rate_usd_per_hour) }
    )
  } else {
    blurb = t(
      'The spend rate of the last {{count}} hours, {{rate}}/h, held flat. It follows the latest use at once but knows neither the time of day nor the trend.',
      {
        count: LINEAR_HOURS[model.id as LinearModel] ?? 24,
        rate: fmt.usdWhole(model.rate_usd_per_hour),
      }
    )
  }

  const unavailable = (id: OutlookModelId) =>
    !outlook.models.some((row) => row.id === id && row.available)
  const count = samplesWithin(outlook.sample_hours, hours)
  const series = hours === 168 ? 'weekLeft' : 'drawable'
  const bandOf = (row: { drawable: number[]; week_left: number[] }) =>
    (series === 'weekLeft' ? row.week_left : row.drawable).slice(0, count)
  const resets: OutlookChartReset[] = outlook.resets
    .map((reset) => ({
      reset,
      hours: (reset.at_ms - outlook.observed_at_ms) / HOUR_MS,
    }))
    // Over 7 days the 5-hour resets all fall in the first hours.
    .filter(
      (item) =>
        item.hours <= hours &&
        (hours < 168 || item.reset.window === 'seven_day')
    )
    .map(({ reset, hours: resetHours }) => ({
      key: `${reset.window}-${reset.credential_id}`,
      hours: resetHours,
      window: reset.window,
      label:
        reset.window === 'five_hour'
          ? t('5-hour reset · {{account}} · +{{amount}}', {
              account: reset.email_mask,
              amount: fmt.usdWhole(reset.adds_usd),
            })
          : t('Weekly reset · {{account}} · +{{amount}}', {
              account: reset.email_mask,
              amount: fmt.usdWhole(reset.adds_usd),
            }),
    }))

  return (
    <Panel title={t('Supply and demand')} description={verdict} help={help}>
      <div className='grid gap-4'>
        <div className='grid gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <ToggleGroup
              variant='outline'
              size='sm'
              aria-label={t('Forecast')}
              value={[kind]}
              onValueChange={(value: string[]) => {
                const next = value.at(-1) as ModelKind | undefined
                if (next) setKind(next)
              }}
            >
              <ToggleGroupItem value='linear' className={PICK}>
                {t('Linear')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value='history'
                className={PICK}
                disabled={unavailable('history')}
              >
                {t('History')}
              </ToggleGroupItem>
              <ToggleGroupItem value='smart' className={PICK}>
                {t('Smart')}
              </ToggleGroupItem>
            </ToggleGroup>
            {kind === 'linear' && (
              <ToggleGroup
                variant='outline'
                size='sm'
                aria-label={t('Spend rate read from')}
                value={[model.id]}
                onValueChange={(value: string[]) => {
                  const next = value.at(-1) as LinearModel | undefined
                  if (next) setLinear(next)
                }}
              >
                {LINEAR_MODELS.map((id) => (
                  <ToggleGroupItem
                    key={id}
                    value={id}
                    className={PICK}
                    disabled={unavailable(id)}
                  >
                    {id === 'linear_1h'
                      ? t('Last hour')
                      : t('Last {{count}} hours', { count: LINEAR_HOURS[id] })}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </div>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            {blurb}
          </p>
          {outlook.usage_error && (
            <p className='text-xs text-amber-600 dark:text-amber-400'>
              {t(
                'gpt-load’s recent spend could not be read, so the 1-hour and 12-hour rates are unavailable: {{error}}',
                { error: outlook.usage_error }
              )}
            </p>
          )}
        </div>

        <dl className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          {OUTLOOK_WINDOWS.map((span) => (
            <WindowCard
              key={span}
              outlook={outlook}
              model={model}
              hours={span}
              label={windowLabel(span)}
              drawn={span === hours}
              at={at}
              duration={duration}
            />
          ))}
          <Card data-card-hover='false' className='bg-muted/20 gap-2 px-3 py-3'>
            <dt className='text-muted-foreground text-xs'>
              <HelpLabel
                label={t('Accounts to add')}
                help={t(
                  'The more of two counts under this forecast: accounts that bring the weekly load to 100% at the 7 days’ average demand, and the fewest that leave the 7 days without unserved demand. An added account is the plan’s median measured account in the pool, up to its group’s budget lines, with full windows now.'
                )}
              />
            </dt>
            <dd
              className={cn(
                'text-2xl font-semibold tabular-nums',
                toAdd !== 0 && TEXT_TONES.danger
              )}
            >
              {addition ? additionCount(addition) : '-'}
              {addition && (
                <span className='text-muted-foreground ml-1.5 text-sm font-normal'>
                  × {planName(addition)}
                </span>
              )}
            </dd>
            <dd>
              <ReadoutTip
                title={t('Weekly load {{load}}', {
                  load: fmt.pct(model.week_load),
                })}
                rows={[
                  {
                    key: 'demand',
                    label: t('Demand'),
                    value: t('{{amount}}/h', {
                      amount: fmt.usdWhole(model.average_usd_per_hour),
                    }),
                  },
                  {
                    key: 'supply',
                    label: t('Supply'),
                    value: t('{{amount}}/h', {
                      amount: fmt.usdWhole(outlook.sustainable_usd_per_hour),
                    }),
                  },
                ]}
              >
                <Meter
                  value={Math.min(model.week_load, 1) * 100}
                  tone={loadTone(model.week_load)}
                  label={t('Weekly load')}
                />
              </ReadoutTip>
            </dd>
            <dd className='text-muted-foreground grid gap-0.5 text-xs tabular-nums'>
              <span>
                <HelpLabel
                  label={t('Weekly load {{load}}', {
                    load: fmt.pct(model.week_load),
                  })}
                  help={t(
                    'The forecast’s average demand over what the weekly resets bring back. Above 100% the pool spends down what it holds, however the next days go.'
                  )}
                />
                {' · '}
                {t('{{demand}}/h of {{supply}}/h', {
                  demand: fmt.usdWhole(model.average_usd_per_hour),
                  supply: fmt.usdWhole(outlook.sustainable_usd_per_hour),
                })}
              </span>
              {addition && (
                <span>
                  {t('Keep up {{load}} · 7 days {{week}}', {
                    load: addition.keep_up,
                    week:
                      addition.cover_week ?? t('over {{count}}', { count: 30 }),
                  })}
                </span>
              )}
              {model.additions.slice(1).map((other) => (
                <span key={other.tier}>
                  {t('or {{count}} × {{plan}}', {
                    count: additionCount(other),
                    plan: planName(other),
                  })}
                </span>
              ))}
            </dd>
          </Card>
        </dl>

        <div className='grid gap-3'>
          <ToggleGroup
            variant='outline'
            size='sm'
            aria-label={t('Window drawn')}
            value={[String(hours)]}
            onValueChange={(value: string[]) => {
              const next = Number(value.at(-1))
              if (next) setPicked(next)
            }}
          >
            {OUTLOOK_WINDOWS.map((span) => (
              <ToggleGroupItem key={span} value={String(span)} className={PICK}>
                {windowLabel(span)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <OutlookChart
            title={windowLabel(hours)}
            hours={outlook.sample_hours.slice(0, count)}
            series={series}
            drawable={model.drawable.slice(0, count)}
            weekLeft={model.week_left.slice(0, count)}
            demand={model.demand.slice(0, count)}
            band={
              model.low && model.high
                ? { upper: bandOf(model.low), lower: bandOf(model.high) }
                : null
            }
            resets={resets}
            lowest={
              drawn && {
                usd: drawn.lowest_usd,
                hours: drawn.first_short_hours ?? drawn.lowest_hours,
              }
            }
            observedAt={outlook.observed_at_ms}
          />
        </div>

        <div className='grid gap-2'>
          <h4 className='text-xs font-medium'>
            <HelpLabel
              label={t('The forecasts side by side')}
              help={t(
                'Each forecast’s demand over the three windows, colored by whether the pool serves it, with the accounts it calls for. Pick a row to read the pool under it above.'
              )}
            />
          </h4>
          <SimpleTable<EngineOutlookModel>
            rows={outlook.models.filter((row) => row.available)}
            rowKey={(row) => row.id}
            empty=''
            columns={[
              {
                key: 'model',
                label: t('Forecast'),
                render: (row) => (
                  <button
                    type='button'
                    aria-pressed={row.id === model.id}
                    onClick={() => select(row.id)}
                    className={cn(
                      'hover:text-foreground focus-visible:ring-ring/50 rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-2',
                      row.id === model.id
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground'
                    )}
                  >
                    {modelLabel(row.id)}
                  </button>
                ),
              },
              {
                key: 'rate',
                label: t('Demand now'),
                align: 'right',
                render: (row) =>
                  t('{{amount}}/h', {
                    amount: fmt.usdWhole(row.rate_usd_per_hour),
                  }),
              },
              ...OUTLOOK_WINDOWS.map((span) => ({
                key: `w${span}`,
                label: windowLabel(span),
                align: 'right' as const,
                render: (row: EngineOutlookModel) => {
                  const cell = windowOf(row.windows, span)
                  const state = coverage(
                    cell,
                    windowOf(outlook.remaining, span)
                  )
                  return (
                    <span className={TEXT_TONES[COVERAGE_TONES[state]]}>
                      {fmt.usdWhole(cell?.demand_usd ?? 0)}
                      {cell && cell.short_usd > 0 && (
                        <span className='block text-xs'>
                          {t('{{amount}} unserved', {
                            amount: fmt.usdWhole(cell.short_usd),
                          })}
                        </span>
                      )}
                    </span>
                  )
                },
              })),
              {
                key: 'add',
                label: t('Accounts to add'),
                align: 'right',
                render: (row) =>
                  row.additions[0] ? additionCount(row.additions[0]) : '-',
              },
            ]}
          />
        </div>
      </div>
    </Panel>
  )
}

function loadTone(load: number): Tone {
  if (load >= 1) return 'danger'
  if (load >= 0.8) return 'warning'
  return 'default'
}

/**
 * One window of the forecast: its demand against the supply the resets
 * bring, whether the pool serves it, and where it is tightest or runs dry.
 */
function WindowCard(props: {
  outlook: EngineOutlook
  model: EngineOutlookModel
  hours: number
  label: string
  /** The chart below shows this window. */
  drawn: boolean
  at: (hours: number) => string
  duration: (hours: number) => string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const cell = windowOf(props.model.windows, props.hours)
  const supply = windowOf(props.outlook.remaining, props.hours)
  if (!cell || !supply) return null
  const state = coverage(cell, supply)
  const tone = COVERAGE_TONES[state]
  const low = windowOf(props.model.low?.windows, props.hours)
  const high = windowOf(props.model.high?.windows, props.hours)
  const share =
    supply.with_resets_usd > 0 ? cell.demand_usd / supply.with_resets_usd : 0
  return (
    <Card
      data-card-hover='false'
      className={cn(
        'bg-muted/20 gap-2 px-3 py-3',
        props.drawn && 'ring-primary/40 ring-2'
      )}
    >
      <dt className='flex items-center justify-between gap-2 text-xs'>
        <span className='text-muted-foreground'>{props.label}</span>
        <CoverageBadge value={state} />
      </dt>
      <dd className='grid grid-cols-2 gap-2 tabular-nums'>
        <span className='grid'>
          <span className='text-muted-foreground text-xs'>
            <HelpLabel
              label={t('Demand')}
              help={t(
                'What the forecast expects the pool to be asked for over the window. For the smart forecast, the range below is the 10th to 90th percentile of how its past forecasts compared with the use that followed.'
              )}
            />
          </span>
          <span className={cn('text-xl font-semibold', TEXT_TONES[tone])}>
            {fmt.usdWhole(cell.demand_usd)}
          </span>
        </span>
        <span className='grid'>
          <span className='text-muted-foreground text-xs'>
            <HelpLabel
              label={t('Supply')}
              help={t(
                'The most the pool can spend in the window, resets included: the figure the panel above shows with resets counted.'
              )}
            />
          </span>
          <span className='text-xl font-semibold'>
            {fmt.usdWhole(supply.with_resets_usd)}
          </span>
        </span>
      </dd>
      <dd>
        <ReadoutTip
          title={t('Demand is {{share}} of supply', { share: fmt.pct(share) })}
          rows={[
            {
              key: 'demand',
              label: t('Demand'),
              value: fmt.usdWhole(cell.demand_usd),
            },
            {
              key: 'supply',
              label: t('Supply'),
              value: fmt.usdWhole(supply.with_resets_usd),
            },
          ]}
        >
          <Meter
            value={Math.min(share, 1) * 100}
            tone={tone}
            label={t('{{label}}: demand over supply', { label: props.label })}
          />
        </ReadoutTip>
      </dd>
      <dd className='text-muted-foreground grid gap-0.5 text-xs tabular-nums'>
        <span>
          {t('Demand is {{share}} of supply', { share: fmt.pct(share) })}
          {low && high && low.demand_usd !== high.demand_usd && (
            <>
              {' · '}
              {t('Range {{low}} – {{high}}', {
                low: fmt.usdWhole(low.demand_usd),
                high: fmt.usdWhole(high.demand_usd),
              })}
            </>
          )}
        </span>
        {cell.short_usd > 0 && cell.first_short_hours != null ? (
          <span className='text-destructive'>
            {t(
              'Nothing to spend from {{time}} · {{length}} in all · {{amount}} unserved',
              {
                time: props.at(cell.first_short_hours),
                length: props.duration(cell.short_hours),
                amount: fmt.usdWhole(cell.short_usd),
              }
            )}
          </span>
        ) : (
          <span>
            <HelpLabel
              label={t('Tightest {{amount}} at {{time}}', {
                amount: fmt.usdWhole(cell.lowest_usd),
                time: props.at(cell.lowest_hours),
              })}
              help={t(
                'The least the pool could spend at once at any moment of the window. Near zero means a burst then would be turned away.'
              )}
            />
          </span>
        )}
      </dd>
    </Card>
  )
}
