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
import { useTranslation } from 'react-i18next'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { TONES, useInsightsFormat, type InsightsTab } from '../lib'
import type { ActivityInsights } from '../types'
import {
  DeltaBadge,
  HelpLabel,
  Panel,
  Sparkline,
  UserLabel,
  type MetricItem,
} from './shared'

/**
 * A headline figure with its change and the figure's own small trend under
 * it. Every card of the overview's top block draws one, so the block reads
 * as figures and their shape at once.
 */
export function KpiCard(props: { item: MetricItem; loading?: boolean }) {
  const fmt = useInsightsFormat()
  const { item } = props
  const shown = !props.loading && !item.missing
  return (
    <Card
      data-card-hover='false'
      className='bg-muted/20 min-w-0 gap-1 px-3 py-2.5'
    >
      <dt className='text-muted-foreground truncate text-xs'>
        <HelpLabel label={item.label} help={item.help} />
      </dt>
      <dd className='flex min-w-0 flex-wrap items-baseline gap-x-2 text-xl font-semibold tabular-nums sm:text-2xl'>
        {props.loading && <Skeleton className='h-8 w-20' />}
        {!props.loading && item.missing && (
          <span className='text-muted-foreground'>-</span>
        )}
        {shown && (
          <span
            className={cn('truncate', TONES[item.tone ?? 'default'])}
            title={typeof item.value === 'string' ? item.value : undefined}
          >
            {item.value}
          </span>
        )}
        {item.delta && shown && <DeltaBadge delta={item.delta} />}
      </dd>
      {item.trend && shown && (
        <dd className='-mx-0.5'>
          <Sparkline
            points={item.trend}
            format={item.trendFormat ?? fmt.num}
            label={item.label}
            bars={item.trendBars}
          />
        </dd>
      )}
      {item.hint != null && (
        <dd
          className='text-muted-foreground line-clamp-2 text-xs'
          title={typeof item.hint === 'string' ? item.hint : undefined}
        >
          {item.hint}
        </dd>
      )}
    </Card>
  )
}

/** Eight figures, four across on a wide screen and two on a phone. */
export function KpiGrid(props: { items: MetricItem[]; loading?: boolean }) {
  return (
    <dl className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
      {props.items.map((item) => (
        <KpiCard key={item.label} item={item} loading={props.loading} />
      ))}
    </dl>
  )
}

/** Customers shown in the ranking. */
export const TOP_CUSTOMERS = 10

/**
 * The customers who used the most, each a bar of what they were charged at
 * list price, with their share of all customers' use. Names are shown: this
 * page is for administrators.
 */
export function TopCustomersPanel(props: {
  activity: ActivityInsights | undefined
  failed?: boolean
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const rows = (props.activity?.top_users ?? []).slice(0, TOP_CUSTOMERS)
  const most = Math.max(0, ...rows.map((row) => row.quota_usd))
  return (
    <Panel
      title={t('Top customers by consumption')}
      description={
        rows.length > 0
          ? t('Charged at list price; root and staff are left out.')
          : undefined
      }
      actions={
        props.onOpen && (
          <button
            type='button'
            className='text-primary text-xs font-medium hover:underline'
            onClick={() => props.onOpen?.('activity')}
          >
            {t('Activity & retention')} →
          </button>
        )
      }
    >
      {!props.activity && props.failed && (
        <p className='text-muted-foreground text-xs'>
          {t('Could not be read')}
        </p>
      )}
      {!props.activity && !props.failed && (
        <div className='bg-muted h-40 animate-pulse rounded-md' />
      )}
      {props.activity && rows.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          {t('No customer used the service in this range')}
        </p>
      )}
      {rows.length > 0 && (
        <ol className='grid gap-2.5'>
          {rows.map((row, index) => (
            <li key={row.user_id} className='grid gap-1'>
              <div className='flex items-baseline gap-2 text-xs'>
                <span className='text-muted-foreground w-4 shrink-0 text-right tabular-nums'>
                  {index + 1}
                </span>
                <span className='min-w-0 flex-1 truncate'>
                  <UserLabel user_id={row.user_id} username={row.username} />
                </span>
                <span className='w-20 shrink-0 text-right tabular-nums'>
                  {fmt.cny(row.quota_usd)}
                </span>
                <span
                  className='text-muted-foreground w-12 shrink-0 text-right tabular-nums'
                  title={t('Share of all customers’ consumption')}
                >
                  {fmt.pct(row.share)}
                </span>
              </div>
              <div className='bg-muted ml-6 h-1.5 overflow-hidden rounded-full'>
                <div
                  className='h-full rounded-full'
                  style={{
                    backgroundColor: 'var(--series-1)',
                    width: `${most ? (row.quota_usd / most) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
