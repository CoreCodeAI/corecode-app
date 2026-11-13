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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { displayKeyName } from '@/features/canvas-studio/lib/canvas-link'
import { CacheMissTooltip } from '@/features/usage-logs/components/cache-miss-tooltip'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import {
  getInputCacheTokens,
  isCostlyCacheMiss,
} from '@/features/usage-logs/lib/cost-check'
import { parseLogOther } from '@/features/usage-logs/lib/format'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatLogQuota,
  formatTimestampRelative,
  formatTokens,
} from '@/lib/format'
import { cn } from '@/lib/utils'

import { summarizeRecentLogs } from '../../lib/customer-overview'
import { PanelWrapper } from '../ui/panel-wrapper'

const VISIBLE_REQUESTS = 6

/** Opus, Sonnet and Haiku keep one hue each across the console. */
function getModelTone(model: string): string {
  if (model.includes('opus')) return 'bg-chart-1'
  if (model.includes('sonnet')) return 'bg-chart-3'
  if (model.includes('haiku')) return 'bg-chart-2'
  return 'bg-muted-foreground'
}

export function RecentRequestsPanel(props: {
  logs: UsageLog[]
  loading: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const visible = props.logs.slice(0, VISIBLE_REQUESTS)

  return (
    <PanelWrapper
      title={t('Recent requests')}
      description={t('Every request is billed and listed in Usage Logs.')}
      loading={props.loading}
      empty={!props.loading && visible.length === 0}
      emptyMessage={t('Requests from Claude Code show up here within seconds.')}
      height='h-52'
      className='h-full'
      contentClassName='p-0'
      headerActions={
        <Button
          variant='ghost'
          size='sm'
          render={
            <Link to='/usage-logs/$section' params={{ section: 'common' }} />
          }
        >
          {t('View all')}
          <ArrowRight data-icon='inline-end' />
        </Button>
      }
    >
      <ul className='divide-border/70 divide-y'>
        {visible.map((log) => {
          const cache = summarizeRecentLogs([log]).cacheHitRate
          // Anthropic input excludes the cache, so a cached turn would read
          // "2 / 1.2K"; show the whole context the request sent.
          const other = parseLogOther(log.other)
          const { totalInput } = getInputCacheTokens(log, other)
          const missed = isCostlyCacheMiss(log, other)
          const cacheText =
            cache === null
              ? ''
              : t('Cache {{rate}}', {
                  rate: Intl.NumberFormat(locale, {
                    style: 'percent',
                    maximumFractionDigits: 0,
                  }).format(cache),
                })
          return (
            <li
              key={log.id}
              className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 sm:px-5'
            >
              <span className='flex min-w-0 items-center gap-2 text-sm font-medium'>
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    getModelTone(log.model_name)
                  )}
                  aria-hidden
                />
                <span className='truncate'>{log.model_name}</span>
              </span>
              <span className='text-sm font-medium tabular-nums'>
                {formatLogQuota(log.quota)}
              </span>
              <span className='text-muted-foreground truncate pl-4 text-xs'>
                {[
                  formatTimestampRelative(log.created_at, 'seconds', locale),
                  displayKeyName(log.token_name ?? '', t),
                  t('{{input}} in / {{output}} out', {
                    input: formatTokens(totalInput),
                    output: formatTokens(log.completion_tokens),
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {missed ? (
                <CacheMissTooltip
                  isStream={log.is_stream}
                  render={
                    <span
                      className='text-warning cursor-help text-right text-xs font-medium tabular-nums'
                      tabIndex={0}
                    >
                      {cacheText}
                    </span>
                  }
                />
              ) : (
                <span className='text-muted-foreground text-right text-xs tabular-nums'>
                  {cacheText}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </PanelWrapper>
  )
}
