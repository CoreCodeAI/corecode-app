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

import { Skeleton } from '@/components/ui/skeleton'

import {
  type InsightsRangeInfo,
  OTHER_COLOR,
  SERIES_COLORS,
  type SourceState,
  useInsightsFormat,
  vendorColor,
} from '../lib'
import { usePartialDays } from '../partial-days'
import {
  VENDOR_LINE_SAMPLE,
  VENDOR_POINT_SAMPLE,
  vendorFailureLines,
  worstVendorLine,
} from '../quality-trend-analysis'
import type { QualityInsights } from '../types'
import { StaleNote } from './insight-kit'
import { ShareDonut } from './share-donut'
import { Panel } from './shared'
import { TrendLines, type TrendLine } from './trend-lines'

/** The rate a failure rate turns red at, drawn across the chart. */
const RED_RATE = 0.05

/**
 * The failure rate over the range, one line per vendor with enough requests
 * and a dashed line for every model together, against the 5% line. A day (an
 * hour) with too few of a vendor's requests is a gap, so a lone failure never
 * reads as a spike. The model filter narrows the lines as it narrows the
 * figures. Per hour when the range shows hours, as the other charts do.
 */
export function VendorFailureTrend(props: {
  data: QualityInsights | undefined
  vendorName: (vendor: string) => string
  staleHours?: number | null
  source?: SourceState
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('quality')
  const data = props.data
  // An older server sends no vendor series: the chart has nothing to draw,
  // and the tab reads as it did before.
  if (data && !data.vendor_trends) return null
  const hourly = !!props.range?.hourly && (data?.hourly ?? []).length > 0
  const rows = hourly
    ? (data?.hourly ?? []).map((row) => ({
        start: row.hour,
        requests: row.requests,
        rate: row.error_rate,
      }))
    : (data?.daily ?? []).map((row) => ({
        start: row.day,
        requests: row.requests,
        rate: row.error_rate,
      }))
  const starts = rows.map((row) => row.start)
  const vendors = vendorFailureLines(data?.vendor_trends, starts, hourly)
  const worst = worstVendorLine(vendors)
  const lines: TrendLine[] = [
    ...vendors.map((vendor) => ({
      key: vendor.vendor,
      label: props.vendorName(vendor.vendor),
      color: vendorColor(vendor.vendor),
      values: vendor.rates,
      summary: fmt.pct(vendor.errors / vendor.requests),
    })),
    {
      key: '__all',
      label: t('All models'),
      color: 'var(--muted-foreground)',
      dashed: true,
      summary: data ? fmt.pct(data.error_rate) : undefined,
      values: rows.map((row) =>
        row.requests >= VENDOR_POINT_SAMPLE ? row.rate : null
      ),
    },
  ]
  const countOf = (line: TrendLine, index: number) => {
    const vendor = vendors.find((item) => item.vendor === line.key)
    const count = vendor?.counts[index]
    if (!count) return undefined
    return t('{{failed}} of {{requests}}', {
      failed: fmt.num(count.errors),
      requests: fmt.num(count.requests),
    })
  }
  const loading = !data && props.source?.status !== 'error'
  let description: string | undefined
  if (worst) {
    description = t(
      '{{vendor}} failed the largest share of its requests: {{rate}} of {{count}}.',
      {
        vendor: props.vendorName(worst.vendor),
        rate: fmt.pct(worst.errors / worst.requests),
        count: fmt.num(worst.requests),
      }
    )
  }
  return (
    <Panel
      title={t('Failure rate by vendor')}
      description={description}
      help={t(
        'The share of each vendor’s requests that failed, by day, or by hour when the range shows hours. A day (or hour) with fewer than {{floor}} requests of a vendor is left out, so its line breaks there. A vendor with under {{small}} requests in the range has no line. The dashed grey line is every model together; the dashed level is 5%, where a rate turns red. A dashed part is a day the range covers only in part. The model filter applies.',
        { floor: VENDOR_POINT_SAMPLE, small: VENDOR_LINE_SAMPLE }
      )}
      error={
        props.source?.status === 'error' ? t('Could not be read') : undefined
      }
    >
      {loading && (
        <div role='status' aria-label={t('Loading...')} className='grid gap-2'>
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-full' />
        </div>
      )}
      {data && rows.length === 0 && (
        <p className='text-muted-foreground text-xs'>
          {t('No requests in this range')}
        </p>
      )}
      {data && rows.length > 0 && (
        <TrendLines
          ariaLabel={t('Failure rate by vendor')}
          titles={starts.map((start) =>
            hourly ? fmt.time(start) : fmt.day(start)
          )}
          axis={starts.map((start) =>
            hourly ? fmt.clock(start) : fmt.day(start)
          )}
          lines={lines}
          format={fmt.pct}
          floor={RED_RATE * 1.2}
          reference={{ value: RED_RATE, label: '5%' }}
          partial={starts.map((start) => !hourly && !!partialDay(start))}
          detail={countOf}
        />
      )}
      {data && props.range && (
        <StaleNote
          staleHours={props.staleHours}
          rangeHours={Math.round((props.range.end - props.range.start) / 3600)}
        />
      )}
    </Panel>
  )
}

/**
 * Where the range's input tokens came from: cache reads, cache writes and the
 * rest, as one ring beside the daily bars. The same days the bars draw, summed.
 */
export function CacheMixPanel(props: {
  data: QualityInsights | undefined
  vendorName?: (vendor: string) => string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const daily = props.data?.daily ?? []
  // Each vendor's own hit rate, over every model it sells: the site's figure
  // pools Claude's long cached prompts with everyone else's.
  const rates = (props.data?.vendors ?? [])
    .filter((vendor) => (vendor.cache_input ?? 0) > 0)
    .sort((a, b) => (b.cache_input ?? 0) - (a.cache_input ?? 0))
  const sum = (pick: (day: (typeof daily)[number]) => number) =>
    daily.reduce((total, day) => total + pick(day), 0)
  return (
    <Panel
      title={t('Cache mix')}
      help={t(
        'The range’s input tokens by cache use: reads, writes and the rest, summed over the days of the chart beside it.'
      )}
    >
      <ShareDonut
        ariaLabel={t('Cache mix')}
        totalLabel={t('Input tokens')}
        empty={t('No requests in this range')}
        loading={!props.data}
        format={fmt.numCompact}
        slices={[
          {
            key: 'read',
            label: t('Cache read'),
            value: sum((day) => day.read),
            color: SERIES_COLORS[0],
          },
          {
            key: 'write',
            label: t('Cache write'),
            value: sum((day) => day.write),
            color: SERIES_COLORS[1],
          },
          {
            key: 'uncached',
            label: t('Uncached'),
            value: sum((day) => day.uncached),
            color: OTHER_COLOR,
          },
        ]}
      />
      {rates.length > 0 && (
        <ul
          aria-label={t('Cache hit rate by vendor')}
          className='mt-3 grid gap-1.5 border-t pt-3'
        >
          <li className='text-muted-foreground text-xs'>
            {t('Cache hit rate by vendor')}
          </li>
          {rates.map((vendor) => (
            <li
              key={vendor.vendor}
              className='grid grid-cols-[5rem_1fr_3.5rem] items-center gap-2 text-xs'
            >
              <span className='truncate'>
                {props.vendorName?.(vendor.vendor) ?? vendor.vendor}
              </span>
              <span className='bg-muted h-1.5 overflow-hidden rounded-full'>
                <span
                  className='block h-full rounded-full'
                  style={{
                    width: `${Math.min(100, (vendor.cache_share ?? 0) * 100)}%`,
                    background: vendorColor(vendor.vendor),
                  }}
                />
              </span>
              <span className='text-right tabular-nums'>
                {fmt.pct(vendor.cache_share ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
