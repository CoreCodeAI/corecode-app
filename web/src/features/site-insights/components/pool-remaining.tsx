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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { useInsightsFormat } from '../lib'
import type {
  EngineOutlook,
  EngineOutlookRemaining,
  EngineOutlookReset,
} from '../types'
import { QUOTA_PART_COLORS, useWindowLabel } from './outlook'
import { HelpLabel, Panel, ReadoutTip, SimpleTable } from './shared'

const HOUR_MS = 3_600_000

/**
 * What the Claude pool can spend within the next 5 hours, 24 hours and 7
 * days, whatever the demand. A switch counts the resets inside each window or
 * leaves them out, and each figure lists what it is made of, so the two
 * readings cannot be mistaken for each other.
 */
export function RemainingPanel(props: { outlook: EngineOutlook }) {
  const { t } = useTranslation()
  const windowLabel = useWindowLabel()
  const switchId = useId()
  const [resets, setResets] = useState(true)
  const outlook = props.outlook

  const help = (hours: number) => {
    if (hours === 5) {
      return t(
        'Held now: what the running 5-hour windows have left below their budget lines, each bounded by its account’s weekly remainder. 5-hour resets: the windows that restart inside the 5 hours. Weekly resets: accounts at their weekly line whose week restarts in time.'
      )
    }
    if (hours === 24) {
      return t(
        'Held now: the weekly quota left, as far as the 5-hour windows let it through in 24 hours, with no weekly reset. Weekly resets: what the weeks that restart inside the day add. A reset replaces what the account still held, so it adds only the used part.'
      )
    }
    return t(
      'Held now: the weekly quota left below the budget lines, with no weekly reset. Weekly resets: every week that restarts inside the 7 days; each account’s week restarts once.'
    )
  }

  return (
    <Panel
      title={t('Quota left')}
      description={
        resets
          ? t(
              'The most the pool can spend in each window, counting the resets inside it.'
            )
          : t('What the pool holds now, counting no reset.')
      }
      help={t(
        'Supply only: the most the accounts can spend in each window if demand were unlimited, each spending what it may as soon as it may. Whether that meets demand is in the forecast below. A 5-hour window starts with an account’s first request and restarts full 5 hours later; a week does the same over 7 days. Suspended, disabled and blacklisted accounts add nothing; a cooling account counts from when it returns. Dollars are gpt-load spend at official prices, weighted by the quota each model draws.'
      )}
      actions={
        // The label carries the switch, so a finger has the whole row to hit.
        <label
          htmlFor={switchId}
          className='-my-1 flex min-h-8 shrink-0 cursor-pointer items-center gap-2 text-xs font-medium'
        >
          {t('Count resets')}
          <Switch id={switchId} checked={resets} onCheckedChange={setResets} />
        </label>
      }
    >
      <dl className='grid gap-3 sm:grid-cols-3'>
        {outlook.remaining.map((row) => (
          <RemainingCard
            key={row.hours}
            row={row}
            resets={resets}
            label={windowLabel(row.hours)}
            help={help(row.hours)}
          />
        ))}
      </dl>
      {outlook.unknown > 0 && (
        <p className='text-muted-foreground mt-3 text-xs'>
          {t('{{count}} accounts without an estimate are not counted.', {
            count: outlook.unknown,
          })}
        </p>
      )}
      <ResetList resets={outlook.resets} observedAt={outlook.observed_at_ms} />
    </Panel>
  )
}

