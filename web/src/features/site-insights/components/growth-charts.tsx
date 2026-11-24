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
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import {
  LOST_BUCKETS,
  lostPayers,
  niceScale,
  signupMoneyDays,
  signupWeeks,
  type SignupMoneyDay,
} from '../growth-weeks'
import { MIN_COHORT, useInsightsFormat } from '../lib'
import type { FunnelRow, GrowthInsights, SilentPayers } from '../types'
import { BarSeries, Panel } from './shared'

/** The three parts of a cohort, in the colors of the daily sign-up chart's bars. */
const STAGE_COLORS = [
  'bg-primary/70',
  'bg-sky-500/70',
  'bg-muted-foreground/30',
] as const

const STAGE_DOTS = ['bg-primary', 'bg-sky-500', 'bg-muted-foreground/40']

/** A row of swatches naming the series of the chart under it. */
function Legend(props: { items: { label: string; dot: string }[] }) {
  return (
    <ul className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs'>
      {props.items.map((item) => (
        <li key={item.label} className='flex items-center gap-1.5'>
          <span aria-hidden className={cn('size-2.5 rounded-sm', item.dot)} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * Sign-ups a week, split into those who paid, those who only used the
 * service, and the rest. A week the range holds in part is drawn faint.
 */
export function WeeklySignupsPanel(props: {
  daily: GrowthInsights['daily'] | undefined
  error?: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const weeks = signupWeeks(props.daily ?? [])
  // A single week is the daily chart's whole range: nothing to compare.
  if (weeks.length < 2 && !props.error) return null
  const best = weeks.reduce<(typeof weeks)[number] | undefined>(
    (top, week) =>
      week.partial || (top && top.registered >= week.registered) ? top : week,
    undefined
  )
  return (
    <Panel
      title={t('Sign-ups by week')}
      error={props.error}
      help={t(
        'Accounts created in each week, Monday to Sunday, followed up to now: those who paid, those who sent a request but have not paid, and the rest. A week the range holds only part of is drawn faint.'
      )}
      description={
        best
          ? t('Best full week: {{week}}, {{count}} sign-ups.', {
              week: fmt.day(best.start),
              count: fmt.num(best.registered),
            })
          : undefined
      }
    >
      {weeks.length === 0 ? null : (
        <BarSeries
          ariaLabel={t('Sign-ups by week')}
          series={[
            { label: t('Has paid') },
            { label: t('Activated, not paid') },
            { label: t('Not activated'), muted: true },
          ]}
          points={weeks.map((week) => ({
            key: week.start,
            title: t('Week of {{day}}', { day: fmt.day(week.start) }),
            values: [
              week.paid,
              Math.max(week.activated - week.paid, 0),
              Math.max(week.registered - week.activated, 0),
            ],
            faded: week.partial,
            extra: week.partial
              ? [
                  {
                    label: t('Days in the range'),
                    value: fmt.num(week.days),
                  },
                ]
              : undefined,
          }))}
        />
      )}
    </Panel>
  )
}

const PLOT_HEIGHT = 176

/** Keeps the first and last axis labels inside the plot. */
function edgeShift(index: number, count: number) {
  if (index === 0) return 'translateX(0)'
  if (index === count - 1) return 'translateX(-100%)'
  return undefined
}

/**
 * Daily sign-ups as bars on the left axis and the money paid that day as a
 * line on the right axis. Hovering, focusing or tapping a day reads out both.
 */
export function SignupMoneyChart(props: {
  days: SignupMoneyDay[]
  ariaLabel: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [active, setActive] = useState<number | null>(null)
  const days = props.days
  const count = days.length
  const left = niceScale(Math.max(0, ...days.map((day) => day.registered)))
  const right = niceScale(Math.max(0, ...days.map((day) => day.money)))
  const shown = active == null ? undefined : days[active]
  const totalSignups = days.reduce((sum, day) => sum + day.registered, 0)
  const totalMoney = days.reduce((sum, day) => sum + day.money, 0)
  const points = days.map((day, index) => ({
    x: ((index + 0.5) / count) * 100,
    y: 100 - (day.money / right.top) * 100,
  }))
  // About five labels along the time axis, the first and the last always.
  const labelAt = new Set(
    count <= 5
      ? days.map((_, index) => index)
      : Array.from({ length: 5 }, (_, i) => Math.round((i * (count - 1)) / 4))
  )
  const spaced = count <= 60
  return (
    <div className='grid gap-2'>
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1'>
        <Legend
          items={[
            { label: t('Sign-ups (left axis)'), dot: 'bg-primary/70' },
            {
              label: t('Paid that day (right axis)'),
              dot: 'bg-[var(--series-2)]',
            },
          ]}
        />
        <p
          className='text-xs tabular-nums'
          aria-live='polite'
          data-testid='signup-money-readout'
        >
          {shown ? (
            <>
              <span className='font-medium'>{fmt.day(shown.day)}</span>{' '}
              {t('{{count}} sign-ups · {{money}} paid by {{payers}} accounts', {
                count: fmt.num(shown.registered),
                money: fmt.cny(shown.money),
                payers: fmt.num(shown.payers),
              })}
            </>
          ) : (
            <span className='text-muted-foreground'>
              {t('{{count}} sign-ups · {{money}} paid in the range', {
                count: fmt.num(totalSignups),
                money: fmt.cny(totalMoney),
              })}
            </span>
          )}
        </p>
      </div>
      <div
        role='img'
        aria-label={props.ariaLabel}
        className='grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2'
      >
        <div
          className='text-muted-foreground flex flex-col-reverse justify-between text-right text-[10px] tabular-nums'
          style={{ height: PLOT_HEIGHT }}
        >
          {left.ticks.map((tick) => (
            <span key={tick} className='leading-none'>
              {fmt.numCompact(tick)}
            </span>
          ))}
        </div>
        <div className='relative' style={{ height: PLOT_HEIGHT }}>
          {left.ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden
              className='border-border/60 absolute inset-x-0 border-t'
              style={{ bottom: `${(tick / left.top) * 100}%` }}
            />
          ))}
          <div className={cn('absolute inset-0 flex', spaced && 'gap-px')}>
            {days.map((day, index) => (
              <div
                key={day.day}
                tabIndex={0}
                aria-label={`${fmt.day(day.day)}: ${t('{{count}} sign-ups · {{money}} paid by {{payers}} accounts', { count: fmt.num(day.registered), money: fmt.cny(day.money), payers: fmt.num(day.payers) })}`}
                className={cn(
                  'flex h-full min-w-0 flex-1 items-end outline-none',
                  active === index && 'bg-muted/60'
                )}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(index)}
              >
                <div
                  className='bg-primary/60 w-full rounded-t-[2px]'
                  style={{
                    height: `${Math.min(day.registered / left.top, 1) * 100}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <svg
            aria-hidden
            viewBox='0 0 100 100'
            preserveAspectRatio='none'
            className='pointer-events-none absolute inset-0 size-full overflow-visible'
          >
            <polyline
              fill='none'
              stroke='var(--series-2)'
              strokeWidth='2'
              strokeLinejoin='round'
              vectorEffect='non-scaling-stroke'
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
            />
          </svg>
          {count <= 31 &&
            points.map((point, index) => (
              <span
                key={days[index].day}
                aria-hidden
                className='pointer-events-none absolute size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--series-2)]'
                style={{ left: `${point.x}%`, bottom: `${100 - point.y}%` }}
              />
            ))}
        </div>
        <div
          className='text-muted-foreground flex flex-col-reverse justify-between text-[10px] tabular-nums'
          style={{ height: PLOT_HEIGHT }}
        >
          {right.ticks.map((tick) => (
            <span key={tick} className='leading-none'>
              {fmt.cnyCompact(tick)}
            </span>
          ))}
        </div>
        <span aria-hidden />
        <div className='text-muted-foreground relative mt-1 flex h-4 text-[10px]'>
          {days.map((day, index) =>
            labelAt.has(index) ? (
              <span
                key={day.day}
                className='absolute -translate-x-1/2 whitespace-nowrap'
                style={{
                  left: `${((index + 0.5) / count) * 100}%`,
                  // The first and last labels stay inside the plot.
                  transform: edgeShift(index, count),
                }}
              >
                {fmt.day(day.day)}
              </span>
            ) : null
          )}
        </div>
        <span aria-hidden />
      </div>
    </div>
  )
}

/** The daily sign-ups and the money paid each day, over the range. */
export function SignupMoneyPanel(props: {
  data: GrowthInsights | undefined
  error?: string
}) {
  const { t } = useTranslation()
  const days = signupMoneyDays(props.data?.daily ?? [], props.data?.topups)
  return (
    <Panel
      title={t('Sign-ups and money paid by day')}
      error={props.error}
      help={t(
        'Bars are the accounts created each day. The line is the money paid that day by every account, new or old, in the payment currency: top-ups and plans bought with money, by the day the order was paid. Staff payments are left out.'
      )}
    >
      {days.length > 0 ? (
        <SignupMoneyChart
          days={days}
          ariaLabel={t('Sign-ups and money paid by day')}
        />
      ) : (
        <p className='text-muted-foreground text-sm'>
          {t('No sign-ups in this range')}
        </p>
      )}
    </Panel>
  )
}

/**
 * A funnel per segment as horizontal stacked bars: each bar's length is the
 * segment's sign-ups against the largest, split into those who paid, those
 * who only used the service, and the rest.
 */
export function StackedFunnel(props: {
  rows: FunnelRow[] | null | undefined
  label: (segment: string) => string
  empty: string
  loading?: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  if (props.loading) {
    return <div className='bg-muted h-32 animate-pulse rounded-md' />
  }
  // A failed read is the panel's error line, not an empty funnel.
  if (props.rows == null) return null
  const rows = [...props.rows]
    .filter((row) => row.registered > 0)
    .sort((a, b) => b.registered - a.registered)
    .slice(0, 10)
  if (rows.length === 0) {
    return <p className='text-muted-foreground text-sm'>{props.empty}</p>
  }
  const largest = rows[0].registered
  const rate = (part: number, whole: number) =>
    whole > 0 ? fmt.pct(part / whole) : '-'
  return (
    <div className='grid gap-3'>
      <Legend
        items={[
          { label: t('Has paid'), dot: STAGE_DOTS[0] },
          { label: t('Activated, not paid'), dot: STAGE_DOTS[1] },
          { label: t('Not activated'), dot: STAGE_DOTS[2] },
        ]}
      />
      <ul className='grid gap-2'>
        {rows.map((row) => {
          const parts = [
            row.paid,
            Math.max(row.activated - row.paid, 0),
            Math.max(row.registered - row.activated, 0),
          ]
          const reading = t(
            '{{registered}} sign-ups, {{activated}} activated, {{paid}} paid',
            {
              registered: fmt.num(row.registered),
              activated: rate(row.activated, row.registered),
              paid: rate(row.paid, row.registered),
            }
          )
          return (
            <li
              key={row.segment}
              className={cn(
                'grid gap-1',
                row.registered < MIN_COHORT && 'opacity-60'
              )}
            >
              <div className='flex items-baseline justify-between gap-2 text-xs'>
                <span
                  className='min-w-0 truncate'
                  title={props.label(row.segment)}
                >
                  {props.label(row.segment)}
                </span>
                <span className='text-muted-foreground shrink-0 tabular-nums'>
                  <span className='text-foreground font-medium'>
                    {fmt.num(row.registered)}
                  </span>{' '}
                  {t('paid {{rate}}', { rate: rate(row.paid, row.registered) })}
                </span>
              </div>
              <div
                role='img'
                aria-label={`${props.label(row.segment)}: ${reading}`}
                title={reading}
                className='bg-muted/40 flex h-5 overflow-hidden rounded-md'
              >
                <div
                  className='flex h-full'
                  style={{ width: `${(row.registered / largest) * 100}%` }}
                >
                  {STAGE_COLORS.map((color, index) => (
                    <div
                      key={color}
                      className={cn('h-full', color)}
                      style={{ flexGrow: parts[index], flexBasis: 0 }}
                    />
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Paying accounts by how long ago their keys last spent quota. Bars from a
 * month on are drawn as a warning: those accounts have gone.
 */
export function SilentPayersPanel(props: {
  silent: SilentPayers | null | undefined
  error?: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const silent = props.silent
  if (!silent && !props.error) return null
  const labels: Record<SilentPayers['buckets'][number]['name'], string> = {
    within_1d: t('Today'),
    days_1_3: t('1-3 days'),
    days_4_7: t('4-7 days'),
    days_8_14: t('8-14 days'),
    days_15_30: t('15-30 days'),
    days_31_60: t('31-60 days'),
    over_60: t('Over 60 days'),
    never: t('Never used'),
  }
  const lost = lostPayers(silent)
  const total = silent?.payers ?? 0
  return (
    <Panel
      title={t('Silent paying accounts')}
      error={props.error}
      help={t(
        'Customers who have paid, by days since a key of theirs last spent quota, counted from now. An account whose keys were all deleted is counted as silent for over 60 days; Never used has no request at all. A month or more of silence is drawn as a warning.'
      )}
      description={
        silent && total > 0
          ? t(
              '{{lost}} of {{total}} paying accounts ({{rate}}) have been silent for a month or more.',
              {
                lost: fmt.num(lost),
                total: fmt.num(total),
                rate: fmt.pct(lost / total),
              }
            )
          : undefined
      }
    >
      {silent && total === 0 && (
        <p className='text-muted-foreground text-sm'>{t('No data')}</p>
      )}
      {silent && total > 0 && (
        <BarSeries
          ariaLabel={t('Silent paying accounts')}
          series={[{ label: t('Paying accounts') }]}
          points={silent.buckets.map((bucket) => ({
            key: bucket.name,
            title: labels[bucket.name],
            axis: labels[bucket.name],
            values: [bucket.count],
            tone: LOST_BUCKETS.includes(bucket.name) ? 'warning' : undefined,
            extra: [
              {
                label: t('Share of paying accounts'),
                value: fmt.pct(bucket.count / total),
              },
            ],
          }))}
        />
      )}
    </Panel>
  )
}

/** One bar of a ranked list. */
export type RankItem = {
  key: string
  label: ReactNode
  value: number
}

/**
 * A ranked list of horizontal bars, the largest first, each against the
 * largest, with its figure beside it.
 */
export function RankBars(props: {
  items: RankItem[]
  format: (value: number) => string
  /** Tailwind background of the bars. */
  barClass?: string
  empty: string
  limit?: number
}) {
  const items = [...props.items]
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, props.limit ?? 8)
  if (items.length === 0) {
    return <p className='text-muted-foreground text-sm'>{props.empty}</p>
  }
  const largest = items[0].value
  return (
    <ul className='grid gap-2'>
      {items.map((item) => (
        <li key={item.key} className='grid gap-0.5'>
          <div className='flex items-baseline justify-between gap-2 text-xs'>
            <span className='min-w-0 truncate'>{item.label}</span>
            <span className='shrink-0 font-medium tabular-nums'>
              {props.format(item.value)}
            </span>
          </div>
          <div className='bg-muted/40 h-2 overflow-hidden rounded-full'>
            <div
              className={cn(
                'h-full rounded-full',
                props.barClass ?? 'bg-primary/70'
              )}
              style={{
                width: `${Math.max((item.value / largest) * 100, 1)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
