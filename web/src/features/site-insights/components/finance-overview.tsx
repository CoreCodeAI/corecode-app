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
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import { getUserSpend } from '../api'
import { bucketBeforeLogs, spendConcentration } from '../finance-analysis'
import {
  joinSentences,
  useChargeFormat,
  useHourAxis,
  useInsightsDefinitions,
  useInsightsFormat,
  type InsightsRangeInfo,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type { FinanceHour, FinanceInsights, UserSpendHours } from '../types'
import { REVEAL_EVENT } from './sections'
import { Panel, BarSeries } from './shared'

/**
 * What customers consumed beside the revenue earned: each day's revenue
 * earned and consumption at list price, side by side; by the hour only the
 * consumption, which is all the hours carry.
 */
export function FinanceFlowPanel(props: {
  data: FinanceInsights | undefined
  range: InsightsRangeInfo
  hours: FinanceHour[] | null
  error?: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const defs = useInsightsDefinitions()
  const hourAxis = useHourAxis()
  const partialDay = usePartialDays('finance')
  const logsSince = props.data?.logs_since
  const daily = props.data?.daily ?? []
  const hours = props.hours
  return (
    <Panel
      title={
        hours ? t('Hourly consumption') : t('Revenue earned and consumption')
      }
      error={props.error}
      help={joinSentences(
        hours
          ? t(
              'Each hour’s consumption at list price, root and staff’s internal use included, in yuan.'
            )
          : t(
              'Each day’s revenue earned beside consumption at list price, root and staff’s internal use included, in yuan.'
            ),
        defs.earnedRevenue
      )}
    >
      {!props.error && hours && (
        <BarSeries
          ariaLabel={t('Hourly consumption')}
          series={[
            {
              label: t('Consumed at list price'),
              format: fmt.cny,
              compact: fmt.cnyCompact,
            },
          ]}
          points={hourAxis.bars(
            hours,
            props.range.end,
            (hour) => ({
              values: [hour.consumption_usd + hour.root_consumption_usd],
            }),
            logsSince
          )}
        />
      )}
      {!props.error && !hours && (
        <BarSeries
          grouped
          ariaLabel={t('Revenue earned and consumption')}
          series={[
            {
              label: t('Revenue earned'),
              format: fmt.cny,
              compact: fmt.cnyCompact,
            },
            { label: t('Consumed at list price'), format: fmt.cny },
          ]}
          points={daily.map((day) => {
            const values = [
              day.recognized_revenue ?? 0,
              day.consumption_usd + (day.root_consumption_usd ?? 0),
            ]
            return {
              key: day.day,
              title: fmt.day(day.day),
              values,
              partial: partialDay(day.day, values),
              missing: bucketBeforeLogs(day.day, 'day', logsSince),
            }
          })}
        />
      )}
    </Panel>
  )
}

const CONCENTRATION_WINDOWS: UserSpendHours[] = [24, 168]

/**
 * How much of the customers' consumption the biggest five, ten and twenty
 * took, over the last day or week: the same read the consumption table
 * below takes.
 */
export function CustomerConcentrationPanel() {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [hours, setHours] = useState<UserSpendHours>(24)
  const query = useQuery({
    queryKey: ['site-insights', 'user-spend', hours],
    queryFn: () => getUserSpend(hours),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const charge = useChargeFormat(data)
  const rows = data ? spendConcentration(data.users, data.quota_usd) : null
  const windowLabels: Partial<Record<UserSpendHours, string>> = {
    24: t('24 hours'),
    168: t('{{count}} days', { count: 7 }),
  }
  let body: ReactNode
  if (query.isError && !data) {
    body = (
      <p className='text-destructive text-sm'>
        {query.error instanceof Error
          ? query.error.message
          : t('Failed to load site insights')}
      </p>
    )
  } else if (!data) {
    body = <p className='text-muted-foreground text-sm'>{t('Loading')}</p>
  } else if (!rows) {
    body = (
      <p className='text-muted-foreground text-sm'>
        {t('No customer consumed anything in this window')}
      </p>
    )
  } else {
    body = (
      <ul
        role='list'
        aria-label={t('Share of customer consumption')}
        className='grid gap-3'
      >
        {rows.map((row) => (
          <li key={row.top} className='grid gap-1'>
            <div className='flex items-baseline justify-between gap-2 text-sm'>
              <span className='font-medium'>
                {t('Top {{count}} customers', { count: row.top })}
              </span>
              <span className='text-muted-foreground tabular-nums'>
                <span className='text-foreground font-semibold'>
                  {fmt.pct(row.share)}
                </span>{' '}
                · {charge.usd(row.amount)}
              </span>
            </div>
            <div
              className='bg-muted h-2 overflow-hidden rounded-full'
              role='img'
              aria-label={`${t('Top {{count}} customers', { count: row.top })}: ${fmt.pct(row.share)}`}
            >
              <div
                className='bg-primary/70 h-full rounded-full'
                style={{ width: `${row.share * 100}%` }}
              />
            </div>
          </li>
        ))}
        <li className='text-muted-foreground text-xs'>
          {t('{{count}} customers consumed in this window, {{total}} in all.', {
            count: fmt.num(data.customers),
            total: charge.usd(data.quota_usd),
          })}
        </li>
      </ul>
    )
  }
  return (
    <Panel
      title={t('Customer concentration')}
      help={t(
        'The share of what customers consumed in the window, at new-api’s charge, that the biggest five, ten and twenty took. Root’s and staff’s own use is not counted.'
      )}
    >
      <div className='grid gap-3'>
        <ToggleGroup
          variant='outline'
          size='sm'
          aria-label={t('Window')}
          className='w-fit'
          value={[String(hours)]}
          onValueChange={(value: string[]) => {
            const next = Number(value.at(-1)) as UserSpendHours
            if (CONCENTRATION_WINDOWS.includes(next)) setHours(next)
          }}
        >
          {CONCENTRATION_WINDOWS.map((window) => (
            <ToggleGroupItem key={window} value={String(window)}>
              {windowLabels[window]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {body}
      </div>
    </Panel>
  )
}

/**
 * Panels a reader seldom needs, folded under one bar so the charts come
 * first. The panels stay in the page, hidden, so the section menu still
 * lists them; revealPanel opens the group before scrolling to one.
 */
export function DetailsGroup(props: {
  title: string
  hint: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const reveal = () => flushSync(() => setOpen(true))
    node.addEventListener(REVEAL_EVENT, reveal)
    return () => node.removeEventListener(REVEAL_EVENT, reveal)
  }, [])
  return (
    <div ref={ref} data-details-group className='grid gap-4'>
      <Button
        variant='outline'
        className='h-10 w-full justify-between sm:h-9'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          {props.title}
          <span className='text-muted-foreground ml-2 text-xs font-normal'>
            {props.hint}
          </span>
        </span>
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
      </Button>
      <div hidden={!open} className={cn('grid gap-4', !open && 'hidden')}>
        {props.children}
      </div>
    </div>
  )
}
