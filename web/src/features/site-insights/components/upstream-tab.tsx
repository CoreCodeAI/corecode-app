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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { saveUpstreamFees } from '../api'
import {
  SMALL_SAMPLE,
  TONES,
  failureTone,
  joinSentences,
  rangeHours,
  tableState,
  useInsightsDefinitions,
  useInsightsFormat,
  type InsightsRangeInfo,
  type InsightsSources,
  type InsightsTab,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type { UpstreamChannel, UpstreamInsights } from '../types'
import {
  attemptsOf,
  channelNamer,
  channelTokens,
  UPSTREAM_COST_MAX_KEYS,
  faultsOf,
  partialBill,
  rescuedFrom,
  revenuePerRequest,
  shortBills,
  splitsClientErrors,
  staleCosts,
  unmatchedCosts,
  unrescuedOf,
  upstreamDailySeries,
  upstreamMargin,
  upstreamModelComparison,
  upstreamTotals,
  type UpstreamModelRow,
} from '../upstream'
import { useUpstreamVerdict } from '../verdicts'
import { SampleNote, StaleNote } from './insight-kit'
import {
  BarSeries,
  Breakdown,
  DeltaBadge,
  MetricGrid,
  Panel,
  SimpleTable,
  TruncatedNotice,
  Verdict,
  type MetricDelta,
  type TableState,
  type Tone,
} from './shared'
import { useRevenueBars, useUpstreamHelp } from './upstream-help'
import {
  UpstreamChanges,
  UpstreamHourlyCharts,
  UpstreamIncidents,
  UpstreamRoutingNotes,
  UpstreamRunRate,
  UpstreamTasks,
} from './upstream-insights'

const BEST = 'font-semibold text-emerald-600 dark:text-emerald-400'

/** A failure rate over too few attempts stays uncolored. */
function rateTone(
  row: { requests: number; errors: number },
  rate: number
): Tone {
  return attemptsOf(row) >= SMALL_SAMPLE ? failureTone(rate) : 'default'
}

function NewBadge() {
  const { t } = useTranslation()
  return (
    <span className='text-muted-foreground text-xs font-normal whitespace-nowrap'>
      {t('New this period')}
    </span>
  )
}

/**
 * A row's change against the previous period: none without one, new for a
 * channel it did not list, else the badge.
 */
function RowDelta(props: { listed: boolean | undefined; delta: MetricDelta }) {
  if (props.listed === undefined) return null
  if (!props.listed) return <NewBadge />
  return <DeltaBadge delta={props.delta} />
}

function CostSourceLabel(props: { row: UpstreamChannel; stale: boolean }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const row = props.row
  if (row.cost_source === 'upstream') {
    const partial = partialBill(row)
    return (
      <span className='text-muted-foreground block text-[11px] whitespace-nowrap'>
        <span className='block'>
          {row.upstream_group
            ? t('Upstream bill · {{group}} {{ratio}}×', {
                group: row.upstream_group,
                ratio: row.upstream_group_ratio,
              })
            : t('Upstream bill')}
        </span>
        <span className={cn('block', props.stale && TONES.warning)}>
          {props.stale
            ? t('read {{time}}, behind', { time: fmt.time(row.latest_cost_at) })
            : t('read {{time}}', { time: fmt.time(row.latest_cost_at) })}
        </span>
        {partial?.kind === 'keys' && (
          <span className={cn('block', TONES.warning)}>
            {t('Partial: {{read}} of {{count}} keys read', {
              read: partial.read,
              count: partial.total,
            })}
          </span>
        )}
        {partial?.kind === 'disabled' && (
          <span className='block'>{t('Partial: not read while disabled')}</span>
        )}
      </span>
    )
  }
  if (row.cost_source === 'fee') {
    return (
      <span className='text-muted-foreground block text-[11px]'>
        {t('{{fee}} a month', { fee: fmt.usd(row.monthly_fee_usd) })}
      </span>
    )
  }
  return (
    <span className='text-muted-foreground block text-[11px]'>
      {t('Cost unknown')}
    </span>
  )
}

/**
 * Why and when a channel, or on an enabled multi-key channel its latest
 * key, was disabled; null when the server does not say.
 */
function DisableNote(props: { row: UpstreamChannel }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const row = props.row
  const reason = row.status_reason?.trim() ?? ''
  const time = row.status_time ? fmt.time(row.status_time) : ''
  const disabledKeys = row.disabled_keys ?? 0
  const keys = row.key_count ?? 0
  let text = ''
  if (row.status !== 1) {
    if (time && reason) {
      text = t('Disabled {{time}}: {{reason}}', { time, reason })
    } else if (time) {
      text = t('Disabled {{time}}', { time })
    } else {
      text = reason
    }
  } else if (disabledKeys > 0) {
    const count = t('{{disabled}} of {{count}} keys disabled', {
      disabled: disabledKeys,
      count: keys,
    })
    text =
      time && reason
        ? t('{{keys}}; the latest {{time}}: {{reason}}', {
            keys: count,
            time,
            reason,
          })
        : count
  }
  if (!text) return null
  return (
    <span
      className={cn(
        'block truncate text-[11px]',
        row.status === 3 ? TONES.warning : 'text-muted-foreground'
      )}
      title={text}
    >
      {text}
    </span>
  )
}

function ChannelName(props: { row: UpstreamChannel }) {
  const { t } = useTranslation()
  return (
    <span className='block min-w-0'>
      <span className='flex items-center gap-1.5'>
        <span className='truncate font-medium'>{props.row.name}</span>
        {props.row.status !== 1 && (
          <Badge variant='outline' className='h-4 px-1 text-[10px]'>
            {props.row.status === 3 ? t('Auto-disabled') : t('Disabled')}
          </Badge>
        )}
      </span>
      <span className='text-muted-foreground block truncate text-[11px]'>
        {props.row.host || '—'} ·{' '}
        {t('priority {{priority}}', { priority: props.row.priority })}
      </span>
      <DisableNote row={props.row} />
    </span>
  )
}

function ChannelTable(props: {
  data: UpstreamInsights | undefined
  previous: UpstreamInsights | undefined
  range?: InsightsRangeInfo
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const help = useUpstreamHelp()
  const splits = splitsClientErrors(props.data)
  const channels = props.data?.channels ?? []
  const before = new Map(
    (props.previous?.channels ?? []).map((row) => [row.id, row])
  )
  const listed = (row: UpstreamChannel) =>
    props.previous ? before.has(row.id) : undefined
  const rescued = rescuedFrom(props.data?.rescues)
  const stale = new Set(
    staleCosts(props.data, props.range?.end).map((item) => item.channel.id)
  )
  const served = channels.reduce((sum, row) => sum + row.requests, 0)
  const margin = (row: UpstreamChannel) => {
    const value = upstreamMargin(row)
    if (value.margin === null) {
      return <span className='text-muted-foreground'>—</span>
    }
    const behind = stale.has(row.id)
    const short = partialBill(row)?.kind === 'keys'
    let tone: Tone = 'default'
    if (value.margin < 0) {
      tone = 'danger'
    } else if (behind || short) {
      tone = 'warning'
    }
    return (
      <span className='block'>
        <span className={cn('tabular-nums', TONES[tone])}>
          {fmt.usd(value.margin)}
        </span>
        {behind && (
          <span className='text-muted-foreground block text-[11px]'>
            {t('Overstated: recent revenue has no cost yet')}
          </span>
        )}
        {!behind && short && (
          <span className='text-muted-foreground block text-[11px]'>
            {t('Overstated: part of the bill is not read')}
          </span>
        )}
        {!behind && !short && value.rate !== null && (
          <span className='text-muted-foreground block text-[11px] tabular-nums'>
            {fmt.pct(value.rate)}
          </span>
        )}
      </span>
    )
  }
  const failure = (row: UpstreamChannel) => {
    const previous = before.get(row.id)
    const enough = attemptsOf(row) >= SMALL_SAMPLE
    const comparable =
      enough && previous !== undefined && attemptsOf(previous) >= SMALL_SAMPLE
    let change: ReactNode = null
    if (listed(row) === false) {
      change = <NewBadge />
    } else if (comparable) {
      change = (
        <DeltaBadge
          delta={{
            current: row.failure_rate,
            previous: previous.failure_rate,
            better: 'down',
            points: true,
          }}
        />
      )
    }
    return (
      <span className='block tabular-nums'>
        <span
          className={TONES[rateTone(row, row.failure_rate)]}
          title={
            enough || attemptsOf(row) === 0
              ? undefined
              : t('Fewer than {{count}} attempts: too few to judge', {
                  count: SMALL_SAMPLE,
                })
          }
        >
          {fmt.pct(row.failure_rate)}
        </span>
        <span className='text-muted-foreground block text-[11px]'>
          {row.client_errors
            ? t('{{count}} failed, {{client}} by the client', {
                count: faultsOf(row),
                client: row.client_errors,
              })
            : t('{{count}} failed', { count: faultsOf(row) })}{' '}
          {change}
        </span>
      </span>
    )
  }
  return (
    <SimpleTable
      rows={channels}
      state={props.state}
      rowKey={(row) => row.id}
      empty={t('No channel has traffic in this range.')}
      faded={(row) => attemptsOf(row) === 0}
      columns={[
        {
          key: 'name',
          label: t('Channel'),
          render: (row) => <ChannelName row={row} />,
        },
        {
          key: 'requests',
          label: t('Served'),
          hint: t(
            'Requests the channel answered, and their share of all answered requests.'
          ),
          align: 'right',
          render: (row) => (
            <span className='block tabular-nums'>
              {fmt.num(row.requests)}
              <span className='text-muted-foreground block text-[11px]'>
                {fmt.pct(served ? row.requests / served : 0)}{' '}
                <RowDelta
                  listed={listed(row)}
                  delta={{
                    current: row.requests,
                    previous: before.get(row.id)?.requests ?? 0,
                    better: 'neutral',
                  }}
                />
              </span>
            </span>
          ),
        },
        {
          key: 'failure',
          label: t('Failure rate'),
          hint: joinSentences(
            t(
              'Failed attempts over all attempts on the channel. A request retried on another channel counts as a failure here and a success there. Under {{count}} attempts the rate is not colored or compared.',
              { count: SMALL_SAMPLE }
            ),
            splits && help.clientLeftOut
          ),
          align: 'right',
          render: failure,
        },
        {
          key: 'unrescued',
          label: t('Unrescued'),
          hint: t(
            'Failed attempts less the requests another channel then served, which customers likely saw. Attempt based: retries on the same channel count each time, so it can run high.'
          ),
          align: 'right',
          render: (row) => {
            const count = unrescuedOf(row, rescued)
            const faults = faultsOf(row)
            return (
              <span className='block tabular-nums'>
                {fmt.num(count)}
                {faults > 0 && (
                  <span className='text-muted-foreground block text-[11px]'>
                    {t('{{rate}} rescued', {
                      rate: fmt.pct(1 - count / faults),
                    })}
                  </span>
                )}
              </span>
            )
          },
        },
        {
          key: 'ttft',
          label: t('TTFT p50'),
          hint: t(
            'Median time to the first token of streamed requests the channel served.'
          ),
          align: 'right',
          render: (row) => (
            <span className='block tabular-nums'>
              {fmt.measuredMs(row.ttft_p50_ms)}
              <span className='text-muted-foreground block text-[11px]'>
                p95 {fmt.measuredMs(row.ttft_p95_ms)}
              </span>
            </span>
          ),
        },
        {
          key: 'rescued',
          label: t('Rescued'),
          hint: t(
            'Requests the channel served after they had failed on another channel.'
          ),
          align: 'right',
          render: (row) => (
            <span className='tabular-nums'>{fmt.num(row.rescued)}</span>
          ),
        },
        {
          key: 'tokens',
          label: t('Cache hit'),
          hint: t(
            'Cache reads over input tokens, and the cost of a million input and output tokens. Prompt tokens include cache reads in OpenAI usage and leave them out in Anthropic usage; a channel serving only Claude models is read the Anthropic way. Cache writes are not counted.'
          ),
          align: 'right',
          render: (row) => {
            const tokens = channelTokens(row, props.data?.models)
            return (
              <span className='block tabular-nums'>
                {tokens.cacheRate === null ? '—' : fmt.pct(tokens.cacheRate)}
                {tokens.costPerMillion !== null && (
                  <span className='text-muted-foreground block text-[11px] whitespace-nowrap'>
                    {t('{{cost}} per 1M tokens', {
                      cost: fmt.usdFine(tokens.costPerMillion),
                    })}
                  </span>
                )}
              </span>
            )
          },
        },
        {
          key: 'revenue',
          label: t('Revenue'),
          hint: joinSentences(
            t(
              'What customers were charged for the requests the channel served; root and staff are left out.'
            ),
            help.units
          ),
          align: 'right',
          render: (row) => (
            <span className='tabular-nums'>{fmt.usd(row.revenue_usd)}</span>
          ),
        },
        {
          key: 'cost',
          label: t('Cost'),
          hint: joinSentences(
            t(
              'The upstream bill read from the upstream site with the channel key, or the monthly fee spread over the range.'
            ),
            help.costUnits,
            t(
              'The reader reads a channel’s first {{count}} keys and stops once the channel is disabled, so a bill short of either reads as partial.',
              { count: UPSTREAM_COST_MAX_KEYS }
            )
          ),
          align: 'right',
          render: (row) => (
            <span className='block'>
              <span className='tabular-nums'>
                {row.cost_source === 'none' ? '—' : fmt.usd(row.cost_usd)}
              </span>
              <CostSourceLabel row={row} stale={stale.has(row.id)} />
            </span>
          ),
        },
        {
          key: 'margin',
          label: t('Gross margin'),
          hint: joinSentences(
            t('Revenue less cost, and that over revenue.'),
            help.units
          ),
          align: 'right',
          render: margin,
        },
      ]}
    />
  )
}

function DailyCharts(props: { data: UpstreamInsights | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('upstream')
  const name = channelNamer(props.data)
  const series = upstreamDailySeries(
    props.data?.channels ?? [],
    props.data?.daily ?? []
  )
  const labels = [
    ...series.named.map(name),
    ...(series.hasOther ? [t('Other channels')] : []),
  ]
  const muted = (at: number) => series.hasOther && at === series.named.length
  const help = useUpstreamHelp()
  const splits = splitsClientErrors(props.data)
  const revenue = useRevenueBars(series.days)
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Panel
        title={t('Attempts by channel')}
        help={joinSentences(
          t(
            'Each day’s attempts on each channel, stacked; the readout lists each channel’s failed attempts.'
          ),
          splits && help.clientLeftOut
        )}
      >
        <BarSeries
          ariaLabel={t('Attempts by channel')}
          points={series.days.map((day) => ({
            key: day.day,
            title: fmt.day(day.day),
            values: day.attempts,
            partial: partialDay(day.day, day.attempts),
            extra: labels.map((label, at) => ({
              label: t('{{name}} failed', { name: label }),
              value: fmt.num(day.errors[at]),
            })),
          }))}
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
            'Each day’s failed attempts over attempts, per channel, side by side.'
          ),
          splits && help.clientLeftOut
        )}
      >
        <BarSeries
          grouped
          ariaLabel={t('Failure rate by channel')}
          points={series.days.map((day) => ({
            key: day.day,
            title: fmt.day(day.day),
            values: day.failureRates,
            partial: partialDay(day.day),
          }))}
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
            'Each day’s revenue on the channels whose cost is known beside what they cost that day; revenue on channels with no known cost is drawn grey and left out of the margin.'
          ),
          help.units
        )}
      >
        <BarSeries
          grouped
          ariaLabel={t('Revenue and cost')}
          points={series.days.map((day) => ({
            key: day.day,
            title: fmt.day(day.day),
            values: revenue.values(day),
            partial: partialDay(day.day, revenue.values(day)),
            extra: revenue.extra(day),
          }))}
          series={revenue.series}
        />
      </Panel>
    </div>
  )
}

