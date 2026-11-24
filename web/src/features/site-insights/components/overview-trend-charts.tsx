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
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'

import { useInsightsFormat } from '../lib'
import { niceAxis, type OverviewTrends } from './overview-series'
import { Panel, type TrendPoint } from './shared'

/** A line over the bars: on the bars' axis, or on a right axis of its own. */
export type ComboLine = {
  key: string
  label: string
  points: TrendPoint[]
  format: (value: number) => string
  axis?: 'left' | 'right'
  color: string
  /** Drawn thin and dashed, as a reference rather than a series. */
  quiet?: boolean
}

const PLOT = { top: 10, bottom: 22, left: 46, right: 8, rightAxis: 44 }
const HEIGHT = 220
// A tick label's width in px at 10px type, to thin the time axis.
const LABEL_PX = 56
// Dots mark each point of a line up to this many.
const DOTS_UP_TO = 40

/**
 * Bars for one figure with one or two lines over them, on a gridded axis. A
 * line marked right reads on an axis of its own (a rate over a count). The
 * previous period's bars are a dashed line. Hovering, a touch, or the arrow
 * keys read out the position under them; a day the range covers in part is
 * drawn faint and says so.
 */
export function ComboChart(props: {
  bars: TrendPoint[]
  barLabel: string
  barFormat: (value: number) => string
  barColor: string
  axisFormat?: (value: number) => string
  rightAxisFormat?: (value: number) => string
  lines?: ComboLine[]
  ariaLabel: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    const node = box.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const count = props.bars.length
  // A line of another length cannot share the positions: it is left out.
  const lines = (props.lines ?? []).filter(
    (line) => line.points.length === count
  )
  const onRight = lines.filter((line) => line.axis === 'right')
  const onLeft = lines.filter((line) => line.axis !== 'right')
  const hasRight = onRight.length > 0
  const axisFormat = props.axisFormat ?? props.barFormat
  const rightFormat = props.rightAxisFormat ?? onRight[0]?.format ?? fmt.num

  const live = (point: TrendPoint) => !point.missing
  const leftMax = Math.max(
    0,
    ...props.bars.flatMap((point) =>
      live(point) ? [point.value, point.previous ?? 0] : []
    ),
    ...onLeft.flatMap((line) =>
      line.points.flatMap((point) => (live(point) ? [point.value] : []))
    )
  )
  const rightMax = Math.max(
    0,
    ...onRight.flatMap((line) =>
      line.points.flatMap((point) => (live(point) ? [point.value] : []))
    )
  )
  const left = niceAxis(leftMax)
  const right = niceAxis(rightMax)

  const plotLeft = PLOT.left
  const plotRight = width - (hasRight ? PLOT.rightAxis : PLOT.right)
  const plotW = Math.max(plotRight - plotLeft, 1)
  const plotTop = PLOT.top
  const plotBottom = HEIGHT - PLOT.bottom
  const plotH = plotBottom - plotTop
  const slot = plotW / Math.max(count, 1)
  const xOf = (index: number) => plotLeft + (index + 0.5) * slot
  const yLeft = (value: number) => plotBottom - (value / left.top) * plotH
  const yRight = (value: number) => plotBottom - (value / right.top) * plotH
  const barW = Math.max(Math.min(slot * 0.7, 28), 1)

  const every = Math.max(1, Math.ceil((count * LABEL_PX) / plotW))
  const pathOf = (
    points: TrendPoint[],
    y: (value: number) => number,
    pick: (point: TrendPoint) => number | undefined
  ) => {
    let path = ''
    let pen = false
    points.forEach((point, index) => {
      const value = point.missing ? undefined : pick(point)
      if (value === undefined) {
        pen = false
        return
      }
      path += `${pen ? 'L' : 'M'}${xOf(index).toFixed(1)},${y(value).toFixed(1)} `
      pen = true
    })
    return path
  }

  // A day in part is faint; with one under the pointer, the rest dim.
  const barOpacity = (bar: TrendPoint, index: number) => {
    if (bar.partial) return 0.4
    return active === null || active === index ? 0.85 : 0.45
  }
  const previousPath = pathOf(props.bars, yLeft, (bar) => bar.previous)
  const pointer = (event: { clientX: number }) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || count === 0) return
    const x = event.clientX - rect.left - plotLeft
    setActive(Math.min(count - 1, Math.max(0, Math.floor(x / slot))))
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setActive((current) => Math.max(0, (current ?? count) - 1))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setActive((current) => Math.min(count - 1, (current ?? -1) + 1))
    }
  }

  if (count < 2) return null
  const point = active === null ? null : props.bars[active]
  const tipX = active === null ? 0 : xOf(active)
  const flip = tipX > width * 0.6

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <ul className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
        <li className='flex items-center gap-1.5'>
          <span
            aria-hidden
            className='size-2.5 rounded-sm'
            style={{ backgroundColor: props.barColor }}
          />
          {props.barLabel}
        </li>
        {lines.map((line) => (
          <li key={line.key} className='flex items-center gap-1.5'>
            <span
              aria-hidden
              className='h-0.5 w-3 rounded-full'
              style={{ backgroundColor: line.color }}
            />
            {line.label}
            {line.axis === 'right' && (
              <span className='text-muted-foreground/70'>
                {t('right axis')}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div
        ref={box}
        tabIndex={0}
        role='img'
        aria-label={`${props.ariaLabel}: ${props.bars[0].title} – ${props.bars[count - 1].title}`}
        className='focus-visible:ring-ring/50 relative cursor-crosshair touch-pan-y rounded-sm outline-none focus-visible:ring-2'
        style={{ height: HEIGHT }}
        onPointerDown={pointer}
        onPointerMove={pointer}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') setActive(null)
        }}
        onFocus={() => setActive((current) => current ?? count - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={key}
      >
        <svg
          aria-hidden
          width={width}
          height={HEIGHT}
          className='text-muted-foreground block overflow-visible'
        >
          {left.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={yLeft(tick)}
                y2={yLeft(tick)}
                stroke='currentColor'
                strokeOpacity={tick === 0 ? 0.35 : 0.15}
                strokeDasharray={tick === 0 ? undefined : '3 3'}
              />
              <text
                x={plotLeft - 6}
                y={yLeft(tick) + 3}
                textAnchor='end'
                fontSize={10}
                fill='currentColor'
              >
                {axisFormat(tick)}
              </text>
            </g>
          ))}
          {hasRight &&
            right.ticks.map((tick) => (
              <text
                key={tick}
                x={plotRight + 6}
                y={yRight(tick) + 3}
                fontSize={10}
                fill='currentColor'
              >
                {rightFormat(tick)}
              </text>
            ))}
          {props.bars.map((bar, index) =>
            bar.missing ? null : (
              <rect
                key={bar.title}
                x={xOf(index) - barW / 2}
                y={Math.min(yLeft(bar.value), plotBottom)}
                width={barW}
                height={Math.max(plotBottom - yLeft(bar.value), 0)}
                rx={Math.min(2, barW / 3)}
                fill={props.barColor}
                opacity={barOpacity(bar, index)}
              />
            )
          )}
          {previousPath && (
            <path
              data-reference=''
              d={previousPath}
              fill='none'
              stroke='currentColor'
              strokeOpacity={0.7}
              strokeWidth={1}
              strokeDasharray='3 3'
            />
          )}
          {lines.map((line) => {
            const y = line.axis === 'right' ? yRight : yLeft
            return (
              <g key={line.key} data-line={line.key}>
                <path
                  d={pathOf(line.points, y, (each) => each.value)}
                  fill='none'
                  stroke={line.color}
                  strokeWidth={line.quiet ? 1.25 : 2}
                  strokeDasharray={line.quiet ? '4 3' : undefined}
                  strokeLinejoin='round'
                  strokeLinecap='round'
                />
                {count <= DOTS_UP_TO &&
                  !line.quiet &&
                  line.points.map((each, index) =>
                    each.missing ? null : (
                      <circle
                        key={each.title}
                        cx={xOf(index)}
                        cy={y(each.value)}
                        r={2.25}
                        fill={line.color}
                      />
                    )
                  )}
              </g>
            )
          })}
          {props.bars.map((bar, index) =>
            index % every === 0 ? (
              <text
                key={bar.title}
                x={xOf(index)}
                y={HEIGHT - 6}
                textAnchor='middle'
                fontSize={10}
                fill='currentColor'
              >
                {bar.title}
              </text>
            ) : null
          )}
          {active !== null && (
            <line
              x1={tipX}
              x2={tipX}
              y1={plotTop}
              y2={plotBottom}
              stroke='currentColor'
              strokeOpacity={0.35}
              strokeDasharray='2 2'
            />
          )}
        </svg>
        {point && active !== null && (
          <div
            role='status'
            className='bg-popover text-popover-foreground pointer-events-none absolute top-0 z-10 grid gap-0.5 rounded-md border px-2 py-1.5 text-xs whitespace-nowrap shadow-sm'
            style={{
              left: flip ? undefined : tipX + 10,
              right: flip ? width - tipX + 10 : undefined,
            }}
          >
            <span className='text-muted-foreground'>{point.title}</span>
            {point.missing ? (
              <span>{t('No data')}</span>
            ) : (
              <>
                <span className='flex items-center gap-1.5 tabular-nums'>
                  <span
                    aria-hidden
                    className='size-2 rounded-sm'
                    style={{ backgroundColor: props.barColor }}
                  />
                  {props.barLabel}{' '}
                  <span className='font-medium'>
                    {props.barFormat(point.value)}
                  </span>
                  {point.previous !== undefined && (
                    <span className='text-muted-foreground'>
                      · {t('Previous period')} {props.barFormat(point.previous)}
                    </span>
                  )}
                </span>
                {lines.map((line) => {
                  const each = line.points[active]
                  return (
                    <span
                      key={line.key}
                      className='flex items-center gap-1.5 tabular-nums'
                    >
                      <span
                        aria-hidden
                        className='h-0.5 w-2 rounded-full'
                        style={{ backgroundColor: line.color }}
                      />
                      {line.label}{' '}
                      <span className='font-medium'>
                        {each.missing ? t('No data') : line.format(each.value)}
                      </span>
                      {each.previous !== undefined && !each.missing && (
                        <span className='text-muted-foreground'>
                          · {t('Previous period')} {line.format(each.previous)}
                        </span>
                      )}
                    </span>
                  )
                })}
                {point.partial && (
                  <span className='text-muted-foreground'>
                    {point.partial.note}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const BAR = 'var(--series-1)'
const LINE_A = 'var(--series-2)'
const LINE_B = 'var(--series-3)'

/** The same series by position, or none when their lengths disagree. */
function aligned(
  bars: TrendPoint[] | undefined,
  line: TrendPoint[] | undefined
) {
  return bars && line && bars.length === line.length ? line : undefined
}

/**
 * The overview's two big charts: what came in and what was used, and how many
 * requests and how many failed. Each draws from the series the cards read, so
 * the charts and the figures above them cannot disagree.
 */
export function OverviewTrendCharts(props: {
  trends: OverviewTrends
  loading: boolean
  hourly: boolean
  /** Which source failed, so the chart says it could not be read. */
  failed?: { finance?: boolean; quality?: boolean }
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const { trends } = props
  const consumption = aligned(trends.revenue, trends.consumption)
  const recognized = aligned(trends.revenue, trends.recognized)
  const failure = aligned(trends.requests, trends.failureRate)
  const unit = props.hourly ? t('per hour') : t('per day')

  const body = (
    ready: boolean,
    failed: boolean | undefined,
    chart: () => ReactNode
  ) => {
    if (ready) return chart()
    if (failed) {
      return (
        <p className='text-muted-foreground text-xs'>
          {t('Could not be read')}
        </p>
      )
    }
    if (props.loading) return <Skeleton className='h-56 w-full rounded-md' />
    return (
      <p className='text-muted-foreground text-xs'>
        {t('No data in this range')}
      </p>
    )
  }

  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Panel
        title={t('Revenue and consumption')}
        description={t('Paid in, and charged at list price, {{unit}}.', {
          unit,
        })}
        help={t(
          'Revenue is money paid in, top-ups and plans. Consumption is what customers and root were charged at list price. Revenue earned is the part of revenue recognised so far. The dashed line is the previous period’s revenue.'
        )}
      >
        {body(
          !!trends.revenue && trends.revenue.length > 1,
          props.failed?.finance,
          () => (
            <ComboChart
              ariaLabel={t('Revenue and consumption')}
              bars={trends.revenue ?? []}
              barLabel={t('Revenue')}
              barFormat={fmt.cny}
              axisFormat={fmt.cnyCompact}
              barColor={BAR}
              lines={[
                ...(consumption
                  ? [
                      {
                        key: 'consumption',
                        label: t('Consumption'),
                        points: consumption,
                        format: fmt.cny,
                        color: LINE_A,
                      },
                    ]
                  : []),
                ...(recognized && recognized.some((point) => point.value > 0)
                  ? [
                      {
                        key: 'recognized',
                        label: t('Revenue earned'),
                        points: recognized,
                        format: fmt.cny,
                        color: LINE_B,
                      },
                    ]
                  : []),
              ]}
            />
          )
        )}
      </Panel>
      <Panel
        title={t('Requests and failure rate')}
        description={t('Requests, and the share that failed, {{unit}}.', {
          unit,
        })}
        help={t(
          'Requests are counted as on the service quality tab. The failure rate reads on the right axis. The dashed line is the previous period’s requests.'
        )}
      >
        {body(
          !!trends.requests && trends.requests.length > 1,
          props.failed?.quality,
          () => (
            <ComboChart
              ariaLabel={t('Requests and failure rate')}
              bars={trends.requests ?? []}
              barLabel={t('Requests')}
              barFormat={fmt.num}
              axisFormat={fmt.numCompact}
              barColor={BAR}
              rightAxisFormat={fmt.pct}
              lines={
                failure
                  ? [
                      {
                        key: 'failure',
                        label: t('Failure rate'),
                        points: failure,
                        format: fmt.pct,
                        axis: 'right' as const,
                        color: LINE_A,
                      },
                    ]
                  : []
              }
            />
          )
        )}
      </Panel>
    </div>
  )
}
