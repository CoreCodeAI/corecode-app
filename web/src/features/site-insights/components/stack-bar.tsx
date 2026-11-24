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
import { cn } from '@/lib/utils'

import { useInsightsFormat } from '../lib'

export type StackSegment = {
  key: string
  label: string
  value: number
  /** A CSS color for the fill; className sets one with Tailwind instead. */
  color?: string
  className?: string
}

/**
 * One whole as a horizontal bar of parts, each as wide as its share, with a
 * legend of each part's name, figure and share under it. A part with no value
 * draws nothing and is left out of the legend. Without a total the bar is an
 * empty track and the legend says nothing.
 */
export function StackBar(props: {
  segments: StackSegment[]
  ariaLabel: string
  format?: (value: number) => string
  /** The bar's height class; a thin one reads as a row in a list. */
  barClassName?: string
  /** Leaves the legend out, where the caller names the parts itself. */
  bare?: boolean
}) {
  const fmt = useInsightsFormat()
  const format = props.format ?? fmt.num
  const parts = props.segments.filter((segment) => segment.value > 0)
  const total = parts.reduce((sum, segment) => sum + segment.value, 0)
  return (
    <div className='grid gap-1.5'>
      <div
        role='img'
        aria-label={props.ariaLabel}
        className={cn(
          'bg-muted flex h-2.5 w-full gap-px overflow-hidden rounded-full',
          props.barClassName
        )}
      >
        {parts.map((segment) => (
          <span
            key={segment.key}
            title={`${segment.label}: ${format(segment.value)} (${fmt.pct(segment.value / total)})`}
            className={cn('h-full min-w-0.5', segment.className)}
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
      </div>
      {!props.bare && parts.length > 0 && (
        <ul className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
          {parts.map((segment) => (
            <li key={segment.key} className='flex items-center gap-1.5'>
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-sm', segment.className)}
                style={{ backgroundColor: segment.color }}
              />
              <span className='text-foreground'>{segment.label}</span>
              <span className='tabular-nums'>
                {format(segment.value)} · {fmt.pct(segment.value / total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A thin bar beside a figure: how far the value reaches toward `max`, which
 * the bar's end stands for. A value past max fills it; nothing draws none.
 */
export function MiniBar(props: {
  value: number
  max: number
  className?: string
}) {
  const share =
    props.max > 0 ? Math.min(1, Math.max(0, props.value / props.max)) : 0
  return (
    <span
      aria-hidden
      className='bg-muted inline-block h-1.5 w-10 shrink-0 overflow-hidden rounded-full align-middle'
    >
      <span
        className={cn('block h-full rounded-full', props.className)}
        style={{ width: `${share * 100}%` }}
      />
    </span>
  )
}
