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

import { cn } from '@/lib/utils'

import {
  SMALL_SAMPLE,
  TONES,
  failureTone,
  useHourAxis,
  useInsightsFormat,
  type InsightsRangeInfo,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type { UpstreamChannel, UpstreamInsights } from '../types'
import {
  SPEND_SERIES,
  attemptsOf,
  readBalance,
  upstreamHourSlots,
  upstreamSpendSeries,
} from '../upstream'
import { BarSeries, Panel } from './shared'

/** How many upstream cards the first screen shows; the table below lists the rest. */
const CARD_LIMIT = 8

/**
 * The upstreams worth a card: those that cost something or carried
 * attempts, or whose balance is read, dearest first.
 */
function cardChannels(data: UpstreamInsights | undefined) {
  return (data?.channels ?? [])
    .filter(
      (row) =>
        row.cost_usd > 0 || attemptsOf(row) > 0 || readBalance(row) !== null
    )
    .sort(
      (a, b) =>
        b.cost_usd - a.cost_usd || attemptsOf(b) - attemptsOf(a) || a.id - b.id
    )
}

function Figure(props: {
  label: string
  value: string
  tone?: string
  hint?: string
}) {
  return (
    <div className='min-w-0'>
      <dt className='text-muted-foreground text-[11px]'>{props.label}</dt>
      <dd
        className={cn(
          'truncate text-[13px] font-semibold tabular-nums sm:text-sm',
          props.tone
        )}
        title={props.hint}
      >
        {props.value}
      </dd>
    </div>
  )
}

function ChannelCard(props: { row: UpstreamChannel }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const row = props.row
  const balance = readBalance(row)
  const attempts = attemptsOf(row)
  const enough = attempts >= SMALL_SAMPLE
  return (
    <li className='bg-card min-w-0 rounded-lg border p-2.5 sm:p-3'>
      <p className='truncate text-sm font-medium' title={row.name}>
        {row.name}
        {row.status !== 1 && (
          <span className='text-muted-foreground ml-1.5 text-[11px] font-normal'>
            {row.status === 3 ? t('Auto-disabled') : t('Disabled')}
          </span>
        )}
      </p>
      <dl className='mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5 sm:gap-x-3 sm:gap-y-2'>
        <Figure
          label={t('Balance')}
          value={balance ? fmt.usd(balance.amount) : '—'}
          hint={
            balance
              ? t('read {{time}}', { time: fmt.time(balance.at) })
              : t('No balance is read for this upstream')
          }
        />
        <Figure
          label={t('Cost')}
          value={row.cost_source === 'none' ? '—' : fmt.usd(row.cost_usd)}
        />
        <Figure
          label={t('Failure rate')}
          value={attempts > 0 ? fmt.pct(row.failure_rate) : '—'}
          tone={enough ? TONES[failureTone(row.failure_rate)] : undefined}
          hint={
            !enough && attempts > 0
              ? t('Fewer than {{count}} attempts: too few to judge', {
                  count: SMALL_SAMPLE,
                })
              : undefined
          }
        />
        <Figure label={t('Attempts')} value={fmt.num(attempts)} />
      </dl>
    </li>
  )
}

/** One card per upstream: its balance, cost and failure rate. */
export function UpstreamChannelCards(props: {
  data: UpstreamInsights | undefined
}) {
  const { t } = useTranslation()
  const rows = cardChannels(props.data)
  if (rows.length === 0) return null
  return (
    <section aria-label={t('Upstreams')} className='grid gap-2'>
      <ul role='list' className='grid grid-cols-2 gap-2 xl:grid-cols-4'>
        {rows.slice(0, CARD_LIMIT).map((row) => (
          <ChannelCard key={row.id} row={row} />
        ))}
      </ul>
      {rows.length > CARD_LIMIT && (
        <p className='text-muted-foreground text-xs'>
          {t('{{count}} more upstreams are in the table below', {
            count: rows.length - CARD_LIMIT,
          })}
        </p>
      )}
    </section>
  )
}

/** What each upstream cost each day, or each hour on a short range, stacked by upstream. */
export function UpstreamSpendPanel(props: {
  data: UpstreamInsights | undefined
  range?: InsightsRangeInfo
  hourly: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const axis = useHourAxis()
  const partialDay = usePartialDays('upstream')
  const channels = props.data?.channels ?? []
  const names = new Map(channels.map((row) => [row.id, row.name]))
  const name = (id: number) => names.get(id) ?? `#${id}`
  const end = props.range?.end ?? Number.POSITIVE_INFINITY
  const daily = props.data?.daily ?? []
  const hourlyRows = props.data?.hourly ?? []
  const series = props.hourly
    ? upstreamSpendSeries(
        hourlyRows,
        (row) => row.hour,
        upstreamHourSlots(hourlyRows, props.range)
      )
    : upstreamSpendSeries(
        daily,
        (row) => row.day,
        [...new Set(daily.map((row) => row.day))].sort((a, b) => a - b)
      )
  const labels = [
    ...series.named.map(name),
    ...(series.hasOther ? [t('Other channels')] : []),
  ]
  const spent = series.slots.some((slot) => slot.total > 0)
  const points = props.hourly
    ? axis.bars(
        series.slots.map(({ slot, ...rest }) => ({ hour: slot, ...rest })),
        end,
        (hour) => ({ values: hour.costs }),
        props.data?.logs_since
      )
    : series.slots.map((day) => ({
        key: day.slot,
        title: fmt.day(day.slot),
        values: day.costs,
        partial: partialDay(day.slot, day.costs),
      }))
  return (
    <Panel
      title={t('Upstream spend by channel')}
      help={
        props.hourly
          ? t(
              'Each hour’s cost on each upstream, stacked: the {{count}} that cost most are named and the rest are one series. It is what the upstream billed, or its monthly fee spread over the hours, the same cost the table below reads.',
              { count: SPEND_SERIES }
            )
          : t(
              'Each day’s cost on each upstream, stacked: the {{count}} that cost most are named and the rest are one series. It is what the upstream billed, or its monthly fee spread over the days, the same cost the table below reads.',
              { count: SPEND_SERIES }
            )
      }
    >
      {spent ? (
        <BarSeries
          ariaLabel={t('Upstream spend by channel')}
          points={points}
          series={labels.map((label, at) => ({
            label,
            format: fmt.usd,
            muted: series.hasOther && at === series.named.length,
          }))}
        />
      ) : (
        <p className='text-muted-foreground text-sm'>
          {t('No upstream cost is known for this range.')}
        </p>
      )}
    </Panel>
  )
}
