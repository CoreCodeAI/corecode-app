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

import { alignPrevious } from '../analysis'
import {
  HOUR_SAMPLE,
  SMALL_SAMPLE,
  useErrorCategoryLabel,
  useHourAxis,
  useInsightsFormat,
  useTabLabel,
  type InsightsRangeInfo,
  type InsightsTab,
} from '../lib'
import {
  failureDrivers,
  failureOwners,
  hourFlags,
  worstHour,
  type FailureOwner,
  type HourFlag,
} from '../quality-analysis'
import type { QualityHour, QualityInsights } from '../types'
import { Drivers, SampleNote } from './insight-kit'
import { BarSeries, Breakdown, Panel } from './shared'

function span(
  rows: QualityHour[],
  previous: QualityHour[] | null | undefined
): number {
  const first = previous?.[0]
  return first && rows[0] ? rows[0].hour - first.hour : 0
}

function flagAt(flags: HourFlag[], hour: number): HourFlag | undefined {
  return flags.find((flag) => flag.hour === hour)
}

/**
 * Failure rate, first token and requests by hour, each hour read against
 * the same hour of the previous period; hours that stood out are coloured.
 */
export function QualityHourlyPanels(props: {
  rows: QualityHour[]
  previous?: QualityInsights
  range: InsightsRangeInfo
  rate: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const hours = useHourAxis()
  const before = alignPrevious(
    props.rows,
    props.previous?.hourly,
    span(props.rows, props.previous?.hourly)
  )
  const flags = hourFlags(props.rows, props.previous?.hourly, props.range.end)
  const worst = worstHour(props.rows, props.range.end)
  const sameHour = (value: string | undefined) =>
    value ? [{ label: t('Same hour, previous period'), value }] : []
  return (
    <>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel
          title={t('Failure rate by hour')}
          description={
            worst && worst.error_rate > 0
              ? t('Worst hour {{time}}: {{rate}} of {{count}} requests.', {
                  time: fmt.time(worst.hour),
                  rate: fmt.pct(worst.error_rate),
                  count: fmt.num(worst.requests),
                })
              : undefined
          }
          help={t(
            'An hour with under 20 requests has no rate. An hour is colored when its failure rate is, beyond chance, three times that of the same hour of the previous period (or the range’s median hour) and above 2%. The dashed line is the range’s rate. The last hour is still filling.'
          )}
        >
          <BarSeries
            ariaLabel={t('Failure rate by hour')}
            series={[{ label: t('Failure rate'), format: fmt.pct }]}
            reference={{ value: props.rate, label: t('Range rate') }}
            points={hours.bars(props.rows, props.range.end, (row, index) => {
              const prev = before[index]
              const flag = flagAt(flags, row.hour)
              return {
                values: [row.requests >= HOUR_SAMPLE ? row.error_rate : 0],
                tone: flag?.failing ? 'danger' : undefined,
                extra: [
                  { label: t('Failed'), value: fmt.num(row.errors) },
                  { label: t('Requests'), value: fmt.num(row.requests) },
                  ...sameHour(
                    prev && prev.requests >= HOUR_SAMPLE
                      ? fmt.pct(prev.error_rate)
                      : undefined
                  ),
                ],
              }
            })}
          />
        </Panel>
        <Panel
          title={t('First token by hour')}
          help={t(
            'Time to first token of streamed requests: p95 drawn, p50 in the readout. An hour is colored when its p95 passed 10 seconds at twice that of the same hour of the previous period (or the range’s median hour). The last hour is still filling.'
          )}
        >
          <BarSeries
            ariaLabel={t('First token by hour')}
            series={[{ label: 'TTFT p95', format: fmt.measuredMs }]}
            points={hours.bars(props.rows, props.range.end, (row, index) => {
              const prev = before[index]
              const flag = flagAt(flags, row.hour)
              return {
                values: [row.ttft_p95_ms],
                tone: flag?.slow ? 'warning' : undefined,
                extra: [
                  { label: 'TTFT p50', value: fmt.measuredMs(row.ttft_p50_ms) },
                  ...sameHour(
                    prev && prev.ttft_p95_ms > 0
                      ? fmt.measuredMs(prev.ttft_p95_ms)
                      : undefined
                  ),
                ],
              }
            })}
          />
        </Panel>
      </div>
      <Panel
        title={t('Requests by hour')}
        help={t(
          'Requests in the hour, failed ones on top. The readout lists the same hour of the previous period. The last hour is still filling.'
        )}
      >
        <BarSeries
          ariaLabel={t('Requests by hour')}
          series={[
            { label: t('Succeeded'), muted: true },
            { label: t('Failed') },
          ]}
          points={hours.bars(props.rows, props.range.end, (row, index) => ({
            values: [row.requests - row.errors, row.errors],
            extra: sameHour(
              before[index] ? fmt.num(before[index].requests) : undefined
            ),
          }))}
        />
      </Panel>
    </>
  )
}

/**
 * Each model's part of the failure rate's change, in points; the selected
 * models only under a filter, as the headline.
 */
export function FailureDriversPanel(props: {
  data: QualityInsights
  previous?: QualityInsights
  selected: string[]
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const previous = props.previous
  if (!previous?.models?.length || !props.data.models?.length) return null
  const { parts, drivers } = failureDrivers(
    props.data.models,
    previous.models,
    props.selected
  )
  const lead = new Set(drivers.map((part) => part.key))
  const total = parts.reduce((sum, part) => sum + part.change, 0)
  const small =
    props.data.requests < SMALL_SAMPLE || previous.requests < SMALL_SAMPLE
  return (
    <Panel
      title={t('What moved the failure rate')}
      description={t('Failure rate {{before}} → {{now}}.', {
        before: fmt.pct(previous.error_rate),
        now: fmt.pct(props.data.error_rate),
      })}
      help={t(
        'Each model’s failed requests over all requests, now against the previous period, in points; the rows add up to the change of the failure rate. Root’s requests count, as in the headline.'
      )}
    >
      {small ? (
        <SampleNote>
          {t('Too few requests in one of the periods to say what moved it.')}
        </SampleNote>
      ) : (
        <Drivers
          rows={parts.slice(0, 6).map((part) => ({
            key: part.key,
            label: part.key,
            change: t('{{sign}}{{value}} pt', {
              sign: part.change > 0 ? '+' : '−',
              value: (Math.abs(part.change) * 100).toFixed(2),
            }),
            share:
              lead.has(part.key) && total !== 0
                ? t('{{share}} of the change', {
                    share: fmt.pct(part.change / total),
                  })
                : undefined,
            tone: part.change > 0 ? 'danger' : 'good',
          }))}
          empty={t('No model’s failures moved.')}
        />
      )}
    </Panel>
  )
}

const OWNER_TABS: Partial<Record<FailureOwner, InsightsTab>> = {
  ours: 'capacity',
  upstream: 'upstream',
}

/**
 * Customers' failures by whose they are, each owner linked to the tab where
 * it is acted on, and the categories within. Null on a server without them.
 */
export function FailureOwnersPanel(props: {
  data: QualityInsights
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const tabLabel = useTabLabel()
  const categoryLabel = useErrorCategoryLabel()
  const categories = props.data.error_categories
  if (!categories) return null
  const open = props.onOpen
  const owners = failureOwners(categories)
  const total = owners.reduce((sum, item) => sum + item.count, 0)
  const ownerLabels: Record<FailureOwner, string> = {
    ours: t('Ours: pool concurrency full'),
    upstream: t('Upstream: rate limits, overload and errors'),
    client: t('The client’s: invalid requests (4xx)'),
    other: t('Other'),
  }
  return (
    <Panel
      title={t('Whose failures')}
      description={t(
        'Customers only, root left out; the headline counts everyone.'
      )}
      help={t(
        'Customers’ failed requests by cause. With a model filter they narrow to one vendor only when every selected model is that vendor’s; otherwise they cover every model.'
      )}
    >
      {total === 0 ? (
        <p className='text-muted-foreground text-xs'>
          {t('No failed requests in this range')}
        </p>
      ) : (
        <div className='grid gap-4'>
          <ul className='grid gap-1.5 text-sm'>
            {owners.map((item) => {
              const tab = OWNER_TABS[item.owner]
              return (
                <li
                  key={item.owner}
                  className='flex items-baseline justify-between gap-2'
                >
                  <span className='min-w-0 truncate'>
                    {ownerLabels[item.owner]}
                  </span>
                  <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                    {fmt.num(item.count)} · {fmt.pct(item.count / total)}
                    {tab && open && ' · '}
                    {tab && open && (
                      <button
                        type='button'
                        className='text-primary font-medium hover:underline'
                        onClick={() => open(tab)}
                      >
                        {tabLabel(tab)} →
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          <Breakdown
            items={categories}
            label={categoryLabel}
            empty={t('No failed requests in this range')}
          />
        </div>
      )}
    </Panel>
  )
}
