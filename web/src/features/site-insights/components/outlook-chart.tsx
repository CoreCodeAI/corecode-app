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
import { useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { useInsightsFormat } from '../lib'
import { nearestSample, QUOTA_PART_COLORS } from './outlook'

const HOUR_MS = 3_600_000

/** A reset inside the chart's window, marked on its time axis. */
export type OutlookChartReset = {
  key: string
  hours: number
  window: 'five_hour' | 'seven_day'
  /** The account and what the reset adds, read out under the pointer. */
  label: string
}

/**
 * Supply against demand over one window of a forecast, in two panels on one
 * time axis. Supply is a stock and demand a rate, so each has its own panel
 * and scale rather than a second axis on one plot. The upper panel is the
 * quota the window is read by, in the brand color with a solid line and fill;
 * the lower is the demand in ink with a dashed line. Each carries the
 * forecast's usual range as a band, the stretches with nothing to spend are
 * shaded across both, and each reset is marked on the supply's time axis.
 * Hovering, dragging a finger across, or focusing and pressing the arrow keys
 * reads out the moment under the pointer: both quota figures, the demand, and
 * the resets landing there.
 */
export function OutlookChart(props: {
  /** Hours from now of each point, ascending from 0. */
  hours: number[]
  /** The series drawn: `drawable` or `weekLeft`. */
  series: 'drawable' | 'weekLeft'
  drawable: number[]
  weekLeft: number[]
  /** Dollars per hour at each point. */
  demand: number[]
  /** The drawn series under low and high demand; low demand leaves more. */
  band?: { upper: number[]; lower: number[] } | null
  /** The demand at its low and high scale, for the demand panel's band. */
  demandBand?: { upper: number[]; lower: number[] } | null
  resets: OutlookChartReset[]
  /**
   * The least the pool can spend at once in the window and when, as the
   * projection found it between the points: the figure the window's card
   * shows, so the chart's name agrees with it.
   */
  lowest?: { usd: number; hours: number }
  observedAt: number
  /** What the window is called, for the chart's accessible name. */
  title: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [active, setActive] = useState<number | null>(null)
  const hours = props.hours
  const last = hours.length - 1
  const span = hours[last] || 1
  const values = props.series === 'drawable' ? props.drawable : props.weekLeft
  const band =
    props.band &&
    props.band.upper.length === hours.length &&
    props.band.lower.length === hours.length
      ? props.band
      : null
  const demandBand =
    props.demandBand &&
    props.demandBand.upper.length === hours.length &&
    props.demandBand.lower.length === hours.length
      ? props.demandBand
      : null
  const top = niceTop(Math.max(...values, ...(band?.upper ?? [])))
  const demandTop = niceTop(
    Math.max(...props.demand, ...(demandBand?.upper ?? []))
  )
  const xOf = (at: number) => (at / span) * 100
  const scaleOf = (ceiling: number) => (usd: number) =>
    100 - (Math.max(usd, 0) / ceiling) * 100
  const yOf = scaleOf(top)
  const yDemand = scaleOf(demandTop)
  const unix = (at: number) =>
    Math.floor((props.observedAt + at * HOUR_MS) / 1000)
  const line = (series: number[], y: (usd: number) => number) =>
    series
      .map(
        (usd, index) =>
          `${index === 0 ? 'M' : 'L'}${xOf(hours[index]).toFixed(2)},${y(usd).toFixed(2)}`
      )
      .join(' ')
  const area = (
    range: { upper: number[]; lower: number[] } | null,
    y: (usd: number) => number
  ) =>
    range
      ? `${line(range.upper, y)} ${range.lower
          .map(
            (usd, index) =>
              `L${xOf(hours[index]).toFixed(2)},${y(usd).toFixed(2)}`
          )
          .reverse()
          .join(' ')} Z`
      : null
  const path = line(values, yOf)
  const bandPath = area(band, yOf)
  const demandPath = line(props.demand, yDemand)
  const demandBandPath = area(demandBand, yDemand)

  // Runs of samples with nothing to spend, each reaching halfway to the
  // sample before and after: a gap starts and ends between two samples.
  const gaps: { from: number; to: number }[] = []
  props.drawable.forEach((usd, index) => {
    if (usd > 0) return
    const previous = gaps.at(-1)
    if (previous && previous.to === index - 1) previous.to = index
    else gaps.push({ from: index, to: index })
  })
  const edge = (index: number, side: -1 | 1) => {
    const other = Math.min(last, Math.max(0, index + side))
    return (hours[index] + hours[other]) / 2
  }

  // Ticks on the time axis: each local midnight over several days, or whole
  // local hours within a day, thinned to what a phone has room for.
  const ticks: { hours: number; label: string }[] = []
  if (span > 48) {
    const midnight = new Date(props.observedAt)
    midnight.setHours(24, 0, 0, 0)
    while (midnight.getTime() < props.observedAt + span * HOUR_MS) {
      ticks.push({
        hours: (midnight.getTime() - props.observedAt) / HOUR_MS,
        label: fmt.day(midnight.getTime() / 1000),
      })
      midnight.setDate(midnight.getDate() + 1)
    }
  } else {
    const every = span > 12 ? 4 : 1
    const next = new Date(props.observedAt)
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    while (next.getTime() < props.observedAt + span * HOUR_MS) {
      if (next.getHours() % every === 0) {
        ticks.push({
          hours: (next.getTime() - props.observedAt) / HOUR_MS,
          label: fmt.clock(next.getTime() / 1000),
        })
      }
      next.setHours(next.getHours() + 1)
    }
  }

  // Each reset at its nearest sample, so the point read out names it.
  const resetsAt = new Map<number, OutlookChartReset[]>()
  for (const reset of props.resets) {
    const index = nearestSample(hours, reset.hours)
    resetsAt.set(index, [...(resetsAt.get(index) ?? []), reset])
  }

  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const share = (event.clientX - box.left) / Math.max(box.width, 1)
    return nearestSample(hours, Math.min(1, Math.max(0, share)) * span)
  }
  const least = props.drawable.indexOf(Math.min(...props.drawable))
  const lowest = props.lowest ?? {
    usd: props.drawable[least] ?? 0,
    hours: hours[least] ?? 0,
  }
  const x = active === null ? 0 : xOf(hours[active])
  const landing = active === null ? [] : (resetsAt.get(active) ?? [])
  const seriesLabel =
    props.series === 'drawable'
      ? t('Spendable at once')
      : t('Weekly quota left')
  const peakDemand = Math.max(...props.demand, 0)
  // Each band belongs to its series, so it is read out under it.
  const rangeRow = (
    range: { upper: number[]; lower: number[] } | null,
    format: (usd: number) => string
  ) =>
    range &&
    active !== null && (
      <>
        <dt className='text-muted-foreground pl-3 whitespace-nowrap'>
          {t('Usual range')}
        </dt>
        <dd className='text-muted-foreground text-right'>
          {format(range.lower[active])} – {format(range.upper[active])}
        </dd>
      </>
    )
  const range = rangeRow(band, fmt.usdWhole)
  const perHour = (usd: number) =>
    t('{{amount}}/h', { amount: fmt.usdWhole(usd) })
  const demandRange = rangeRow(demandBand, perHour)
  const gapRects = gaps.map((gap) => {
    const from = xOf(edge(gap.from, -1))
    const to = xOf(edge(gap.to, 1))
    return (
      <rect
        key={gap.from}
        x={from}
        // A gap shorter than the spacing still shows.
        width={Math.max(to - from, 0.4)}
        y={0}
        height={100}
        className='fill-destructive/20'
      />
    )
  })
  const grid = (
    <>
      {[0, 50, 100].map((y) => (
        <line
          key={y}
          x1={0}
          x2={100}
          y1={y}
          y2={y}
          className='stroke-border'
          vectorEffect='non-scaling-stroke'
        />
      ))}
      {ticks.map((tick) => (
        <line
          key={tick.hours}
          x1={xOf(tick.hours)}
          x2={xOf(tick.hours)}
          y1={0}
          y2={100}
          className='stroke-border'
          strokeDasharray='2 3'
          vectorEffect='non-scaling-stroke'
        />
      ))}
    </>
  )

  return (
    <figure>
      <figcaption className='mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs'>
        <span className='flex items-center gap-1.5'>
          <SupplySwatch />
          <span className='font-medium'>{t('Supply')}</span>
          <span aria-hidden className='text-muted-foreground'>
            ·
          </span>
          <span className='text-muted-foreground'>{seriesLabel}</span>
        </span>
        <span className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1'>
          {(band || demandBand) && (
            <span className='flex items-center gap-1.5'>
              <span aria-hidden className='flex'>
                {band && <span className='bg-primary/20 size-2.5 rounded-sm' />}
                {demandBand && (
                  <span className='bg-foreground/15 size-2.5 rounded-sm' />
                )}
              </span>
              {t('Usual range')}
            </span>
          )}
          {gaps.length > 0 && (
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden
                className='bg-destructive/20 size-2.5 rounded-sm'
              />
              {t('Nothing to spend')}
            </span>
          )}
          {props.resets.some((reset) => reset.window === 'five_hour') && (
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden
                className={cn('size-1.5 rounded-full', QUOTA_PART_COLORS.five)}
              />
              {t('5-hour reset')}
            </span>
          )}
          {props.resets.some((reset) => reset.window === 'seven_day') && (
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden
                className={cn('size-1.5 rounded-full', QUOTA_PART_COLORS.week)}
              />
              {t('Weekly reset')}
            </span>
          )}
        </span>
      </figcaption>
      <div className='flex gap-2'>
        {/* One scale per panel: dollars for the supply, dollars an hour
            for the demand, which its panel's title names. */}
        <div
          aria-hidden
          className='text-muted-foreground flex flex-col text-right text-[10px] leading-none tabular-nums'
        >
          <div className='flex h-40 flex-col justify-between'>
            <span>{fmt.usdCompact(top)}</span>
            <span>{fmt.usdCompact(top / 2)}</span>
            <span>{fmt.usdCompact(0)}</span>
          </div>
          <div className='h-7' />
          <div className='flex h-24 flex-col justify-between'>
            <span>{fmt.usdCompact(demandTop)}</span>
            <span>{fmt.usdCompact(demandTop / 2)}</span>
            <span>{fmt.usdCompact(0)}</span>
          </div>
        </div>
        <div className='min-w-0 flex-1'>
          <div
            tabIndex={0}
            role='img'
            aria-label={`${t(
              '{{title}}: {{now}} spendable now, least {{lowest}} around {{time}}',
              {
                title: props.title,
                now: fmt.usdWhole(props.drawable[0] ?? 0),
                lowest: fmt.usdWhole(lowest.usd),
                time: fmt.time(unix(lowest.hours)),
              }
            )}${t('; demand {{now}}/h now, peak {{peak}}/h', {
              now: fmt.usdWhole(props.demand[0] ?? 0),
              peak: fmt.usdWhole(peakDemand),
            })}`}
            // A finger dragging across reads point after point; a vertical
            // drag still scrolls the page.
            className='focus-visible:ring-ring/50 relative cursor-crosshair touch-pan-y rounded-sm outline-none focus-visible:ring-2'
            onPointerDown={(event) => setActive(nearest(event))}
            onPointerMove={(event) => setActive(nearest(event))}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'touch') setActive(null)
            }}
            onFocus={() => setActive((current) => current ?? 0)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                setActive((current) => Math.max(0, (current ?? 0) - 1))
              } else if (event.key === 'ArrowRight') {
                event.preventDefault()
                setActive((current) => Math.min(last, (current ?? 0) + 1))
              }
            }}
          >
            <div className='relative h-40'>
              <svg
                aria-hidden
                viewBox='0 0 100 100'
                preserveAspectRatio='none'
                className='text-primary block size-full overflow-visible'
              >
                {grid}
                {gapRects}
                {bandPath && (
                  <path d={bandPath} className='fill-current opacity-20' />
                )}
                {/* The band is the fill when there is one: two fills of one
                    color would hide where it ends. */}
                {!bandPath && (
                  <path
                    d={`${path} L100,100 L0,100 Z`}
                    className='fill-current opacity-10'
                  />
                )}
                <path
                  d={path}
                  fill='none'
                  stroke='currentColor'
                  strokeWidth={2}
                  vectorEffect='non-scaling-stroke'
                  strokeLinejoin='round'
                />
              </svg>
              {props.resets.map((reset) => (
                <span
                  key={reset.key}
                  aria-hidden
                  className={cn(
                    'ring-background pointer-events-none absolute bottom-0 size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-1',
                    reset.window === 'five_hour'
                      ? QUOTA_PART_COLORS.five
                      : QUOTA_PART_COLORS.week
                  )}
                  style={{ left: `${xOf(reset.hours)}%` }}
                />
              ))}
              {active !== null && (
                <span
                  aria-hidden
                  className='bg-primary ring-background pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2'
                  style={{ left: `${x}%`, top: `${yOf(values[active])}%` }}
                />
              )}
            </div>
            <p className='flex h-7 items-end gap-1.5 pb-1 text-xs'>
              <DemandSwatch />
              <span className='font-medium'>{t('Demand')}</span>
              <span aria-hidden className='text-muted-foreground'>
                ·
              </span>
              <span className='text-muted-foreground'>
                {t('Dollars per hour')}
              </span>
            </p>
            <div className='relative h-24'>
              <svg
                aria-hidden
                viewBox='0 0 100 100'
                preserveAspectRatio='none'
                className='text-foreground block size-full overflow-visible'
              >
                {grid}
                {gapRects}
                {demandBandPath && (
                  <path
                    d={demandBandPath}
                    className='fill-current opacity-10'
                  />
                )}
                <path
                  d={demandPath}
                  fill='none'
                  stroke='currentColor'
                  strokeWidth={2}
                  strokeDasharray='5 3'
                  vectorEffect='non-scaling-stroke'
                  strokeLinejoin='round'
                />
              </svg>
              {active !== null && (
                <span
                  aria-hidden
                  className='bg-foreground ring-background pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2'
                  style={{
                    left: `${x}%`,
                    top: `${yDemand(props.demand[active])}%`,
                  }}
                />
              )}
            </div>
            {active !== null && (
              <>
                <span
                  aria-hidden
                  className='border-foreground/30 pointer-events-none absolute inset-y-0 border-l border-dashed'
                  style={{ left: `${x}%` }}
                />
                <div
                  role='status'
                  className={cn(
                    'bg-popover text-popover-foreground pointer-events-none absolute bottom-full z-10 mb-1 grid w-max max-w-64 gap-1 rounded-md border px-2.5 py-2 text-xs shadow-md',
                    x < 25 && 'translate-x-0',
                    x >= 25 && x <= 75 && '-translate-x-1/2',
                    x > 75 && '-translate-x-full'
                  )}
                  style={{ left: `${x}%` }}
                >
                  <p className='font-medium'>{fmt.time(unix(hours[active]))}</p>
                  <dl className='grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums'>
                    <dt className='text-muted-foreground flex items-center gap-1.5 whitespace-nowrap'>
                      {props.series === 'drawable' && <SupplySwatch />}
                      {t('Spendable at once')}
                    </dt>
                    <dd
                      className={cn(
                        'text-right font-medium',
                        props.drawable[active] <= 0 && 'text-destructive'
                      )}
                    >
                      {props.drawable[active] > 0
                        ? fmt.usdWhole(props.drawable[active])
                        : t('Nothing')}
                    </dd>
                    {props.series === 'drawable' && range}
                    <dt className='text-muted-foreground flex items-center gap-1.5 whitespace-nowrap'>
                      {props.series === 'weekLeft' && <SupplySwatch />}
                      {t('Weekly quota left')}
                    </dt>
                    <dd className='text-right'>
                      {fmt.usdWhole(props.weekLeft[active])}
                    </dd>
                    {props.series === 'weekLeft' && range}
                    <dt className='text-muted-foreground flex items-center gap-1.5 whitespace-nowrap'>
                      <DemandSwatch />
                      {t('Demand')}
                    </dt>
                    <dd className='text-right font-medium'>
                      {perHour(props.demand[active])}
                    </dd>
                    {demandRange}
                  </dl>
                  {landing.map((reset) => (
                    <p key={reset.key} className='flex items-center gap-1.5'>
                      <span
                        aria-hidden
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          reset.window === 'five_hour'
                            ? QUOTA_PART_COLORS.five
                            : QUOTA_PART_COLORS.week
                        )}
                      />
                      {reset.label}
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
          <div
            aria-hidden
            className='text-muted-foreground relative mt-1.5 h-3 text-[10px] leading-none tabular-nums'
          >
            {ticks
              // A label too near the right edge would run off the chart.
              .filter((tick) => tick.hours < span * 0.94)
              .map((tick) => (
                <span
                  key={tick.hours}
                  className='absolute'
                  style={{ left: `${xOf(tick.hours)}%` }}
                >
                  {tick.label}
                </span>
              ))}
          </div>
        </div>
      </div>
    </figure>
  )
}

// The legend marks: the supply is a solid line over its fill, the demand a
// dashed line in ink, so the two differ in color and in stroke.
function SupplySwatch() {
  return (
    <svg
      aria-hidden
      viewBox='0 0 14 10'
      className='text-primary h-2.5 w-3.5 shrink-0'
    >
      <rect
        x={0}
        y={5}
        width={14}
        height={5}
        className='fill-current opacity-20'
      />
      <line
        x1={0}
        x2={14}
        y1={5}
        y2={5}
        stroke='currentColor'
        strokeWidth={2}
      />
    </svg>
  )
}

function DemandSwatch() {
  return (
    <svg
      aria-hidden
      viewBox='0 0 14 10'
      className='text-foreground h-2.5 w-3.5 shrink-0'
    >
      <line
        x1={0}
        x2={14}
        y1={5}
        y2={5}
        stroke='currentColor'
        strokeWidth={2}
        strokeDasharray='4 2'
      />
    </svg>
  )
}

// The axis top: the least 1, 2, 2.5 or 5 step at or above the highest value.
function niceTop(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= value) ?? 10
  return step * magnitude
}