function ModelComparison(props: {
  data: UpstreamInsights | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const name = channelNamer(props.data)
  const rows = upstreamModelComparison(
    props.data?.models ?? [],
    props.data?.channels ?? []
  )
  const customers = (props.data?.models ?? []).some(
    (row) => row.customer_requests != null
  )
  const unmatched = unmatchedCosts(props.data)
  const mark = (best: boolean, value: ReactNode) => (
    <span className={cn('tabular-nums', best && BEST)}>{value}</span>
  )
  return (
    <Panel
      title={t('Same model, different channels')}
      help={t(
        'Models served by more than one channel, each channel on its own row. Green marks the best channel for a figure among those with at least 20 attempts.'
      )}
    >
      <SimpleTable<UpstreamModelRow>
        rows={rows}
        state={props.state}
        rowKey={(row) => `${row.model}:${row.channel_id}`}
        empty={t('No model has traffic in this range.')}
        columns={[
          {
            key: 'model',
            label: t('Model'),
            render: (row) => (
              <span
                className={cn(
                  'font-mono text-xs',
                  !row.first && 'text-muted-foreground/60'
                )}
              >
                {row.model}
              </span>
            ),
          },
          {
            key: 'channel',
            label: t('Channel'),
            render: (row) => name(row.channel_id),
          },
          {
            key: 'attempts',
            label: t('Attempts'),
            align: 'right',
            render: (row) => (
              <span className='tabular-nums'>{fmt.num(attemptsOf(row))}</span>
            ),
          },
          {
            key: 'failure',
            label: t('Failure rate'),
            align: 'right',
            render: (row) => mark(row.best.failure, fmt.pct(row.failure_rate)),
          },
          {
            key: 'ttft',
            label: t('TTFT p50'),
            align: 'right',
            render: (row) =>
              mark(row.best.ttft, fmt.measuredMs(row.ttft_p50_ms)),
          },
          {
            key: 'latency',
            label: t('Duration p50'),
            align: 'right',
            render: (row) => (
              <span className='tabular-nums'>
                {row.latency_p50_s ? `${row.latency_p50_s}s` : '—'}
              </span>
            ),
          },
          {
            key: 'revenue',
            label: t('Revenue per request'),
            hint: customers
              ? t(
                  'What customers were charged per request they sent; root and staff requests and charges are both left out.'
                )
              : t(
                  'What customers were charged over every request served, root and staff included, though their charges are not, so it reads low where they used the channel.'
                ),
            align: 'right',
            render: (row) => {
              const value = revenuePerRequest(row)
              return (
                <span className='tabular-nums'>
                  {value === null ? '—' : fmt.usdFine(value)}
                </span>
              )
            },
          },
          {
            key: 'cost',
            label: t('Cost per request'),
            hint: t(
              'The upstream bill over every request served, root and staff included: their use costs money too.'
            ),
            align: 'right',
            render: (row) => (
              <span className='tabular-nums'>
                {row.marginRate !== null && row.requests
                  ? fmt.usdFine(row.cost_usd / row.requests)
                  : '—'}
              </span>
            ),
          },
          {
            key: 'margin',
            label: t('Gross margin'),
            align: 'right',
            render: (row) =>
              row.marginRate === null ? (
                <span className='text-muted-foreground'>—</span>
              ) : (
                mark(row.best.margin, fmt.pct(row.marginRate))
              ),
          },
        ]}
      />
      {unmatched.length > 0 && (
        <div className='mt-3 grid gap-1'>
          {unmatched.map((row) => (
            <SampleNote key={row.id}>
              {t(
                '{{cost}} of the upstream bill of {{name}} names no model the channel served here, so it is in the channel’s cost but in no row above, and the margins of its models read high.',
                {
                  cost: fmt.usd(row.unmatched_cost_usd ?? 0),
                  name: row.name,
                }
              )}
            </SampleNote>
          ))}
        </div>
      )}
      <UpstreamRoutingNotes data={props.data} rows={rows} />
    </Panel>
  )
}

function FailurePanels(props: {
  data: UpstreamInsights | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const name = channelNamer(props.data)
  const failing = (props.data?.channels ?? []).filter((row) => row.errors > 0)
  const errors = new Map(
    (props.data?.channels ?? []).map((row) => [row.id, row.errors])
  )
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Panel
        title={t('Why channels failed')}
        help={t(
          'The most common failure messages on each channel, from the error logs. Every failed attempt is counted here, customers’ own bad requests included.'
        )}
      >
        {failing.length === 0 ? (
          <Breakdown
            items={[]}
            state={props.state}
            empty={t('No failed attempts in this range.')}
          />
        ) : (
          <div className='grid gap-4'>
            {failing.map((row) => (
              <div key={row.id} className='grid gap-1.5'>
                <p className='text-xs font-medium'>
                  {row.name}{' '}
                  <span className='text-muted-foreground font-normal'>
                    {t('{{count}} failed', { count: row.errors })}
                  </span>
                </p>
                <Breakdown
                  items={row.reasons}
                  empty={t('No failed attempts in this range.')}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title={t('Failover')}
        help={t(
          'Requests that failed on one channel and were served by another, read from the channels each request tried.'
        )}
      >
        <SimpleTable
          rows={props.data?.rescues ?? []}
          state={props.state}
          rowKey={(row) => `${row.from}:${row.to}`}
          empty={t('No request was moved to another channel in this range.')}
          columns={[
            {
              key: 'from',
              label: t('Failed on'),
              render: (row) => name(row.from),
            },
            { key: 'to', label: t('Served by'), render: (row) => name(row.to) },
            {
              key: 'count',
              label: t('Requests'),
              align: 'right',
              render: (row) => (
                <span className='tabular-nums'>{fmt.num(row.count)}</span>
              ),
            },
            {
              key: 'share',
              label: t('Of its failures'),
              hint: t(
                'These requests over the failed attempts on the channel they failed on: how much of its failures this route rescued.'
              ),
              align: 'right',
              render: (row) => {
                const failed = errors.get(row.from) ?? 0
                return (
                  <span className='tabular-nums'>
                    {failed > 0
                      ? fmt.pct(Math.min(1, row.count / failed))
                      : '—'}
                  </span>
                )
              },
            },
          ]}
        />
      </Panel>
    </div>
  )
}

function FeeEditor(props: { channels: UpstreamChannel[] }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const editable = props.channels.filter(
    (row) => row.cost_source !== 'upstream'
  )
  const [values, setValues] = useState<Record<number, string>>({})
  const valueOf = (row: UpstreamChannel) =>
    values[row.id] ?? (row.monthly_fee_usd ? String(row.monthly_fee_usd) : '')
  const save = useMutation({
    mutationFn: saveUpstreamFees,
    onSuccess: () => {
      toast.success(t('Upstream fees saved'))
      setValues({})
      void queryClient.invalidateQueries({
        queryKey: ['site-insights', 'upstream'],
      })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  })
  if (editable.length === 0) return null
  const parsed = editable.map((row) => [row.id, valueOf(row)] as const)
  const valid = parsed.every(
    ([, value]) =>
      value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0)
  )
  const submit = () => {
    const fees: Record<number, number> = {}
    for (const row of props.channels) {
      if (row.cost_source === 'upstream' && row.monthly_fee_usd) {
        fees[row.id] = row.monthly_fee_usd
      }
    }
    for (const [id, value] of parsed) {
      if (value !== '') fees[id] = Number(value)
    }
    save.mutate(fees)
  }
  return (
    <Panel
      title={t('Monthly fees')}
      help={t(
        'For a channel whose upstream bill cannot be read, such as a subscription account, enter what it costs a month. It is spread over the days of the range.'
      )}
    >
      <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
        {editable.map((row) => (
          <label key={row.id} className='grid gap-1 text-xs'>
            <span className='text-muted-foreground truncate'>{row.name}</span>
            <Input
              inputMode='decimal'
              placeholder={t('USD a month')}
              value={valueOf(row)}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [row.id]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
      <Button
        size='sm'
        className='mt-3'
        disabled={!valid || save.isPending}
        onClick={submit}
      >
        {t('Save')}
      </Button>
    </Panel>
  )
}

/**
 * The upstream channels compared: what each served and failed, how fast,
 * what it earned and what it cost, and where failed requests went.
 */
export function UpstreamTab(props: {
  data: UpstreamInsights | undefined
  previous?: UpstreamInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const definitions = useInsightsDefinitions()
  const help = useUpstreamHelp()
  const verdict = useUpstreamVerdict(props.data, props.previous, props.range)
  const totals = upstreamTotals(props.data)
  const before = props.previous ? upstreamTotals(props.previous) : undefined
  const stale = staleCosts(props.data, props.range?.end)
  const short = shortBills(props.data)
  const splits = splitsClientErrors(props.data)
  const viewError =
    props.sources?.view.status === 'error' && !props.data
      ? (props.sources.view.error ?? t('Could not be read'))
      : undefined
  const missing = viewError !== undefined
  const previousFailed = props.sources?.previous.status === 'error'
  const rows = (value: unknown) => tableState(props.sources?.view, value)
  const hoursInRange = props.range ? rangeHours(props.range) : 0
  const staleRevenue = stale.every((item) => item.revenue !== null)
    ? stale.reduce((sum, item) => sum + (item.revenue ?? 0), 0)
    : null
  const hourly = props.data?.hourly != null && (props.range?.hourly ?? true)
  let costHint: string | undefined
  if (stale.length > 0) {
    const readUpTo = fmt.time(
      Math.min(...stale.map((item) => item.channel.latest_cost_at))
    )
    costHint =
      staleRevenue === null
        ? t('Read up to {{time}}; later revenue has no cost yet', {
            time: readUpTo,
          })
        : t(
            'Read up to {{time}}; {{revenue}} of later revenue has no cost yet',
            {
              time: readUpTo,
              revenue: fmt.usd(staleRevenue),
            }
          )
  } else if (short.length > 0) {
    costHint = t('Partial: {{names}} read from some keys only', {
      names: short.map((row) => row.name).join(', '),
    })
  } else if (totals.uncostedRevenue > 0) {
    costHint = t('{{revenue}} of revenue has no known cost', {
      revenue: fmt.usd(totals.uncostedRevenue),
    })
  }
  let marginTone: Tone = 'default'
  if (totals.margin < 0) {
    marginTone = 'danger'
  } else if (stale.length > 0 || short.length > 0) {
    marginTone = 'warning'
  }
  let marginHint = fmt.pct(totals.marginRate)
  if (stale.length > 0) {
    marginHint = t('{{rate}}, overstated: recent revenue has no cost yet', {
      rate: fmt.pct(totals.marginRate),
    })
  } else if (short.length > 0) {
    marginHint = t('{{rate}}, overstated: part of a bill is not read', {
      rate: fmt.pct(totals.marginRate),
    })
  }
  return (
    <div className='grid gap-4'>
      {viewError ? (
        <Verdict tone='danger' text={viewError} />
      ) : (
        <Verdict
          loading={!props.data}
          tone={verdict?.tone ?? 'default'}
          text={verdict?.text}
        />
      )}
      <TruncatedNotice show={props.data?.truncated ?? false} />
      <StaleNote
        staleHours={props.data?.stale_hours}
        rangeHours={hoursInRange}
      />
      {previousFailed && props.data && (
        <SampleNote>
          {t(
            'The previous period could not be read, so nothing is compared with it.'
          )}
        </SampleNote>
      )}
      <MetricGrid
        loading={!props.data && !missing}
        items={[
          {
            label: t('Attempts'),
            value: fmt.num(totals.attempts),
            missing,
            hint: t('{{count}} served', { count: totals.requests }),
            help: definitions.attempts,
            delta: {
              current: totals.attempts,
              previous: before?.attempts,
              better: 'neutral',
            },
          },
          {
            label: t('Failure rate'),
            value: fmt.pct(totals.failureRate),
            missing,
            hint:
              totals.clientErrors > 0
                ? t('{{count}} client errors left out', {
                    count: fmt.num(totals.clientErrors),
                  })
                : undefined,
            help: joinSentences(
              t('Failed attempts over all attempts, across channels.'),
              definitions.attempts,
              splits && help.clientLeftOut
            ),
            tone: rateTone(totals, totals.failureRate),
            delta: {
              current: totals.failureRate,
              previous:
                before && before.attempts >= SMALL_SAMPLE
                  ? before.failureRate
                  : undefined,
              better: 'down',
              points: true,
            },
          },
          {
            label: t('Rescued'),
            value: fmt.num(totals.rescued),
            missing,
            help: t('Requests served after failing on another channel.'),
            delta: {
              current: totals.rescued,
              previous: before?.rescued,
              better: 'neutral',
            },
          },
          {
            label: t('Failures customers saw'),
            value: `≈ ${fmt.num(totals.unrescued)}`,
            missing,
            help: t(
              'Failed attempts less the requests another channel then served. Attempt based: retries on the same channel count each time, so it can run high.'
            ),
            delta: {
              current: totals.unrescued,
              previous: before?.unrescued,
              better: 'down',
            },
          },
          {
            label: t('Revenue'),
            value: fmt.usd(totals.revenue),
            missing,
            help: joinSentences(
              t(
                'What customers were charged for the requests the channels served; root and staff are left out.'
              ),
              help.units
            ),
            delta: {
              current: totals.revenue,
              previous: before?.revenue,
              better: 'up',
            },
          },
          {
            label: t('Cost'),
            value: fmt.usd(totals.cost),
            missing,
            hint: costHint,
            help: help.costUnits,
            tone: stale.length > 0 || short.length > 0 ? 'warning' : 'default',
            delta: {
              current: totals.cost,
              previous: before?.cost,
              better: 'down',
            },
          },
          {
            label: t('Gross margin'),
            value: fmt.usd(totals.margin),
            missing,
            hint: marginHint,
            help: joinSentences(
              t('Revenue less cost over the channels whose cost is known.'),
              help.units
            ),
            tone: marginTone,
            delta: {
              current: totals.margin,
              previous: before?.margin,
              better: 'up',
            },
          },
        ]}
      />
      <Panel
        title={t('Channels')}
        error={viewError}
        help={t(
          'Every enabled channel, every automatically disabled one, and any other with traffic or tasks in the range, busiest first.'
        )}
      >
        <ChannelTable
          data={props.data}
          previous={props.previous}
          range={props.range}
          state={rows(props.data?.channels)}
        />
      </Panel>
      <UpstreamChanges data={props.data} previous={props.previous} />
      {hourly && <UpstreamIncidents data={props.data} range={props.range} />}
      {hourly ? (
        <UpstreamHourlyCharts data={props.data} range={props.range} />
      ) : (
        <DailyCharts data={props.data} />
      )}
      <UpstreamTasks data={props.data} />
      <UpstreamRunRate data={props.data} range={props.range} />
      <ModelComparison data={props.data} state={rows(props.data?.models)} />
      <FailurePanels data={props.data} state={rows(props.data?.channels)} />
      <FeeEditor channels={props.data?.channels ?? []} />
    </div>
  )
}
