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

import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { beforeLogs } from '../analysis'
import { dayInProgress, type ViewState } from '../growth-analysis'
import { type InsightsRangeInfo, MIN_COHORT, useInsightsFormat } from '../lib'
import {
  bestRetentionD7,
  retentionFloorBelow,
  retentionHasSegments,
  retentionIsWeekly,
  retentionRows,
  type RetentionCohort,
  type RetentionRow,
  type RetentionSegmentKey,
} from '../retention-cohorts'
import { RetentionNeedsRange } from './activity-insights'
import { Panel, ProviderSwitch } from './shared'

const DAY = 86400

/**
 * Retention by sign-up day, for the sign-ups the reader picks: every sign-up,
 * the ones who made a request, or the ones who paid. Each cell is the share
 * active that many days after sign-up, with the count on hover. A cohort under
 * MIN_COHORT sign-ups is drawn muted. A range longer than two weeks groups its
 * sign-up days by week.
 */
export function RetentionPanel(props: {
  cohorts: RetentionCohort[] | undefined
  state: ViewState
  error?: string
  range?: InsightsRangeInfo
  /** The range's end, unix seconds: a day that had not ended by it is in progress. */
  end?: number
  /** Where the logs begin: a day before them has no activity to read. */
  logsSince?: number | null
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [picked, setPicked] = useState<RetentionSegmentKey>('all')
  const cohorts = props.cohorts ?? []
  const withSegments = retentionHasSegments(cohorts)
  const segment: RetentionSegmentKey = withSegments ? picked : 'all'
  const rows = retentionRows(cohorts, segment, retentionIsWeekly(props.range))
  const best = bestRetentionD7(rows)
  const segmentLabel = {
    all: t('All sign-ups'),
    activated: t('Activated'),
    paid: t('Paid sign-ups'),
  }
  const rowLabel = (row: RetentionRow) => {
    const dates =
      row.days === 1
        ? fmt.day(row.start)
        : `${fmt.day(row.start)} – ${fmt.day(row.last)}`
    return row.partial ? t('{{dates}}, partial week', { dates }) : dates
  }
  const description = best
    ? t(
        '{{label}} has the best D7 among {{segment}}: {{share}} of its sign-ups were active seven days later.',
        {
          label: rowLabel(best.row),
          segment: segmentLabel[segment],
          share: fmt.pct(best.rate),
        }
      )
    : undefined
  return (
    <Panel
      title={t('Retention by sign-up day')}
      help={t(
        'Share of the sign-ups active N days later: a request of theirs came back with usage (tokens or a charge). Day 0 is the sign-up day. All sign-ups counts every sign-up; Activated counts those who made a request, as the funnel does; Paid counts those with a paid order, as of now. A cohort under {{floor}} sign-ups is drawn muted. A range longer than two weeks groups the sign-up days by week, and a week with fewer than seven days is partial. A faded cell is a day still in progress.',
        { floor: MIN_COHORT }
      )}
      error={props.error}
      description={description}
      actions={
        withSegments ? (
          <ProviderSwitch
            ariaLabel={t('Which sign-ups to count')}
            value={segment}
            onChange={setPicked}
            items={[
              { key: 'all', label: segmentLabel.all },
              { key: 'activated', label: segmentLabel.activated },
              { key: 'paid', label: segmentLabel.paid },
            ]}
          />
        ) : undefined
      }
    >
      {props.range?.hourly && <RetentionNeedsRange />}
      {!props.range?.hourly && props.state !== 'error' && (
        <RetentionGrid
          rows={rows}
          state={props.state}
          end={props.end}
          logsSince={props.logsSince}
          rowLabel={rowLabel}
          hasCounts={rows.every((row) => row.counts !== null)}
        />
      )}
    </Panel>
  )
}

function RetentionGrid(props: {
  rows: RetentionRow[]
  state: ViewState
  end?: number
  logsSince?: number | null
  rowLabel: (row: RetentionRow) => string
  hasCounts: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const end = props.end
  const logsSince = props.logsSince
  if (props.state === 'loading') {
    return (
      <div role='status' aria-label={t('Loading...')} className='grid gap-2'>
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-full' />
      </div>
    )
  }
  if (props.rows.length === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('No sign-ups in this range')}
      </p>
    )
  }
  const width = Math.max(...props.rows.map((row) => row.rates.length))
  // The tooltip of a cell: its share, with the count when the server sends it.
  const cellText = (
    reading: {
      share: string
      size: string
      active: string
      day: string
      n: number
    },
    partial: boolean
  ) => {
    if (props.hasCounts) {
      if (partial) {
        return t(
          '{{active}} of the {{size}} users who signed up {{day}} were active on D{{n}} ({{share}}) so far; the day is still in progress.',
          reading
        )
      }
      return t(
        '{{active}} of the {{size}} users who signed up {{day}} were active on D{{n}} ({{share}})',
        reading
      )
    }
    if (partial) {
      return t(
        '{{share}} of the {{size}} users who signed up {{day}} were active on D{{n}} so far; the day is still in progress.',
        reading
      )
    }
    return t(
      '{{share}} of the {{size}} users who signed up {{day}} were active on D{{n}}',
      reading
    )
  }
  return (
    <TooltipProvider delay={0}>
      <div className='-mx-4 overflow-x-auto px-4'>
        <table className='text-xs tabular-nums'>
          <thead>
            <tr className='text-muted-foreground'>
              <th className='pr-3 text-left font-normal'>{t('Sign-up day')}</th>
              <th className='pr-3 text-right font-normal'>{t('Users')}</th>
              {Array.from({ length: width }, (_, day) => (
                <th key={day} className='w-11 text-center font-normal'>
                  D{day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.start}>
                <td className='pr-3 whitespace-nowrap'>
                  {props.rowLabel(row)}
                </td>
                <td className='pr-3 text-right'>{row.size}</td>
                {Array.from({ length: width }, (_, day) => {
                  const value = row.rates[day]
                  const lastDay = row.last + day * DAY
                  if (beforeLogs(row.start + day * DAY, DAY, logsSince)) {
                    return (
                      <td
                        key={day}
                        className='text-muted-foreground p-0.5 text-center'
                      >
                        -
                      </td>
                    )
                  }
                  if (value == null) return <td key={day} className='p-0.5' />
                  const partial = end != null && dayInProgress(lastDay, end)
                  const muted = retentionFloorBelow(row)
                  const count = row.counts?.[day]
                  const reading = {
                    share: fmt.pct(value),
                    size: fmt.num(row.size),
                    active: fmt.num(count ?? 0),
                    day: props.rowLabel(row),
                    n: day,
                  }
                  return (
                    <td key={day} className='p-0.5'>
                      <TapTooltip>
                        <TapTooltipTrigger
                          render={
                            <span
                              tabIndex={0}
                              className={cn(
                                'hover:ring-foreground/30 focus-visible:ring-ring/50 block cursor-default rounded px-1 py-0.5 text-center outline-none hover:ring-1 focus-visible:ring-2',
                                muted && 'text-muted-foreground',
                                !muted &&
                                  value > 0.5 &&
                                  'text-primary-foreground',
                                partial && 'opacity-50'
                              )}
                              style={
                                muted
                                  ? undefined
                                  : {
                                      backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(value * 100)}%, transparent)`,
                                    }
                              }
                            />
                          }
                        >
                          {Math.round(value * 100)}
                        </TapTooltipTrigger>
                        <TooltipContent>
                          {cellText(reading, partial)}
                        </TooltipContent>
                      </TapTooltip>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  )
}
