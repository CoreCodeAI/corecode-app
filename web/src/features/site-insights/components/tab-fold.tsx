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
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { attentionCounts, BREAKDOWN_SHOWN, RED_SHOWN } from '../attention'
import type { InsightsTab } from '../lib'
import { Findings, type Finding } from './insight-kit'
import { Breakdown, Panel, type TableState } from './shared'

/**
 * A detail closed until asked for: a plain summary line with a chevron, then
 * what it hides. It is the page's own details element, so it opens from the
 * keyboard and a screen reader reads its state.
 */
export function Fold(props: {
  summary: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <details className={cn('group min-w-0', props.className)}>
      <summary className='text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-xs outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden'>
        <ChevronDown
          aria-hidden
          className='size-3.5 transition-transform group-open:rotate-180'
        />
        {props.summary}
      </summary>
      <div className='mt-3'>{props.children}</div>
    </details>
  )
}

/**
 * A tab's findings as one line under its figures: how many there are, how many
 * red and yellow, and a button to the list at the foot of the page, which it
 * opens. Nothing when there are none.
 */
export function AttentionSummary(props: {
  items: Finding[]
  targetId: string
  onShow: () => void
}) {
  const { t } = useTranslation()
  const counts = attentionCounts(props.items)
  if (counts.total === 0) return null
  const show = () => {
    props.onShow()
    // The list opens on the next render; the jump waits for its new height.
    window.requestAnimationFrame(() =>
      document
        .querySelector(`[id="${props.targetId}"]`)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    )
  }
  return (
    <div className='bg-muted/20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm'>
      <span className='font-medium'>
        {t('Needs attention: {{count}}', { count: counts.total })}
      </span>
      {counts.red > 0 && (
        <span className='text-destructive flex items-center gap-1.5 text-xs'>
          <span aria-hidden className='bg-destructive size-2 rounded-full' />
          {t('{{count}} red', { count: counts.red })}
        </span>
      )}
      {counts.yellow > 0 && (
        <span className='flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400'>
          <span aria-hidden className='size-2 rounded-full bg-amber-500' />
          {t('{{count}} yellow', { count: counts.yellow })}
        </span>
      )}
      <Button variant='ghost' size='sm' className='ml-auto h-7' onClick={show}>
        {t('See the list')} ↓
      </Button>
    </div>
  )
}

/**
 * A tab's findings at the foot of the page. Closed, it lists the first red
 * ones only; open, all of them, worst first.
 */
export function AttentionPanel(props: {
  id: string
  items: Finding[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpen?: (tab: InsightsTab, section?: string) => void
}) {
  const { t } = useTranslation()
  if (props.items.length === 0) return null
  const red = props.items.filter((item) => item.tone === 'danger')
  const shown = props.open ? props.items : red.slice(0, RED_SHOWN)
  const hidden = props.items.length - shown.length
  return (
    <Panel
      id={props.id}
      title={t('Where to look')}
      actions={
        (props.open || hidden > 0) && (
          <Button
            variant='ghost'
            size='sm'
            aria-expanded={props.open}
            onClick={() => props.onOpenChange(!props.open)}
          >
            {props.open
              ? t('Show fewer')
              : t('Show all {{count}}', { count: props.items.length })}
          </Button>
        )
      }
    >
      {shown.length > 0 ? (
        <Findings items={shown} onOpen={props.onOpen} />
      ) : (
        <p className='text-muted-foreground text-xs'>
          {t('Nothing here is red; {{count}} are worth a look.', {
            count: props.items.length,
          })}
        </p>
      )}
    </Panel>
  )
}

/**
 * A breakdown's first rows, the rest summed into one row so the shares still
 * add up, and every row behind a fold. A short list shows whole.
 */
export function FoldedBreakdown(props: {
  items: { name: string; count: number }[] | null | undefined
  label?: (name: string) => string
  empty: string
  state?: TableState
  /** The name of the summed row. */
  restLabel: string
}) {
  const { t } = useTranslation()
  const items = props.items ?? []
  if (items.length <= BREAKDOWN_SHOWN + 1) {
    return (
      <Breakdown
        items={items}
        label={props.label}
        empty={props.empty}
        state={props.state}
      />
    )
  }
  const labelOf = (name: string) => {
    if (name === props.restLabel || !props.label) return name
    return props.label(name)
  }
  const rest = items.slice(BREAKDOWN_SHOWN)
  const head = [
    ...items.slice(0, BREAKDOWN_SHOWN),
    {
      name: props.restLabel,
      count: rest.reduce((sum, item) => sum + item.count, 0),
    },
  ]
  return (
    <div className='grid gap-3'>
      <Breakdown items={head} label={labelOf} empty={props.empty} />
      <Fold summary={t('Show all {{count}}', { count: items.length })}>
        <Breakdown items={items} label={props.label} empty={props.empty} />
      </Fold>
    </div>
  )
}
