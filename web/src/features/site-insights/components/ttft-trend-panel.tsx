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

import { Skeleton } from '@/components/ui/skeleton'

import {
  HOUR_SAMPLE,
  SMALL_SAMPLE,
  type InsightsRangeInfo,
  type SourceState,
  useInsightsFormat,
} from '../lib'
import { usePartialDays, type PartialMark } from '../partial-days'
import {
  ttftMovement,
  ttftPointsOf,
  ttftValue,
  ttftVendorsShown,
  type TTFTPercentile,
} from '../ttft-trend-analysis'
import type { TTFTSeries } from '../types'
import { StaleNote } from './insight-kit'
import { Panel, ProviderSwitch } from './shared'

const WIDTH = 640
const HEIGHT = 200
const PAD = { left: 52, right: 12, top: 12, bottom: 26 }
const LINE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

/**
 * The first-response time over the range, one line per vendor with enough
 * streamed requests, read from the quality view's per-day series (per hour when
 * the range shows hours). A point with too few streamed requests is a gap. A
 * partial first or last day is drawn dashed, as the other daily charts mark it.
 * The model filter applies to the series as it applies to the daily figures.
 */
export function TTFTTrendPanel(props: {
  /** The quality view's vendor series; absent on a server that does not send it, and while loading. */
  series: TTFTSeries[] | null | undefined
  staleHours?: number | null
  source?: SourceState
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('quality')
  const [percentile, setPercentile] = useState<TTFTPercentile>('p95')
  // Without the field there is nothing to draw: an older server leaves it
  // out, so the tab reads as it did before. A failed or absent read is left
  // out too, so an unknown never reads as no delay.
  if (!props.series && props.source?.status !== 'pending') return null
  const loading = !props.series
  const hourly =
    !!props.range?.hourly &&
    !!props.series?.some((vendor) => (vendor.hourly ?? []).length > 0)
  const vendors = ttftVendorsShown(props.series ?? [])
  const isPartial = (start: number) => !!partialDay(start)
  const movement = ttftMovement(vendors, percentile, hourly, isPartial)
  const description = movement
    ? t(
        '{{vendor}} moved most: its {{pct}} went from {{from}} ms to {{to}} ms across the range.',
        {
          vendor: movement.vendor,
          pct: percentile,
          from: fmt.num(movement.from),
          to: fmt.num(movement.to),
        }
      )
    : undefined
  return (
    <Panel
      title={t('First-token delay trend')}
      help={t(
        'First-response time of the streamed requests that succeeded, by vendor and by day, or by hour when the range shows hours. Each point is the percentile of that day’s (or hour’s) streamed requests. A day with fewer than {{floor}} streamed requests (an hour, fewer than {{hourFloor}}) is left out, so the line breaks there. A dashed part is a day the range covers only in part. The model filter applies, as it does to the daily figures.',
        { floor: SMALL_SAMPLE, hourFloor: HOUR_SAMPLE }
      )}
      description={description}
      error={
        props.source?.status === 'error' ? t('Could not be read') : undefined
      }
      actions={
        <ProviderSwitch
          ariaLabel={t('Which percentile to draw')}
          value={percentile}
          onChange={setPercentile}
          items={[
            { key: 'p50', label: 'p50' },
            { key: 'p95', label: 'p95' },
          ]}
        />
      }
    >
      {loading && (
        <div role='status' aria-label={t('Loading...')} className='grid gap-2'>
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-full' />
        </div>
      )}
      {!loading && vendors.length === 0 && (
        <p className='text-muted-foreground text-xs'>
          {t('No vendor has enough streamed requests in this range')}
        </p>
      )}
      {!loading && vendors.length > 0 && (
        <TTFTChart
          vendors={vendors}
          percentile={percentile}
          hourly={hourly}
          partial={(start) => (hourly ? undefined : partialDay(start))}
        />
      )}
      <StaleNote
        staleHours={props.staleHours}
        rangeHours={
          props.range
            ? Math.round((props.range.end - props.range.start) / 3600)
            : 0
        }
      />
    </Panel>
  )
}

function TTFTChart(props: {
  vendors: TTFTSeries[]
  percentile: TTFTPercentile
  hourly: boolean
  partial: (start: number) => PartialMark | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const starts = [
    ...new Set(
      props.vendors.flatMap((vendor) =>
        ttftPointsOf(vendor, props.hourly).map((point) => point.start)
      )
    ),
  ].sort((a, b) => a - b)
  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const x = (index: number) =>
    starts.length > 1
      ? PAD.left + (index * plotWidth) / (starts.length - 1)
      : PAD.left
  const values = props.vendors.flatMap((vendor) =>
    ttftPointsOf(vendor, props.hourly).flatMap((point) => {
      const value = ttftValue(point, props.percentile, props.hourly)
      return value == null ? [] : [value]
    })
  )
  const top = Math.max(1, ...values) * 1.1
  const y = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight
  const label = props.hourly ? fmt.clock : fmt.day
  return (
    <div className='grid gap-3'>
      <svg
        role='img'
        aria-label={t('First-token delay by vendor, {{pct}}', {
          pct: props.percentile,
        })}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className='text-muted-foreground h-auto w-full'
      >
        {[0, top / 2, top].map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className='stroke-border'
            />
            <text
              x={PAD.left - 6}
              y={y(tick)}
              textAnchor='end'
              dominantBaseline='middle'
              fill='currentColor'
              className='text-xs'
            >
              {fmt.num(Math.round(tick))}
            </text>
          </g>
        ))}
        {starts.length > 0 && (
          <>
            <text
              x={PAD.left}
              y={HEIGHT - 6}
              fill='currentColor'
              className='text-xs'
            >
              {label(starts[0])}
            </text>
            <text
              x={WIDTH - PAD.right}
              y={HEIGHT - 6}
              textAnchor='end'
              fill='currentColor'
              className='text-xs'
            >
              {label(starts.at(-1) ?? 0)}
            </text>
          </>
        )}
        {props.vendors.map((vendor, lineIndex) => {
          const color = LINE_COLORS[lineIndex % LINE_COLORS.length]
          const byStart = new Map(
            ttftPointsOf(vendor, props.hourly).map((point) => [
              point.start,
              point,
            ])
          )
          const drawn = starts.map((start, index) => {
            const point = byStart.get(start)
            const value = point
              ? ttftValue(point, props.percentile, props.hourly)
              : null
            return { index, start, value, point }
          })
          const segments = []
          for (let i = 1; i < drawn.length; i++) {
            const from = drawn[i - 1]
            const to = drawn[i]
            if (from.value == null || to.value == null) continue
            const dashed =
              !!props.partial(from.start) || !!props.partial(to.start)
            segments.push(
              <line
                key={`${vendor.vendor}-${to.start}`}
                x1={x(from.index)}
                x2={x(to.index)}
                y1={y(from.value)}
                y2={y(to.value)}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={dashed ? '4 3' : undefined}
              />
            )
          }
          return (
            <g key={vendor.vendor}>
              {segments}
              {drawn.map(({ index, start, value, point }) =>
                value == null || !point ? null : (
                  <circle
                    key={start}
                    cx={x(index)}
                    cy={y(value)}
                    r={2.5}
                    fill={props.partial(start) ? 'var(--card)' : color}
                    stroke={color}
                  >
                    <title>
                      {`${vendor.vendor} · ${label(start)} · ${props.percentile} ${fmt.num(value)} ms · ${fmt.num(point.requests)}`}
                    </title>
                  </circle>
                )
              )}
            </g>
          )
        })}
      </svg>
      <ul className='grid gap-1 text-xs'>
        {props.vendors.map((vendor, lineIndex) => {
          const values = ttftPointsOf(vendor, props.hourly).flatMap((point) => {
            const value = ttftValue(point, props.percentile, props.hourly)
            return value == null ? [] : [value]
          })
          return (
            <li key={vendor.vendor} className='flex items-center gap-2'>
              <span
                aria-hidden='true'
                className='inline-block size-2 rounded-full'
                style={{
                  backgroundColor: LINE_COLORS[lineIndex % LINE_COLORS.length],
                }}
              />
              <span>{vendor.vendor}</span>
              <span className='text-muted-foreground tabular-nums'>
                {values.length > 0
                  ? t('peak {{peak}} ms', {
                      peak: fmt.num(Math.max(...values)),
                    })
                  : t('No data')}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
