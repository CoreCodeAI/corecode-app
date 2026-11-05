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

import { cn } from '@/lib/utils'

import { OTHER_COLOR, useInsightsFormat, type SeriesColor } from '../lib'

export type ShareSlice = {
  key: string
  label: string
  value: number
  color: SeriesColor
}

const RADIUS = 52
const WIDTH = 16
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
// The surface gap between neighbouring slices, along the ring.
const GAP = 2

/**
 * How one whole splits: a ring of at most `limit` slices in the order given,
 * the rest folded into one gray slice, and beside it each part's name, figure
 * and share. Hovering a slice or its row names it in the middle.
 */
export function ShareDonut(props: {
  slices: ShareSlice[]
  format: (value: number) => string
  ariaLabel: string
  totalLabel: string
  empty: string
  limit?: number
  loading?: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [active, setActive] = useState<string>()
  const limit = props.limit ?? 5
  const positive = props.slices.filter((slice) => slice.value > 0)
  let slices = positive
  if (positive.length > limit) {
    const kept = new Set(
      [...positive]
        .sort((a, b) => b.value - a.value)
        .slice(0, limit - 1)
        .map((slice) => slice.key)
    )
    const rest = positive.filter((slice) => !kept.has(slice.key))
    slices = [
      ...positive.filter((slice) => kept.has(slice.key)),
      {
        key: '__other',
        label: t('Other'),
        value: rest.reduce((sum, slice) => sum + slice.value, 0),
        color: OTHER_COLOR,
      },
    ]
  }
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)

  if (props.loading) {
    return (
      <div
        className='bg-muted animate-pulse rounded-md'
        style={{ height: 144 }}
      />
    )
  }
  if (total <= 0) {
    return <p className='text-muted-foreground text-sm'>{props.empty}</p>
  }

  const pct = (value: number) => fmt.pct(value / total)
  const shown = slices.find((slice) => slice.key === active)
  let offset = 0
  const arcs = slices.map((slice) => {
    const length = (slice.value / total) * CIRCUMFERENCE
    const arc = { slice, offset, length }
    offset += length
    return arc
  })

  return (
    <div className='flex flex-col items-center gap-4 sm:flex-row sm:items-center'>
      <div className='relative shrink-0' style={{ width: 144, height: 144 }}>
        <svg
          viewBox='0 0 140 140'
          role='img'
          aria-label={props.ariaLabel}
          className='size-full -rotate-90'
        >
          {arcs.map(({ slice, offset: start, length }) => (
            <circle
              key={slice.key}
              cx='70'
              cy='70'
              r={RADIUS}
              fill='none'
              strokeWidth={slice.key === active ? WIDTH + 4 : WIDTH}
              strokeDasharray={`${Math.max(length - (slices.length > 1 ? GAP : 0), 0.5)} ${CIRCUMFERENCE}`}
              strokeDashoffset={-start}
              style={{ stroke: slice.color }}
              className={cn(
                'cursor-default',
                active && slice.key !== active && 'opacity-40'
              )}
              onPointerEnter={() => setActive(slice.key)}
              onPointerLeave={() => setActive(undefined)}
            >
              <title>{`${slice.label}: ${props.format(slice.value)} (${pct(slice.value)})`}</title>
            </circle>
          ))}
        </svg>
        <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center'>
          <span className='text-muted-foreground max-w-full truncate text-[11px]'>
            {shown ? shown.label : props.totalLabel}
          </span>
          <span className='text-sm font-semibold tabular-nums'>
            {props.format(shown ? shown.value : total)}
          </span>
          {shown && (
            <span className='text-muted-foreground text-[11px] tabular-nums'>
              {pct(shown.value)}
            </span>
          )}
        </div>
      </div>
      <ul className='grid w-full min-w-0 gap-1 text-xs'>
        {slices.map((slice) => (
          <li
            key={slice.key}
            className={cn(
              'flex items-center gap-2 rounded px-1.5 py-1',
              slice.key === active && 'bg-muted'
            )}
            onPointerEnter={() => setActive(slice.key)}
            onPointerLeave={() => setActive(undefined)}
          >
            <span
              aria-hidden
              className='size-2.5 shrink-0 rounded-sm'
              style={{ backgroundColor: slice.color }}
            />
            <span className='min-w-0 flex-1 truncate' title={slice.label}>
              {slice.label}
            </span>
            <span className='tabular-nums'>{props.format(slice.value)}</span>
            <span className='text-muted-foreground w-12 text-right tabular-nums'>
              {pct(slice.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
