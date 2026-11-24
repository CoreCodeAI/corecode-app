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

import type { ViewState } from '../growth-analysis'
import {
  bestWeekOne,
  weekRetentionRows,
  type WeekRetentionRow,
  type WeekSegmentKey,
} from '../growth-weeks'
import { MIN_COHORT, useInsightsFormat } from '../lib'
import type { RetentionWeek } from '../types'
import { Panel, ProviderSwitch } from './shared'

/**
 * Retention by sign-up week as a heat table: one row per Monday-to-Sunday
 * week of sign-ups, one column per week after it, each cell the share of the
 * week's sign-ups that used quota that week. The same sign-ups as the daily
 * table, pooled by week, with the activated and paying parts to pick from.
 */
export function WeeklyRetentionPanel(props: {
  weeks: RetentionWeek[] | null | undefined
  state: ViewState
  error?: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [picked, setPicked] = useState<WeekSegmentKey>('all')
  const weeks = props.weeks ?? []
  const withSegments = weeks.every((week) => week.activated && week.paid)
  const segment: WeekSegmentKey = withSegments ? picked : 'all'
  const rows = weekRetentionRows(weeks, segment)
  const best = bestWeekOne(rows, MIN_COHORT)
  const segmentLabel = {
    all: t('All sign-ups'),
    activated: t('Activated'),
    paid: t('Paid sign-ups'),
  }
  const weekLabel = (row: WeekRetentionRow) => {
    const text = t('Week of {{day}}', { day: fmt.day(row.week) })
    return row.partial ? t('{{label}}, partial week', { label: text }) : text
  }
  // A server that does not send the weeks leaves the panel out.
  if (props.weeks == null && props.state === 'ready') return null
  return (
    <Panel
      title={t('Retention by sign-up week')}
      error={props.error}
      help={t(
        'Share of each week’s sign-ups that used quota in that week and in each later one: a request of theirs came back with usage (tokens or a charge). Week 0 is the sign-up week itself. A user counts once a week however many days they were active. All sign-ups counts every sign-up; Activated counts those who made a request; Paid counts those with a paid order, as of now. A week under {{floor}} sign-ups is drawn muted; a faded cell is the current week, still in progress; a week the range began inside is partial.',
        { floor: MIN_COHORT }
      )}
      description={
        best
          ? t(
              '{{label}} kept the most ({{segment}}): {{share}} used quota the week after.',
              {
                label: weekLabel(best.row),
                share: fmt.pct(best.rate),
                segment: segmentLabel[segment],
              }
            )
          : undefined
      }
      actions={
        withSegments && weeks.length > 0 ? (
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
      {props.state === 'error' ? null : (
        <WeekGrid rows={rows} state={props.state} weekLabel={weekLabel} />
      )}
    </Panel>
  )
}

function WeekGrid(props: {
  rows: WeekRetentionRow[]
  state: ViewState
  weekLabel: (row: WeekRetentionRow) => string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
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
  const width = Math.max(...props.rows.map((row) => row.cells.length))
  return (
    <TooltipProvider delay={0}>
      <div className='-mx-4 overflow-x-auto px-4'>
        <table className='text-xs tabular-nums'>
          <thead>
            <tr className='text-muted-foreground'>
              <th className='pr-3 text-left font-normal'>{t('Sign-up week')}</th>
              <th className='pr-3 text-right font-normal'>{t('Users')}</th>
              {Array.from({ length: width }, (_, week) => (
                <th key={week} className='w-11 text-center font-normal'>
                  W{week}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.week}>
                <td className='pr-3 whitespace-nowrap'>{props.weekLabel(row)}</td>
                <td className='pr-3 text-right'>{fmt.num(row.size)}</td>
                {Array.from({ length: width }, (_, index) => {
                  const cell = row.cells[index]
                  if (!cell) return <td key={index} className='p-0.5' />
                  const muted = row.size < MIN_COHORT
                  const reading = t(
                    '{{week}}: {{active}} of {{size}} sign-ups used quota in week {{n}} ({{share}})',
                    {
                      active: fmt.num(cell.count),
                      size: fmt.num(row.size),
                      week: props.weekLabel(row),
                      n: index,
                      share: fmt.pct(cell.rate),
                    }
                  )
                  return (
                    <td key={index} className='p-0.5'>
                      <TapTooltip>
                        <TapTooltipTrigger
                          render={
                            <span
                              tabIndex={0}
                              className={cn(
                                'hover:ring-foreground/30 focus-visible:ring-ring/50 block cursor-default rounded px-1 py-0.5 text-center outline-none hover:ring-1 focus-visible:ring-2',
                                muted && 'text-muted-foreground',
                                !muted &&
                                  cell.rate > 0.5 &&
                                  'text-primary-foreground',
                                cell.live && 'opacity-50'
                              )}
                              style={
                                muted
                                  ? undefined
                                  : {
                                      backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(cell.rate * 100)}%, transparent)`,
                                    }
                              }
                            />
                          }
                        >
                          {Math.round(cell.rate * 100)}
                        </TapTooltipTrigger>
                        <TooltipContent>
                          {cell.live
                            ? t('{{reading}}; the week is still in progress.', {
                                reading,
                              })
                            : reading}
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
