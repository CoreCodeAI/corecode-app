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
import { ChevronDown, CircleAlert, CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { sortFindings } from '../analysis'
import { useTabLabel, type InsightsTab } from '../lib'
import { Findings, type Finding } from './insight-kit'
import {
  attentionCounts,
  HEALTH_TABS,
  tabHealth,
  URGENT_SHOWN,
} from './overview-health'
import type { TabVerdicts } from './overview-verdicts'
import { Panel, type Tone } from './shared'

const DOTS: Record<Tone | 'unread', string> = {
  danger: 'bg-destructive',
  warning: 'bg-amber-500',
  default: 'bg-emerald-500',
  good: 'bg-emerald-500',
  unread: 'bg-muted-foreground/40',
}

/**
 * The line the page opens with: how many things need attention (a click
 * shows them), then one dot per tab, green, amber or red, each opening its
 * tab. The digest button sits at its end.
 */
export function StatusBar(props: {
  signals: Finding[]
  verdicts: TabVerdicts
  /** Views still being read; a tab with nothing read yet shows grey. */
  loading: number
  /** Whether each tab's data is in, by tab. */
  read: Partial<Record<InsightsTab, boolean>>
  onOpen?: (tab: InsightsTab, section?: string) => void
  onShowAttention: () => void
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const label = useTabLabel()
  const counts = attentionCounts(props.signals)
  const settled = props.loading === 0
  let headline = t('Reading…')
  if (counts.total > 0) {
    headline = t('{{count}} items need attention', { count: counts.total })
  } else if (settled) {
    headline = t('All clear')
  }
  return (
    <div
      role='status'
      className='bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2'
    >
      <button
        type='button'
        className='hover:bg-muted/60 -ml-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-sm font-medium'
        onClick={props.onShowAttention}
        aria-controls='overview-attention'
      >
        {counts.total > 0 ? (
          <CircleAlert
            aria-hidden
            className={cn(
              'size-4',
              counts.danger > 0
                ? 'text-destructive'
                : 'text-amber-600 dark:text-amber-400'
            )}
          />
        ) : (
          <CircleCheck
            aria-hidden
            className={cn(
              'size-4',
              settled
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'
            )}
          />
        )}
        {headline}
        {counts.total > 0 && (
          <span className='text-muted-foreground flex items-center gap-2 text-xs font-normal'>
            {counts.danger > 0 && (
              <span className='flex items-center gap-1'>
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', DOTS.danger)}
                />
                {t('{{count}} red', { count: counts.danger })}
              </span>
            )}
            {counts.warning > 0 && (
              <span className='flex items-center gap-1'>
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', DOTS.warning)}
                />
                {t('{{count}} amber', { count: counts.warning })}
              </span>
            )}
          </span>
        )}
        <ChevronDown aria-hidden className='text-muted-foreground size-3.5' />
      </button>
      <ul className='flex w-full flex-wrap items-center gap-x-1 gap-y-1 sm:w-auto sm:flex-1'>
        {HEALTH_TABS.map((tab) => {
          const tone = tabHealth(
            tab,
            props.verdicts,
            props.signals,
            !!props.read[tab]
          )
          const name = label(tab)
          return (
            <li key={tab}>
              <button
                type='button'
                data-health={tone ?? 'unread'}
                title={name}
                disabled={!props.onOpen}
                className='hover:bg-muted/60 text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-xs'
                onClick={() => props.onOpen?.(tab)}
              >
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', DOTS[tone ?? 'unread'])}
                />
                {name}
              </button>
            </li>
          )
        })}
      </ul>
      {props.actions}
    </div>
  )
}

/**
 * Everything that needs attention, at the foot of the page. The first red
 * findings are listed; the rest, red and amber, wait behind one click, which
 * the status bar also makes. Every finding stays in the page.
 */
export function AttentionPanel(props: {
  signals: Finding[]
  loading: number
  open: boolean
  onToggle: () => void
  help: string
  onOpen?: (tab: InsightsTab, section?: string) => void
}) {
  const { t } = useTranslation()
  const sorted = sortFindings(props.signals)
  const urgent = sorted.filter((item) => item.tone === 'danger')
  const shown = urgent.slice(0, URGENT_SHOWN)
  const rest = sorted.filter((item) => !shown.includes(item))
  const counts = attentionCounts(props.signals)
  const hidden = !props.open
  const split = [
    counts.danger > 0 && t('{{count}} red', { count: counts.danger }),
    counts.warning > 0 && t('{{count}} amber', { count: counts.warning }),
  ]
    .filter(Boolean)
    .join(' · ')
  let description: string | undefined = split || undefined
  if (props.loading > 0) {
    description = t('Reading {{count}} more views…', { count: props.loading })
  }
  return (
    <Panel
      id='overview-attention'
      title={t('Needs attention')}
      description={description}
      help={props.help}
      actions={
        rest.length > 0 ? (
          <button
            type='button'
            aria-expanded={props.open}
            className='text-primary flex items-center gap-1 text-xs font-medium hover:underline'
            onClick={props.onToggle}
          >
            {props.open
              ? t('Show fewer')
              : t('Show all {{count}}', { count: sorted.length })}
            <ChevronDown
              aria-hidden
              className={cn('size-3.5', props.open && 'rotate-180')}
            />
          </button>
        ) : undefined
      }
    >
      <Findings
        items={shown}
        empty={
          sorted.length === 0 && props.loading === 0
            ? t('Nothing needs attention, in this range or now.')
            : undefined
        }
        onOpen={props.onOpen}
      />
      {rest.length > 0 && (
        // Kept in the page while folded, so every finding can be found.
        <div
          hidden={hidden}
          className={cn(shown.length > 0 && 'mt-2 border-t pt-2')}
        >
          <Findings items={rest} onOpen={props.onOpen} />
        </div>
      )}
    </Panel>
  )
}
