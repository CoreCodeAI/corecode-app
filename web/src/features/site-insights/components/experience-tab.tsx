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

import {
  tableState,
  useHourAxis,
  useInsightsFormat,
  type InsightsRangeInfo,
  type InsightsSources,
  type InsightsTab,
} from '../lib'
import { previousDayPartial, usePartialDays } from '../partial-days'
import type { ExperienceInsights, ExperiencePoint } from '../types'
import {
  useCategoryLabel,
  useExperienceVerdict,
  useWaitFormat,
  useWasteKindLabel,
} from '../verdicts/experience'
import {
  beforeWasteLogs,
  cacheUnreadBefore,
  kindRequests,
  pointWaste,
  replyComparable,
  unheard,
  unreadFrom,
  wasteComparable,
  wasteShare,
  WASTE_KINDS,
} from './experience-analysis'
import {
  FeedbackRetention,
  FeedbackStatus,
  LapsedSenders,
  WaitingReports,
} from './experience-feedback'
import {
  RefundsPanel,
  RefusalDetails,
  WasteKinds,
  WasteUsers,
} from './experience-waste'
import {
  BarSeries,
  MetricGrid,
  Panel,
  Verdict,
  type BarPoint,
  type MetricItem,
} from './shared'

const REPORT_CATEGORIES = ['bug', 'suggestion', 'billing', 'other'] as const

function reportValues(point: ExperiencePoint): number[] {
  return [point.bug, point.suggestion, point.billing, point.other_feedback]
}

