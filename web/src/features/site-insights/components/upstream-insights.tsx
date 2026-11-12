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
// CoreCode fork: the upstream tab's deeper panels: hourly charts and
// incident windows, what changed by channel, run-rate and fees, routing.

import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { runRate, type Contribution } from '../analysis'
import {
  HOUR_SAMPLE,
  MIN_TASKS,
  loggedDays,
  SHORT_ROI_DAYS,
  SMALL_SAMPLE,
  TONES,
  failureTone,
  joinSentences,
  useHourAxis,
  useInsightsFormat,
  type InsightsRangeInfo,
} from '../lib'
import type { UpstreamInsights } from '../types'
import {
  UPSTREAM_MIN_ATTEMPTS,
  attemptsOf,
  channelNamer,
  channelTasks,
  feeBreakEven,
  finishedTasks,
  routingHints,
  splitsClientErrors,
  upstreamChanges,
  upstreamHourlySeries,
  upstreamIncidents,
  upstreamTotals,
  type UpstreamModelRow,
} from '../upstream'
import {
  Drivers,
  Findings,
  SampleNote,
  type DriverRow,
  type Finding,
} from './insight-kit'
import { BarSeries, MetricGrid, Panel, SimpleTable, type Tone } from './shared'
import { useRevenueBars, useUpstreamHelp } from './upstream-help'

/**
 * The upstream charts by the hour, for a short range: attempts with the
 * hours of an incident flagged, failure rates where an hour has enough
 * attempts, and revenue against cost.
 */
export function UpstreamHourlyCharts(props: {
  data: UpstreamInsights | undefined
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const axis = useHourAxis()
  const name = channelNamer(props.data)
  const series = upstreamHourlySeries(
    props.data?.channels ?? [],
    props.data?.hourly,
    props.range
  )
  const incidents = upstreamIncidents(
    props.data?.hourly,
    props.data?.rescues,
    props.range
  )
  const end = props.range?.end ?? Number.POSITIVE_INFINITY
  // An hour before the logs has no attempts to read: drawn missing.
  const logsSince = props.data?.logs_since
  const labels = [
    ...series.named.map(name),
    ...(series.hasOther ? [t('Other channels')] : []),
  ]
  const inIncident = (hour: number) =>
    incidents.some((item) => hour >= item.start && hour < item.end)
  const muted = (at: number) => series.hasOther && at === series.named.length
  const help = useUpstreamHelp()
  const splits = splitsClientErrors(props.data)
  const revenue = useRevenueBars(series.hours)
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Panel
        title={t('Attempts by channel')}
        help={joinSentences(
          t(
            'Each hour’s attempts on each channel, stacked; the readout lists each channel’s failed attempts. Red marks an hour inside an incident.'
          ),
          splits && help.clientLeftOut
        )}
      >
        <BarSeries
          ariaLabel={t('Attempts by channel')}
          points={axis.bars(
            series.hours,
            end,
            (hour) => ({
              values: hour.attempts,
              tone: inIncident(hour.hour) ? 'danger' : undefined,
              extra: labels.map((label, at) => ({
                label: t('{{name}} failed', { name: label }),
                value: fmt.num(hour.errors[at]),
              })),
            }),
            logsSince
          )}
          series={labels.map((label, at) => ({
            label,
            compact: fmt.num,
            muted: muted(at),
          }))}
        />
      </Panel>
      <Panel
        title={t('Failure rate by channel')}
        help={joinSentences(
          t(
            'Each hour’s failed attempts over attempts, per channel, side by side. An hour with fewer than {{count}} attempts on a channel has no rate.',
            { count: HOUR_SAMPLE }
          ),
          splits && help.clientLeftOut
        )}
      >
        <BarSeries
          grouped
          ariaLabel={t('Failure rate by channel')}
          points={axis.bars(
            series.hours,
            end,
            (hour) => ({
              values: hour.failureRates.map((rate, at) =>
                hour.attempts[at] >= HOUR_SAMPLE ? rate : 0
              ),
              extra: labels.flatMap((label, at) =>
                hour.attempts[at] > 0 && hour.attempts[at] < HOUR_SAMPLE
                  ? [
                      {
                        label,
                        value: t('{{count}} attempts, too few for a rate', {
                          count: hour.attempts[at],
                        }),
                      },
                    ]
                  : []
              ),
            }),
            logsSince
          )}
          series={labels.map((label, at) => ({
            label,
            format: fmt.pct,
            muted: muted(at),
          }))}
        />
      </Panel>
      <Panel
        className='lg:col-span-2'
        title={t('Revenue and cost')}
        help={joinSentences(
          t(
            'Each hour’s revenue on the channels whose cost is known beside what they cost; revenue on channels with no known cost is drawn grey and left out of the margin. Revenue falls in the hour a request began and the upstream bill in the hour the upstream wrote it, so a single hour’s margin is rough.'
          ),
          help.units
        )}
      >
        <BarSeries
          grouped
          ariaLabel={t('Revenue and cost')}
          points={axis.bars(
            series.hours,
            end,
            (hour) => ({
              values: revenue.values(hour),
              extra: revenue.extra(hour),
            }),
            logsSince
          )}
          series={revenue.series}
        />
      </Panel>
    </div>
  )
}

