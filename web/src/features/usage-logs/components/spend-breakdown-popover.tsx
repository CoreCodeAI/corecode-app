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
/**
 * CoreCode fork: "how much did this project spend?" A customer usually gives
 * each project its own key, so spend per key (and per model) over the range
 * being viewed answers it, and choosing one filters the logs to it.
 *
 * Reads the hourly quota_data rollup through /api/data/flow/self, so totals
 * follow hour boundaries rather than the exact minute of the range.
 */
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ChartPie } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { displayKeyName } from '@/features/canvas-studio/lib/canvas-link'
import { getFlowQuotaDates } from '@/features/dashboard/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { spendBreakdownRange } from '../lib/query-ranges'
import { summarizeSpend, type SpendRow } from '../lib/spend-breakdown'

const route = getRouteApi('/_authenticated/usage-logs/$section')
const VISIBLE_ROWS = 6

function SpendList(props: {
  title: string
  rows: SpendRow[]
  total: number
  onPick: (name: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  if (props.rows.length === 0) return null
  return (
    <section className='flex flex-col gap-1'>
      <h3 className='text-muted-foreground px-1 font-sans text-xs font-medium tracking-normal'>
        {props.title}
      </h3>
      <ul className='flex flex-col'>
        {props.rows.slice(0, VISIBLE_ROWS).map((row) => {
          const share = props.total > 0 ? row.quota / props.total : 0
          return (
            <li key={row.name}>
              <button
                type='button'
                onClick={() => props.onPick(row.name)}
                className='hover:bg-accent focus-visible:ring-ring/50 relative flex w-full items-center gap-3 overflow-hidden rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3'
                aria-label={t('Show logs for {{name}}', {
                  name: displayKeyName(row.name, t),
                })}
              >
                <span
                  className='bg-primary/10 absolute inset-y-0 left-0'
                  style={{ width: `${share * 100}%` }}
                  aria-hidden
                />
                <span className='relative min-w-0 flex-1 truncate'>
                  {displayKeyName(row.name, t)}
                </span>
                <span className='text-muted-foreground relative text-xs tabular-nums'>
                  {t('{{value}} requests', {
                    value: formatNumber(row.count, locale),
                  })}
                </span>
                <span className='relative w-20 text-right font-mono text-xs font-medium tabular-nums'>
                  {formatQuota(row.quota)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function SpendBreakdownPopover() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const searchParams = route.useSearch()
  const { start, end } = spendBreakdownRange(searchParams, Date.now())

  const query = useQuery({
    // Under the stats prefix so the filter bar's refresh also refreshes it.
    queryKey: ['usage-logs-stats', 'spend-breakdown', start, end, searchParams],
    queryFn: async () => {
      const data = requireServerSuccess(
        await getFlowQuotaDates({ start_timestamp: start, end_timestamp: end })
      ).data
      return Array.isArray(data) ? data : []
    },
    staleTime: 60 * 1000,
  })
  const rows = query.data ?? []
  const byKey = summarizeSpend(
    rows,
    (row) => row.token_name || (row.token_id ? `#${row.token_id}` : '')
  )
  const byModel = summarizeSpend(rows, (row) => row.model_name ?? '')
  const total = byModel.reduce((sum, row) => sum + row.quota, 0)

  const filterBy = (field: 'token' | 'model', value: string) => {
    navigate({
      to: '/usage-logs/$section',
      params: { section: 'common' },
      search: { ...searchParams, [field]: value, page: 1 },
    })
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant='outline' size='sm' />}>
        <ChartPie data-icon='inline-start' />
        {t('Spend by key')}
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='flex max-h-[min(30rem,var(--available-height))] w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto'
      >
        <PopoverTitle>
          {t('Spend in this range: {{amount}}', {
            amount: formatQuota(total),
          })}
        </PopoverTitle>
        {!query.isLoading && rows.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('No spend in this range.')}
          </p>
        )}
        <SpendList
          title={t('By API key')}
          rows={byKey}
          total={total}
          onPick={(name) => filterBy('token', name)}
        />
        <SpendList
          title={t('By model')}
          rows={byModel}
          total={total}
          onPick={(name) => filterBy('model', name)}
        />
      </PopoverContent>
    </Popover>
  )
}