export function ExperienceTab(props: {
  data: ExperienceInsights | undefined
  previous?: ExperienceInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const wait = useWaitFormat()
  const hourAxis = useHourAxis()
  const partialDay = usePartialDays('experience')
  const kindLabel = useWasteKindLabel()
  const categoryLabel = useCategoryLabel()
  const verdict = useExperienceVerdict(props.data, props.range)
  const data = props.data
  const previous = props.previous
  const waste = data?.waste
  const feedback = data?.feedback
  const viewSource = props.sources?.view
  // With no data, a failed view shows - on every card; a pending one, skeletons.
  const failed = !data && viewSource?.status === 'error'
  const listState = tableState(viewSource, data)
  const daily = data?.series_unit === 'day'
  const end = props.range?.end ?? Number.POSITIVE_INFINITY
  const series = data?.series ?? []
  const comparable = !!data && wasteComparable(data, previous, props.range)
  const unread = waste ? unreadFrom(waste, props.range) : null
  const cacheLater = waste ? cacheUnreadBefore(waste) : null
  const share = waste ? wasteShare(waste) : null
  const refusals = waste ? kindRequests(waste, 'refusal') : 0
  const unitSeconds = daily ? 86400 : 3600
  const pointTitle = (at: number) => (daily ? fmt.day(at) : fmt.time(at))

  // A chart's points: a day by its start, an hour by the hourly axis; a
  // period before the logs the view reads is missing, not zero.
  const barPoints = (
    values: (point: ExperiencePoint) => number[],
    reaches: boolean
  ): BarPoint[] => {
    if (!daily) {
      return hourAxis.bars(
        series.map((point) => ({ hour: point.at, point })),
        end,
        (row) => ({ values: values(row.point) }),
        reaches && waste ? waste.log_start : undefined
      )
    }
    return series.map((point) => ({
      key: point.at,
      title: pointTitle(point.at),
      values: values(point),
      faded: point.at + unitSeconds > end,
      missing:
        reaches && waste
          ? beforeWasteLogs(point.at, unitSeconds, waste)
          : false,
      partial: partialDay(point.at),
    }))
  }
  const wastePoints = barPoints(
    (point) => [
      point.refusal_usd,
      point.failed_usd,
      point.gate_usd,
      point.cache_usd,
    ],
    true
  )
  const reportPoints = barPoints(reportValues, false)

  const notes: string[] = []
  if (unread != null) {
    notes.push(
      t(
        'Waste is stored by the hour and the stored hours begin at {{time}}, so it is counted only from then.',
        {
          time: fmt.time(unread),
        }
      )
    )
  }
  if (cacheLater != null) {
    notes.push(
      t('The one-hour cache estimate reads only from {{time}}.', {
        time: fmt.time(cacheLater),
      })
    )
  }
  if (waste?.truncated) {
    notes.push(
      t(
        'This range has more logs than one read takes, so waste is a lower bound.'
      )
    )
  }
  if (waste && waste.unpriced > 0) {
    notes.push(
      t(
        '{{count}} one-hour cache writes lacked the prices to be valued and are left out.',
        {
          count: fmt.num(waste.unpriced),
        }
      )
    )
  }

  const items: MetricItem[] = [
    {
      label: t('Money wasted'),
      featured: true,
      value: fmt.usd(waste?.total_usd ?? 0),
      missing: failed,
      tone: share != null && share >= 0.01 ? 'warning' : undefined,
      hint:
        share != null
          ? t('{{share}} of what customers consumed', { share: fmt.pct(share) })
          : undefined,
      help: t(
        'Refused, failed and wallet-charged requests, plus one-hour cache writes nothing read, in quota dollars. Staff are left out.'
      ),
      delta: comparable
        ? {
            current: waste?.total_usd ?? 0,
            previous: previous?.waste.total_usd,
            better: 'down',
          }
        : undefined,
      trend: series.map((point, index) => ({
        title: pointTitle(point.at),
        value: pointWaste(point),
        missing: waste ? beforeWasteLogs(point.at, unitSeconds, waste) : false,
        partial: daily ? partialDay(point.at) : undefined,
        previous: comparable
          ? previous?.series[index] && pointWaste(previous.series[index])
          : undefined,
        previousPartial:
          daily && previousDayPartial(index, previous?.series.length ?? 0),
      })),
      trendFormat: fmt.usd,
      trendBars: true,
    },
    {
      label: t('Refusals charged'),
      value: fmt.num(refusals),
      missing: failed,
      tone: refusals > 0 ? 'warning' : undefined,
      hint:
        waste && refusals > 0
          ? t('{{amount}} charged', {
              amount: fmt.usd(
                waste.kinds.find((kind) => kind.kind === 'refusal')?.usd ?? 0
              ),
            })
          : undefined,
      help: t(
        'Requests the model refused on usage-policy grounds that were still billed.'
      ),
      delta:
        comparable && previous
          ? {
              current: refusals,
              previous: kindRequests(previous.waste, 'refusal'),
              better: 'down',
            }
          : undefined,
    },
    {
      label: t('Refunded'),
      value: fmt.usd(waste?.refunds.usd ?? 0),
      missing: failed,
      hint: waste
        ? t('{{count}} failed tasks', {
            count: fmt.num(waste.refunds.requests),
          })
        : undefined,
      help: t(
        'Image and video tasks that failed and were paid back in full. Not part of the money wasted.'
      ),
    },
    {
      label: t('Reports'),
      value: fmt.num(feedback?.total ?? 0),
      missing: failed,
      delta: previous
        ? {
            current: feedback?.total ?? 0,
            previous: previous.feedback.total,
            better: 'neutral',
          }
        : undefined,
      hint:
        waste && unheard(waste) > 0
          ? t('{{count}} of the biggest losers never wrote', {
              count: fmt.num(unheard(waste)),
            })
          : undefined,
    },
    {
      label: t('First reply, median'),
      value:
        feedback && feedback.replied > 0 ? wait(feedback.first_reply_p50) : '-',
      missing: failed,
      hint:
        feedback && feedback.replied > 0
          ? t('slowest tenth {{time}}', {
              time: wait(feedback.first_reply_p90),
            })
          : undefined,
      help: t(
        'Time from a report to the first change an administrator made to it, over the reports of the range that have one.'
      ),
      delta:
        feedback && previous && replyComparable(feedback, previous.feedback)
          ? {
              current: feedback.first_reply_p50,
              previous: previous.feedback.first_reply_p50,
              better: 'down',
            }
          : undefined,
    },
    {
      label: t('Open reports'),
      value: fmt.num(feedback?.open ?? 0),
      missing: failed,
      tone: (feedback?.unanswered_24h ?? 0) > 0 ? 'warning' : undefined,
      hint:
        feedback && feedback.unanswered_24h > 0
          ? t('{{count}} unanswered over 24 hours', {
              count: fmt.num(feedback.unanswered_24h),
            })
          : undefined,
      help: t(
        'Reports still pending or in progress at the end of the range, whenever they were filed.'
      ),
    },
  ]

  const wasteSeries = WASTE_KINDS.map((kind) => ({
    label: kindLabel(kind),
    format: fmt.usd,
    compact: fmt.usdCompact,
  }))
  const reportSeries = REPORT_CATEGORIES.map((category) => ({
    label: categoryLabel(category),
  }))

  return (
    <div className='grid gap-4'>
      <Verdict
        loading={!data && !failed}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
        points={verdict?.points}
        chips={verdict?.chips}
      />
      <MetricGrid loading={!data && !failed} items={items} />

      <Panel
        title={t('Money wasted over time')}
        description={t('Quota dollars by kind, per {{unit}}.', {
          unit: daily ? t('day') : t('hour'),
        })}
      >
        {failed ? (
          <p className='text-muted-foreground text-xs'>
            {t('Could not be read')}
          </p>
        ) : (
          <div className='grid gap-2'>
            <BarSeries
              ariaLabel={t('Money wasted over time')}
              series={wasteSeries}
              points={wastePoints}
            />
            {notes.map((note) => (
              <p key={note} className='text-muted-foreground text-xs'>
                {note}
              </p>
            ))}
          </div>
        )}
      </Panel>

      <div className='grid gap-4 lg:grid-cols-2'>
        <WasteKinds data={data} state={listState} />
        <RefundsPanel data={data} state={listState} />
      </div>

      <WasteUsers
        title={t('Customers who lost the most')}
        description={
          waste && waste.checked_top > 0
            ? t(
                '{{reported}} of the {{checked}} biggest losers filed a report.',
                {
                  reported: fmt.num(waste.reported_top),
                  checked: fmt.num(waste.checked_top),
                }
              )
            : undefined
        }
        help={t(
          'The twenty customers with the most wasted money over the range, by kind. Status says whether they ever filed a report and whether they sent any request in the last 3 days.'
        )}
        rows={waste?.top}
        state={listState}
        empty={t('No customer lost money in this range')}
      />

      <WasteUsers
        title={t('Lost money, never wrote, went silent')}
        description={t(
          'Among the fifty biggest losers: no report ever filed and no request in 3 days. The ones to write to first.'
        )}
        rows={waste?.silent}
        state={listState}
        empty={t('Every big loser either wrote in or is still sending')}
      />

      <Panel
        title={t('Reports over time')}
        description={t('New reports by category, per {{unit}}.', {
          unit: daily ? t('day') : t('hour'),
        })}
      >
        {failed ? (
          <p className='text-muted-foreground text-xs'>
            {t('Could not be read')}
          </p>
        ) : (
          <BarSeries
            ariaLabel={t('Reports over time')}
            series={reportSeries}
            points={reportPoints}
          />
        )}
      </Panel>

      <FeedbackStatus feedback={feedback} state={listState} />
      <FeedbackRetention feedback={feedback} state={listState} />

      <div className='grid gap-4 lg:grid-cols-2'>
        <WaitingReports data={data} end={end} state={listState} />
        <LapsedSenders rows={feedback?.lapsed} state={listState} />
      </div>

      <RefusalDetails data={data} state={listState} />
    </div>
  )
}
