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
import { useState, type PointerEvent } from 'react'

import { cn } from '@/lib/utils'

import { BUCKET_CLASS } from '../lib/format'
import type { BucketState } from '../types'

export interface StripCell {
  key: number
  state: BucketState
  /** The period, read out first. */
  title: string
  /** What happened in it. */
  detail: string
}

/**
 * A row of periods coloured by their state. Every position across the row,
 * gaps included, belongs to one period, so a pointer or a finger dragged
 * along it reads one period after another in the line below; arrow keys do
 * the same. With nothing picked, the line shows `summary`.
 */
export function StatusStrip(props: {
  cells: StripCell[]
  label: string
  startLabel: string
  endLabel: string
  summary: string
  className?: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const cells = props.cells
  const last = cells.length - 1
  if (cells.length === 0) return null
  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const share = (event.clientX - box.left) / Math.max(box.width, 1)
    return Math.min(last, Math.max(0, Math.floor(share * cells.length)))
  }
  const cell = active === null ? null : cells[active]

  return (
    <div className={cn('flex flex-col gap-1.5', props.className)}>
      <div
        tabIndex={0}
        role='img'
        aria-label={props.label}
        className='focus-visible:ring-ring/50 flex h-8 cursor-crosshair touch-pan-y gap-[2px] rounded-sm outline-none focus-visible:ring-2'
        onPointerDown={(event) => setActive(nearest(event))}
        onPointerMove={(event) => setActive(nearest(event))}
        // A lifted finger leaves too; its period stays read until a tap
        // elsewhere blurs the row.
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') setActive(null)
        }}
        onFocus={() => setActive((current) => current ?? last)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            setActive((current) => Math.max(0, (current ?? last) - 1))
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            setActive((current) => Math.min(last, (current ?? last) + 1))
          }
        }}
      >
        {cells.map((item, index) => (
          <span
            key={item.key}
            aria-hidden
            className={cn(
              'min-w-0 flex-1 rounded-[2px] transition-opacity',
              BUCKET_CLASS[item.state],
              active !== null && active !== index && 'opacity-40'
            )}
          />
        ))}
      </div>
      <div className='text-muted-foreground flex justify-between text-xs'>
        <span>{props.startLabel}</span>
        <span>{props.endLabel}</span>
      </div>
      <p
        aria-live='polite'
        className='text-muted-foreground min-h-5 text-xs tabular-nums'
      >
        {cell ? (
          <>
            <span className='text-foreground font-medium'>{cell.title}</span>
            {' · '}
            {cell.detail}
          </>
        ) : (
          props.summary
        )}
      </p>
    </div>
  )
}
