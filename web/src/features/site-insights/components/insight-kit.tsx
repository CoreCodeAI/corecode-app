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
import { Link } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { sortFindings, type Finding } from '../analysis'
import {
  rangeReachesBeforeLogs,
  TONES,
  useInsightsFormat,
  useTabLabel,
  type InsightsTab,
} from '../lib'
import type { PoolProvider } from '../types'
import type { Tone } from './shared'

export type { Finding, HourAxis, HourBar } from '../analysis'

const FINDING_ICONS = {
  danger: { icon: CircleAlert, className: 'text-destructive' },
  warning: {
    icon: TriangleAlert,
    className: 'text-amber-600 dark:text-amber-400',
  },
  default: { icon: Info, className: 'text-muted-foreground' },
  good: {
    icon: CircleCheck,
    className: 'text-emerald-600 dark:text-emerald-400',
  },
}

/**
 * A list of findings, worst and largest first, each with a button to the
 * tab that explains it. With nothing to list, the empty sentence, if any.
 */
export function Findings(props: {
  items: Finding[]
  empty?: string
  onOpen?: (tab: InsightsTab) => void
  tabLabel?: (tab: InsightsTab) => string
}) {
  const { t } = useTranslation()
  const defaultLabel = useTabLabel()
  const label = props.tabLabel ?? defaultLabel
  if (props.items.length === 0) {
    if (!props.empty) return null
    return (
      <p className='text-muted-foreground flex items-center gap-2 text-sm'>
        <CircleCheck className='size-4 text-emerald-600 dark:text-emerald-400' />
        {props.empty}
      </p>
    )
  }
  return (
    <ul className='-my-2 divide-y'>
      {sortFindings(props.items).map((finding) => {
        const icon = FINDING_ICONS[finding.tone]
        const Icon = icon.icon
        const tab = finding.tab
        let action: ReactNode = null
        if (tab && props.onOpen) {
          const open = props.onOpen
          action = (
            <Button
              variant='ghost'
              size='sm'
              className='shrink-0'
              onClick={() => open(tab)}
            >
              {label(tab)} →
            </Button>
          )
        } else if (finding.href) {
          action = (
            <Button
              variant='ghost'
              size='sm'
              className='shrink-0'
              render={<a href={finding.href} />}
            >
              {t('Open')} →
            </Button>
          )
        }
        return (
          <li key={finding.key} className='flex items-start gap-3 py-2.5'>
            <Icon className={cn('mt-0.5 size-4 shrink-0', icon.className)} />
            <div className='min-w-0 flex-1'>
              <p className='text-sm font-medium'>{finding.title}</p>
              {finding.detail && (
                <p className='text-muted-foreground text-xs break-words'>
                  {finding.detail}
                </p>
              )}
            </div>
            {action}
          </li>
        )
      })}
    </ul>
  )
}

/** One part that drove a change: its name, signed amount, and optional share of the change. */
export type DriverRow = {
  key: string
  label: string
  /** Pre-formatted and signed, such as +¥120. */
  change: string
  /** Pre-formatted, such as 62%. */
  share?: string
  /** The direction read as better (good) or worse (warning, danger). */
  tone?: Tone
}

/** What drove a change: each part's name on the left, its signed amount on the right. */
export function Drivers(props: {
  title?: string
  rows: DriverRow[]
  empty?: string
}) {
  if (props.rows.length === 0) {
    if (!props.empty) return null
    return <p className='text-muted-foreground text-xs'>{props.empty}</p>
  }
  return (
    <div className='grid gap-1'>
      {props.title && (
        <p className='text-muted-foreground text-xs'>{props.title}</p>
      )}
      <dl className='grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums'>
        {props.rows.map((row) => (
          <div key={row.key} className='contents'>
            <dt className='truncate' title={row.label}>
              {row.label}
            </dt>
            <dd className='text-right whitespace-nowrap'>
              <span className={TONES[row.tone ?? 'default']}>{row.change}</span>
              {row.share && (
                <span className='text-muted-foreground text-xs'>
                  {' '}
                  · {row.share}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Search fields a link to another tab may set; the rest are kept. */
export type InsightsSearch = {
  days?: number
  models?: string[]
  provider?: PoolProvider
  vendor?: PoolProvider
}

/** A text link to another tab of the page that keeps the current range and filters. */
export function TabLink(props: {
  tab: InsightsTab
  search?: InsightsSearch
  children: ReactNode
}) {
  return (
    <Link
      from='/site-insights/'
      to='/site-insights'
      search={(prev) => ({ ...prev, ...props.search, tab: props.tab })}
      className='text-primary font-medium hover:underline'
    >
      {props.children}
    </Link>
  )
}

/** A muted line for a figure that rests on too few events to judge. */
export function SampleNote(props: { children: ReactNode }) {
  return <p className='text-muted-foreground text-xs'>{props.children}</p>
}

/**
 * Says that part of the range is still counted the earlier way while the
 * rollup rebuilds it: staleHours of the range's hours (the view's
 * stale_hours). Nothing at 0 or without the field.
 */
export function StaleNote(props: {
  staleHours: number | null | undefined
  rangeHours: number
}) {
  const { t } = useTranslation()
  const stale = props.staleHours ?? 0
  if (stale <= 0) return null
  const total = Math.max(props.rangeHours, stale)
  return (
    <p className='text-muted-foreground text-xs'>
      {stale >= total
        ? t(
            'This range is still counted by the earlier definition and is being rebuilt; its figures may change.'
          )
        : t(
            '{{stale}} of the range’s {{total}} hours are still counted by the earlier definition and are being rebuilt; their figures may change.',
            { stale, total: Math.round(total) }
          )}
    </p>
  )
}

/**
 * Says where the logs begin, when the range reaches before them: an hour or
 * day before that has no data, not zero. Nothing when the range starts after
 * the logs, or the server has not said where they begin.
 */
export function LogsNote(props: {
  /** The earliest start of the ranges the page shows. */
  start: number
  logsSince: number | null | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  if (!rangeReachesBeforeLogs({ start: props.start }, props.logsSince)) {
    return null
  }
  return (
    <p className='text-muted-foreground text-xs'>
      {t('Logs start {{date}}; earlier hours have no data.', {
        date: fmt.day(props.logsSince ?? 0),
      })}
    </p>
  )
}
