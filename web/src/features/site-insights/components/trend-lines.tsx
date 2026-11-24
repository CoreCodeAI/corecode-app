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
import { useState, type KeyboardEvent, type PointerEvent } from 'react'

import { cn } from '@/lib/utils'

const WIDTH = 640
const HEIGHT = 210
const PAD = { left: 48, right: 12, top: 12, bottom: 26 }
const VALUE_TICKS = 2
const AXIS_LABELS = 5

export type TrendLine = {
  key: string
  label: string
  /** A CSS color for the stroke. */
  color: string
  /** Draws the whole line dashed, as a reference beside the others. */
  dashed?: boolean
  /** One value per position; null is a gap, which breaks the line. */
  values: (number | null)[]
  /** A figure for the line's legend entry, such as its rate over the range. */
  summary?: string
}

/**
 * Lines over a shared time axis: one value per line at each position, a gap
 * where a line has none. Hovering or focusing the chart reads out every line
 * at the nearest position; the arrow keys move it. A position marked partial
 * (a day the range covers in part) draws the segments that touch it dashed.
 */
export function TrendLines(props: {
  ariaLabel: string
  /** The title of each position, atop its readout. */
  titles: string[]
  /** The short label of each position under the axis; only a few are printed. */
  axis: string[]
  lines: TrendLine[]
  format: (value: number) => string
  /** The most the axis reaches at least, so a calm series reads calm. */
  floor?: number
  /** A level to read against, drawn dashed across the plot. */
  reference?: { value: number; label: string }
  partial?: boolean[]
  /** A line's extra text at a position, read out beside its value. */
  detail?: (line: TrendLine, index: number) => string | undefined
  className?: string
}) {
  const [active, setActive] = useState<number>()
  const count = props.titles.length
  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const peak = Math.max(
    props.floor ?? 0,
    props.reference?.value ?? 0,
    ...props.lines.flatMap((line) =>
      line.values.filter((value): value is number => value != null)
    )
  )
  const top = peak > 0 ? peak * 1.08 : 1
  const x = (index: number) =>
    count > 1 ? PAD.left + (index * plotWidth) / (count - 1) : PAD.left
  const y = (value: number) =>
    PAD.top + plotHeight - (Math.min(value, top) / top) * plotHeight
  const ticks = Array.from(
    { length: VALUE_TICKS + 1 },
    (_, index) => (top * index) / VALUE_TICKS
  )
  const every = Math.max(1, Math.ceil(count / AXIS_LABELS))
  const last = count - 1
  const regular = props.axis
    .map((_, index) => index)
    .filter((index) => index % every === 0)
  // The last position is labelled too, unless a regular label is next to it.
  const labelled =
    last > 0 && last - (regular.at(-1) ?? 0) >= every / 2
      ? [...regular, last]
      : regular
  const anchorOf = (index: number) => {
    if (index === 0) return 'start'
    return index === last ? 'end' : 'middle'
  }

  const at = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0 || count === 0) return
    const px = ((event.clientX - box.left) / box.width) * WIDTH
    const index = Math.round(((px - PAD.left) / plotWidth) * (count - 1))
    setActive(Math.min(count - 1, Math.max(0, index)))
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setActive((index) => Math.max(0, (index ?? count) - 1))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setActive((index) => Math.min(count - 1, (index ?? -1) + 1))
    } else if (event.key === 'Escape') {
      setActive(undefined)
    }
  }
  const shown = active == null ? undefined : Math.min(active, count - 1)
  const dashedAt = (index: number) => !!props.partial?.[index]

  return (
    <div
      tabIndex={0}
      role='group'
      aria-label={props.ariaLabel}
      onKeyDown={key}
      onBlur={() => setActive(undefined)}
      className={cn(
        'focus-visible:ring-ring/50 relative rounded-md outline-none focus-visible:ring-2',
        props.className
      )}
    >
      <svg
        role='img'
        aria-label={props.ariaLabel}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className='text-muted-foreground h-auto w-full touch-pan-y'
        onPointerMove={at}
        onPointerDown={at}
        onPointerLeave={() => setActive(undefined)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className='stroke-border'
            />
            <text
              x={PAD.left - 6}
              y={y(tick)}
              textAnchor='end'
              dominantBaseline='middle'
              fill='currentColor'
              className='text-[11px]'
            >
              {props.format(tick)}
            </text>
          </g>
        ))}
        {props.reference && props.reference.value <= top && (
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(props.reference.value)}
            y2={y(props.reference.value)}
            className='stroke-destructive/60'
            strokeDasharray='4 3'
            data-reference
          >
            <title>{props.reference.label}</title>
          </line>
        )}
        {labelled.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={HEIGHT - 8}
            textAnchor={anchorOf(index)}
            fill='currentColor'
            className='text-[11px]'
          >
            {props.axis[index]}
          </text>
        ))}
        {shown != null && (
          <line
            x1={x(shown)}
            x2={x(shown)}
            y1={PAD.top}
            y2={PAD.top + plotHeight}
            className='stroke-foreground/30'
          />
        )}
        {props.lines.map((line) => {
          const segments = []
          for (let index = 1; index < count; index++) {
            const from = line.values[index - 1]
            const to = line.values[index]
            if (from == null || to == null) continue
            segments.push(
              <line
                key={index}
                data-line={line.key}
                x1={x(index - 1)}
                x2={x(index)}
                y1={y(from)}
                y2={y(to)}
                stroke={line.color}
                strokeWidth={line.dashed ? 1.5 : 2}
                strokeLinecap='round'
                strokeDasharray={
                  line.dashed || dashedAt(index - 1) || dashedAt(index)
                    ? '4 3'
                    : undefined
                }
                opacity={line.dashed ? 0.6 : 1}
              />
            )
          }
          // A value with no neighbour has no segment: a dot shows it.
          const dots = line.values.flatMap((value, index) =>
            value != null &&
            (index === shown ||
              (line.values[index - 1] == null &&
                line.values[index + 1] == null))
              ? [
                  <circle
                    key={props.titles[index]}
                    cx={x(index)}
                    cy={y(value)}
                    r={index === shown ? 3.5 : 2.5}
                    fill={dashedAt(index) ? 'var(--card)' : line.color}
                    stroke={line.color}
                    strokeWidth={1.5}
                  />,
                ]
              : []
          )
          return (
            <g key={line.key}>
              {segments}
              {dots}
            </g>
          )
        })}
      </svg>
      <ul className='text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs'>
        {props.lines.map((line) => (
          <li key={line.key} className='flex items-center gap-1.5'>
            <span
              aria-hidden
              className='inline-block h-0 w-4 border-t-2'
              style={{
                borderColor: line.color,
                borderStyle: line.dashed ? 'dashed' : 'solid',
              }}
            />
            <span className='text-foreground'>{line.label}</span>
            {line.summary && (
              <span className='tabular-nums'>{line.summary}</span>
            )}
          </li>
        ))}
      </ul>
      {shown != null && (
        <div
          role='status'
          className='bg-popover text-popover-foreground pointer-events-none absolute top-1 z-10 grid min-w-36 gap-0.5 rounded-md border px-2.5 py-1.5 text-xs shadow-md'
          style={
            shown / Math.max(count - 1, 1) > 0.6
              ? { right: `${100 - (x(shown) / WIDTH) * 100 + 2}%` }
              : { left: `${(x(shown) / WIDTH) * 100 + 2}%` }
          }
        >
          <p className='font-medium'>{props.titles[shown]}</p>
          {props.lines.map((line) => {
            const value = line.values[shown]
            const detail = props.detail?.(line, shown)
            return (
              <p key={line.key} className='flex items-center gap-1.5'>
                <span
                  aria-hidden
                  className='size-2 shrink-0 rounded-full'
                  style={{ backgroundColor: line.color }}
                />
                <span className='truncate'>{line.label}</span>
                <span className='ml-auto pl-2 tabular-nums'>
                  {value == null ? '—' : props.format(value)}
                </span>
                {detail && (
                  <span className='text-muted-foreground tabular-nums'>
                    {detail}
                  </span>
                )}
              </p>
            )
          })}
        </div>
      )}
    </div>
  )
}