/**
 * The incident windows of a short range: when each channel failed past 5%,
 * how badly, and who served what failed on it.
 */
export function UpstreamIncidents(props: {
  data: UpstreamInsights | undefined
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const help = useUpstreamHelp()
  const name = channelNamer(props.data)
  const incidents = upstreamIncidents(
    props.data?.hourly,
    props.data?.rescues,
    props.range
  )
  const items: Finding[] = incidents.map((item) => {
    const values = {
      name: name(item.channel_id),
      rate: fmt.pct(item.rate),
      start: fmt.time(item.start),
      end: fmt.time(item.end),
      errors: fmt.num(item.errors),
      attempts: fmt.num(item.attempts),
    }
    const rescuer = item.rescuer
    return {
      key: `${item.channel_id}:${item.start}`,
      tone: 'danger',
      impact: item.errors,
      title: item.ongoing
        ? t('{{name}}: {{rate}} failed since {{start}}, still failing', values)
        : t('{{name}}: {{rate}} failed from {{start}} to {{end}}', values),
      detail: rescuer
        ? t(
            '{{errors}} of {{attempts}} attempts failed. Across the range, {{to}} served {{count}} requests that failed on it.',
            {
              ...values,
              to: name(rescuer.to),
              count: fmt.num(rescuer.count),
            }
          )
        : t(
            '{{errors}} of {{attempts}} attempts failed. No other channel served what failed on it.',
            values
          ),
    }
  })
  return (
    <Panel
      title={t('Incidents')}
      help={joinSentences(
        t(
          'Runs of hours in which a channel failed more than 5% of its attempts, over at least {{count}} attempts in the run. Failover is counted over the whole range.',
          { count: SMALL_SAMPLE }
        ),
        splitsClientErrors(props.data) && help.clientLeftOut
      )}
    >
      <Findings
        items={items}
        empty={t(
          'No channel failed past 5% for long enough to count as an incident.'
        )}
      />
    </Panel>
  )
}

const DRIVER_ROWS = 3

/**
 * What moved the failures, the failures customers saw and the margin
 * against the previous period, by channel.
 */
export function UpstreamChanges(props: {
  data: UpstreamInsights | undefined
  previous: UpstreamInsights | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const name = channelNamer(props.data)
  const previousName = channelNamer(props.previous)
  if (!props.data || !props.previous) return null
  const changes = upstreamChanges(props.data, props.previous)
  const label = (key: string) => {
    const id = Number(key)
    const current = name(id)
    return current === `#${id}` ? previousName(id) : current
  }
  const signed = (value: number, format: (value: number) => string) =>
    `${value > 0 ? '+' : '−'}${format(Math.abs(value))}`
  const rows = (
    parts: Contribution[],
    format: (value: number) => string,
    better: 'up' | 'down'
  ): { rows: DriverRow[]; total: number } => {
    const total = parts.reduce((sum, part) => sum + part.change, 0)
    return {
      total,
      rows: parts.slice(0, DRIVER_ROWS).map((part) => {
        const improved = better === 'up' ? part.change > 0 : part.change < 0
        const sameWay =
          total !== 0 && Math.sign(part.change) === Math.sign(total)
        return {
          key: part.key,
          label: label(part.key),
          change: changes.fresh.has(part.key)
            ? t('New, {{value}}', { value: format(part.current) })
            : signed(part.change, format),
          share: sameWay ? fmt.pct(part.change / total) : undefined,
          tone: improved ? 'good' : 'warning',
        }
      }),
    }
  }
  const failures = rows(changes.failures, fmt.num, 'down')
  const unrescued = rows(changes.unrescued, fmt.num, 'down')
  const margin = rows(changes.margin, fmt.usd, 'up')
  const total = (value: number, format: (value: number) => string) =>
    value === 0 ? '0' : signed(value, format)
  return (
    <Panel
      title={t('What changed by channel')}
      help={t(
        'Each channel’s part in the change against the previous period of the same length, largest first, with its share of the whole change. A channel the previous period did not list reads as new.'
      )}
    >
      <div className='grid gap-4 lg:grid-cols-3'>
        <Drivers
          title={t('Failed attempts: {{change}} in all', {
            change: total(failures.total, fmt.num),
          })}
          rows={failures.rows}
          empty={t('Failed attempts did not change.')}
        />
        <Drivers
          title={t('Failures customers saw: {{change}} in all', {
            change: total(unrescued.total, fmt.num),
          })}
          rows={unrescued.rows}
          empty={t('Failures customers saw did not change.')}
        />
        <Drivers
          title={t('Gross margin: {{change}} in all', {
            change: total(margin.total, fmt.usd),
          })}
          rows={margin.rows}
          empty={t('Gross margin did not change.')}
        />
      </div>
    </Panel>
  )
}

/**
 * The range scaled to 30 days, and whether each monthly-fee channel earns
 * its fee. Needs the range's length; without it, nothing.
 */
export function UpstreamRunRate(props: {
  data: UpstreamInsights | undefined
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const help = useUpstreamHelp()
  // Scaled over the days the logs cover: an hour before them has no data.
  const days = props.range ? loggedDays(props.range, props.data?.logs_since) : 0
  if (!props.data || days <= 0) return null
  const totals = upstreamTotals(props.data)
  if (totals.attempts === 0 && totals.cost === 0) return null
  const judged = days >= SHORT_ROI_DAYS
  const basis = t('Extrapolated from {{days}} days', {
    days: fmt.num(Math.round(days * 10) / 10),
  })
  const fees: Finding[] = props.data.channels.flatMap((row) => {
    const even = feeBreakEven(row, days)
    if (!even) return []
    const values = {
      name: row.name,
      revenue: fmt.usd(even.dailyRevenue),
      fee: fmt.usd(even.dailyFee),
      gap: fmt.usd(Math.abs(even.gap)),
    }
    let tone: Finding['tone'] = 'default'
    if (judged) tone = even.gap >= 0 ? 'good' : 'warning'
    return [
      {
        key: String(row.id),
        tone,
        impact: Math.abs(even.gap),
        title:
          even.gap >= 0
            ? t(
                '{{name}} pays for itself: {{revenue}} a day against a fee of {{fee}} a day.',
                values
              )
            : t(
                '{{name}} is short by {{gap}} a day: {{revenue}} a day against a fee of {{fee}} a day.',
                values
              ),
        detail: judged
          ? undefined
          : t(
              'Fewer than {{days}} days of data; check it again over a longer range.',
              { days: SHORT_ROI_DAYS }
            ),
      },
    ]
  })
  return (
    <Panel
      title={t('Run-rate and fees')}
      help={joinSentences(
        t(
          'This range’s revenue, cost and margin scaled to 30 days: an extrapolation, not a forecast. A monthly-fee channel pays for itself when what it earns a day covers a thirtieth of its fee.'
        ),
        help.units
      )}
    >
      <div className='grid gap-4'>
        <MetricGrid
          className='grid-cols-1 sm:grid-cols-3 lg:grid-cols-3'
          items={[
            {
              label: t('Revenue in 30 days'),
              value: fmt.usd(runRate(totals.revenue, days)),
              hint: basis,
            },
            {
              label: t('Cost in 30 days'),
              value: fmt.usd(runRate(totals.cost, days)),
              hint: basis,
            },
            {
              label: t('Gross margin in 30 days'),
              value: fmt.usd(runRate(totals.margin, days)),
              hint: basis,
              tone: totals.margin < 0 ? 'danger' : 'default',
            },
          ]}
        />
        <Findings items={fees} />
      </div>
    </Panel>
  )
}

/**
 * Under the model comparison: a note when too few attempts let any model
 * compare its channels, and a hint where the best channel for a model has
 * a lower priority than the busiest.
 */
export function UpstreamRoutingNotes(props: {
  data: UpstreamInsights | undefined
  rows: UpstreamModelRow[]
}) {
  const { t } = useTranslation()
  const name = channelNamer(props.data)
  if (!props.data || props.rows.length === 0) return null
  const counts = new Map<string, number>()
  for (const row of props.rows) {
    if (attemptsOf(row) >= UPSTREAM_MIN_ATTEMPTS) {
      counts.set(row.model, (counts.get(row.model) ?? 0) + 1)
    }
  }
  const comparable = [...counts.values()].some((count) => count > 1)
  const hints: Finding[] = routingHints(props.rows, props.data.channels).map(
    (hint) => {
      const priority = (id: number) =>
        props.data?.channels.find((row) => row.id === id)?.priority ?? 0
      const values = {
        model: hint.model,
        better: name(hint.better),
        busiest: name(hint.busiest),
        low: priority(hint.better),
        high: priority(hint.busiest),
      }
      return {
        key: `${hint.model}:${hint.better}`,
        tone: 'warning',
        title: hint.earnsMore
          ? t(
              'For {{model}}, {{better}} fails less and earns more than {{busiest}}, but has a lower priority ({{low}} against {{high}}).',
              values
            )
          : t(
              'For {{model}}, {{better}} fails less than {{busiest}}, but has a lower priority ({{low}} against {{high}}).',
              values
            ),
      }
    }
  )
  return (
    <div className='mt-3 grid gap-3'>
      {!comparable && (
        <SampleNote>
          {t(
            'Too few attempts to compare channels: no model has {{count}} attempts or more on two channels.',
            { count: UPSTREAM_MIN_ATTEMPTS }
          )}
        </SampleNote>
      )}
      <Findings items={hints} />
    </div>
  )
}

/**
 * How the async tasks (images, video) each channel took in the range stand
 * now. A task failure rate over fewer than MIN_TASKS finished tasks is not
 * coloured. Nothing when no channel ran a task, or on a server that does
 * not send tasks.
 */
export function UpstreamTasks(props: { data: UpstreamInsights | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const rows = channelTasks(props.data)
  if (rows.length === 0) return null
  const tone = (finished: number, rate: number): Tone =>
    finished >= MIN_TASKS ? failureTone(rate) : 'default'
  return (
    <Panel
      title={t('Tasks by channel')}
      help={t(
        'Async image and video tasks submitted to each channel in the range, as they stand now, everyone’s included. Failed includes timed out; the failure rate is failed over finished tasks, not coloured under {{count}} finished. Running tasks submitted 30 minutes ago or more are stalled. Finish times are over successes.',
        { count: MIN_TASKS }
      )}
    >
      <SimpleTable
        rows={rows}
        rowKey={(row) => row.channel.id}
        empty={t('No channel ran a task in this range.')}
        columns={[
          {
            key: 'channel',
            label: t('Channel'),
            render: (row) => (
              <span className='font-medium'>{row.channel.name}</span>
            ),
          },
          {
            key: 'submitted',
            label: t('Submitted'),
            align: 'right',
            render: (row) => (
              <span className='tabular-nums'>
                {fmt.num(row.tasks.submitted)}
              </span>
            ),
          },
          {
            key: 'failure',
            label: t('Failure rate'),
            align: 'right',
            render: (row) => {
              const finished = finishedTasks(row.tasks)
              return (
                <span className='block tabular-nums'>
                  <span
                    className={TONES[tone(finished, row.tasks.failure_rate)]}
                  >
                    {finished > 0 ? fmt.pct(row.tasks.failure_rate) : '—'}
                  </span>
                  <span className='text-muted-foreground block text-[11px]'>
                    {row.tasks.timed_out > 0
                      ? t('{{failed}} failed, {{timedOut}} timed out', {
                          failed: fmt.num(row.tasks.failed),
                          timedOut: fmt.num(row.tasks.timed_out),
                        })
                      : t('{{failed}} of {{finished}} failed', {
                          failed: fmt.num(row.tasks.failed),
                          finished: fmt.num(finished),
                        })}
                  </span>
                </span>
              )
            },
          },
          {
            key: 'running',
            label: t('Running'),
            align: 'right',
            render: (row) => (
              <span className='block tabular-nums'>
                {fmt.num(row.tasks.running)}
                {row.tasks.stalled > 0 && (
                  <span className={cn('block text-[11px]', TONES.warning)}>
                    {t('{{count}} stalled', {
                      count: fmt.num(row.tasks.stalled),
                    })}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'finish',
            label: t('Finish p50'),
            align: 'right',
            render: (row) => (
              <span className='block tabular-nums'>
                {row.tasks.succeeded > 0 ? `${row.tasks.finish_p50_s}s` : '—'}
                {row.tasks.succeeded > 0 && (
                  <span className='text-muted-foreground block text-[11px]'>
                    p95 {row.tasks.finish_p95_s}s
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'reason',
            label: t('Top failure'),
            render: (row) => {
              const top = row.tasks.reasons?.[0]
              return top ? (
                <span
                  className='text-muted-foreground line-clamp-2 text-xs'
                  title={top.name}
                >
                  {t('{{reason}} ({{count}})', {
                    reason: top.name,
                    count: fmt.num(top.count),
                  })}
                </span>
              ) : (
                <span className='text-muted-foreground'>—</span>
              )
            },
          },
        ]}
      />
    </Panel>
  )
}