function RemainingCard(props: {
  row: EngineOutlookRemaining
  resets: boolean
  label: string
  help: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const row = props.row
  const total = Math.max(row.with_resets_usd, 0)
  const parts = [
    { key: 'held' as const, label: t('Held now'), usd: row.on_hand_usd },
    {
      key: 'five' as const,
      label: t('5-hour resets'),
      usd: row.five_hour_refill_usd,
    },
    {
      key: 'week' as const,
      label: t('Weekly resets'),
      usd: row.week_refill_usd,
    },
  ]
  const value = props.resets ? row.with_resets_usd : row.on_hand_usd
  return (
    <Card data-card-hover='false' className='bg-muted/20 gap-2 px-3 py-3'>
      <dt className='text-muted-foreground text-xs'>
        <HelpLabel label={props.label} help={props.help} />
      </dt>
      <dd className='text-2xl font-semibold tabular-nums'>
        ≈ {fmt.usdWhole(value)}
      </dd>
      <dd>
        <ReadoutTip
          title={props.label}
          rows={parts.map((part) => ({
            key: part.key,
            label: part.label,
            value: `${fmt.usdWhole(part.usd)} · ${fmt.pct(total > 0 ? part.usd / total : 0)}`,
            swatch: QUOTA_PART_COLORS[part.key],
          }))}
        >
          <div
            role='img'
            aria-label={parts
              .map((part) => `${part.label} ${fmt.usdWhole(part.usd)}`)
              .join(', ')}
            className='bg-foreground/10 flex h-2 w-full overflow-hidden rounded-full'
          >
            {total > 0 &&
              parts.map((part) => (
                <span
                  key={part.key}
                  className={cn(
                    'h-full transition-all duration-300 ease-out',
                    QUOTA_PART_COLORS[part.key],
                    // A part the switch leaves out stays in place, faded, so
                    // the bar shows what counting resets would add.
                    !props.resets && part.key !== 'held' && 'opacity-25'
                  )}
                  style={{ width: `${(part.usd / total) * 100}%` }}
                />
              ))}
          </div>
        </ReadoutTip>
      </dd>
      <dd>
        <ul className='grid gap-1 text-xs tabular-nums'>
          {parts.map((part) => {
            const counted = props.resets || part.key === 'held'
            return (
              <li
                key={part.key}
                className={cn(
                  'flex items-center justify-between gap-2',
                  (!counted || part.usd <= 0) && 'text-muted-foreground'
                )}
              >
                <span className='flex min-w-0 items-center gap-1.5'>
                  <span
                    aria-hidden
                    className={cn(
                      'size-2 shrink-0 rounded-sm',
                      QUOTA_PART_COLORS[part.key],
                      !counted && 'opacity-25'
                    )}
                  />
                  <span className='truncate'>{part.label}</span>
                </span>
                <span className={cn(!counted && 'line-through')}>
                  {part.key === 'held' ? '' : '+'}
                  {fmt.usdWhole(part.usd)}
                </span>
              </li>
            )
          })}
        </ul>
      </dd>
    </Card>
  )
}

/**
 * Every reset the figures above count, soonest first: when, which account
 * and window, and what it adds. Folded away until asked for.
 */
function ResetList(props: {
  resets: EngineOutlookReset[]
  observedAt: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  if (props.resets.length === 0) return null
  const ahead = (ms: number) => {
    const hours = (ms - props.observedAt) / HOUR_MS
    if (hours < 1) {
      return t('in {{minutes}} min', {
        minutes: Math.max(1, Math.round(hours * 60)),
      })
    }
    if (hours < 48) return t('in {{hours}} h', { hours: hours.toFixed(1) })
    return t('in {{days}} d', { days: (hours / 24).toFixed(1) })
  }
  return (
    <Collapsible className='mt-3'>
      <CollapsibleTrigger className='group text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-h-6 items-center gap-1 rounded-sm text-xs outline-none focus-visible:ring-2'>
        <ChevronDown
          aria-hidden
          className='size-3.5 transition-transform group-data-[panel-open]:rotate-180'
        />
        {t('Upcoming resets ({{count}})', { count: props.resets.length })}
      </CollapsibleTrigger>
      <CollapsibleContent className='pt-2'>
        <SimpleTable<EngineOutlookReset>
          rows={props.resets}
          rowKey={(row) => `${row.window}-${row.credential_id}`}
          empty=''
          columns={[
            {
              key: 'at',
              label: t('Resets'),
              render: (row) => (
                <span className='flex flex-wrap items-baseline gap-x-2 whitespace-nowrap'>
                  <span>{fmt.time(Math.floor(row.at_ms / 1000))}</span>
                  <span className='text-muted-foreground text-xs'>
                    {ahead(row.at_ms)}
                  </span>
                </span>
              ),
            },
            {
              key: 'window',
              label: t('Window'),
              render: (row) => (
                <Badge variant='outline' className='gap-1.5'>
                  <span
                    aria-hidden
                    className={cn(
                      'size-2 rounded-sm',
                      row.window === 'five_hour'
                        ? QUOTA_PART_COLORS.five
                        : QUOTA_PART_COLORS.week
                    )}
                  />
                  {row.window === 'five_hour' ? t('5-hour') : t('Weekly')}
                </Badge>
              ),
            },
            {
              key: 'adds',
              label: t('Adds'),
              hint: t(
                'What the reset adds to what the account can spend if it spends nothing more before it: for a week the used part of the week, for a 5-hour window the used part of the window as far as the weekly remainder allows.'
              ),
              align: 'right',
              render: (row) => `+${fmt.usdWhole(row.adds_usd)}`,
            },
            {
              key: 'account',
              label: t('Account'),
              render: (row) => (
                <span className='font-mono text-xs'>
                  #{row.credential_id} {row.email_mask}
                </span>
              ),
            },
          ]}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}
