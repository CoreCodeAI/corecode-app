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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import type { Finding } from '../analysis'
import { getUserSpend } from '../api'
import { spendFlags, type SpendFlag } from '../finance-analysis'
import {
  TONES,
  useChargeFormat,
  useInsightsFormat,
  type InsightsTab,
} from '../lib'
import type { UserSpend, UserSpendHours, UserSpendRow } from '../types'
import { Findings } from './insight-kit'
import { Panel, SimpleTable } from './shared'

const WINDOWS: UserSpendHours[] = [1, 5, 12, 24, 168]

/**
 * Each customer's use over a window the panel picks for itself, apart from
 * the range at the top of the page: new-api's charge, gpt-load's cost shared
 * out to them, what they have paid and their balance.
 */
export function UserSpendPanel(props: { onOpen?: (tab: InsightsTab) => void }) {
  const { t } = useTranslation()
  const [hours, setHours] = useState<UserSpendHours>(24)
  const query = useQuery({
    queryKey: ['site-insights', 'user-spend', hours],
    queryFn: () => getUserSpend(hours),
    // The server shares one read a minute.
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const windowLabels: Record<UserSpendHours, string> = {
    1: t('1 hour'),
    5: t('5 hours'),
    12: t('12 hours'),
    24: t('24 hours'),
    168: t('{{count}} days', { count: 7 }),
  }

  return (
    <Panel
      title={t('Consumption by user')}
      description={<UserSpendSummary data={data} />}
      help={t(
        'Customers with use in the window, most new-api value first, up to 100; root’s own use is not listed. new-api value is what new-api charged at its own prices, in yuan, with dollars at the site’s exchange rate under it. gpt-load value is what the same requests cost at official prices. gpt-load does not know which user sent a request, so each model’s cost is shared among that model’s users by their new-api charge with the group ratio taken out. Total paid is every wallet top-up the customer ever paid, in yuan, with plans bought listed under it. Balance is the wallet now.'
      )}
    >
      <div className='grid gap-3'>
        <ToggleGroup
          variant='outline'
          size='sm'
          aria-label={t('Window')}
          className='grid w-full grid-cols-5 sm:flex sm:w-fit'
          value={[String(hours)]}
          onValueChange={(value: string[]) => {
            const next = Number(value.at(-1)) as UserSpendHours
            if (WINDOWS.includes(next)) setHours(next)
          }}
        >
          {WINDOWS.map((window) => (
            <ToggleGroupItem
              key={window}
              value={String(window)}
              className='h-10 sm:h-8'
            >
              {windowLabels[window]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {query.isError && (
          <p className='text-destructive text-sm'>
            {query.error instanceof Error
              ? query.error.message
              : t('Failed to load site insights')}
          </p>
        )}
        {data?.engine_error && (
          <p className='text-destructive text-sm'>{data.engine_error}</p>
        )}
        <div
          className={cn(
            'transition-opacity',
            query.isPlaceholderData && 'opacity-60'
          )}
          aria-busy={query.isFetching}
        >
          <UserSpendTable data={data} loading={query.isPending} />
        </div>
        <SpendFindings data={data} onOpen={props.onOpen} />
      </div>
    </Panel>
  )
}

/** Every flag each listed customer carries, by user id. */
function useSpendFlags(data: UserSpend | undefined): Map<number, SpendFlag[]> {
  const charge = useChargeFormat(data)
  const engineRead = !!data?.engine_configured && !data.engine_error
  return new Map(
    (data?.users ?? []).map((row) => [
      row.user_id,
      spendFlags(row, data?.quota_usd ?? 0, charge.rate, engineRead),
    ])
  )
}

/**
 * The customers to look at, as findings: those charged below official cost
 * first by what they lose, then debtors, linked to the risk tab, then one
 * customer holding too much of the window.
 */
function SpendFindings(props: {
  data: UserSpend | undefined
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.data)
  const flags = useSpendFlags(props.data)
  const users = props.data?.users ?? []
  const name = (row: UserSpendRow) => row.username || `#${row.user_id}`
  const flagged = (flag: SpendFlag) =>
    users.filter((row) => flags.get(row.user_id)?.includes(flag))
  const below = flagged('below_cost')
  const debtors = flagged('debt')
  const concentrated = flagged('concentrated')
  const items: Finding[] = []
  if (below.length > 0) {
    const loss = below.reduce(
      (sum, row) => sum + row.engine_usd - charge.toUSD(row.quota_usd),
      0
    )
    items.push({
      key: 'below-cost',
      tone: 'warning',
      title: t(
        '{{count}} customers were charged {{loss}} less than gpt-load’s official cost.',
        { count: below.length, loss: fmt.usd(loss) }
      ),
      detail: below.slice(0, 5).map(name).join(t(', ')),
      impact: loss,
    })
  }
  if (debtors.length > 0) {
    items.push({
      key: 'debt',
      tone: 'warning',
      title: t('{{count}} customers are in debt.', { count: debtors.length }),
      detail: debtors.slice(0, 5).map(name).join(t(', ')),
      tab: 'risk',
      impact: -debtors.reduce((sum, row) => sum + row.balance_usd, 0),
    })
  }
  for (const row of concentrated) {
    items.push({
      key: `concentrated-${row.user_id}`,
      tone: 'warning',
      title: t('{{user}} used {{share}} of the window’s consumption.', {
        user: name(row),
        share: fmt.pct(row.quota_usd / (props.data?.quota_usd || 1)),
      }),
      impact: row.quota_usd,
    })
  }
  if (items.length === 0) return null
  return (
    <div className='border-t pt-3'>
      <Findings items={items} onOpen={props.onOpen} />
    </div>
  )
}

function UserSpendSummary(props: { data: UserSpend | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  if (!data) return null
  const engineRead = data.engine_configured && !data.engine_error
  const parts = [
    engineRead
      ? t(
          '{{count}} customers used {{quota}} of new-api value and {{engine}} at gpt-load’s official prices.',
          {
            count: data.customers,
            quota: fmt.cny(data.quota_usd),
            engine: fmt.usd(data.customer_engine_usd),
          }
        )
      : t('{{count}} customers used {{quota}} of new-api value.', {
          count: data.customers,
          quota: fmt.cny(data.quota_usd),
        }),
  ]
  if (data.root_quota_usd > 0 || data.root_engine_usd > 0) {
    parts.push(
      engineRead
        ? t('Root’s own use, {{quota}} and {{engine}}, is not listed.', {
            quota: fmt.cny(data.root_quota_usd),
            engine: fmt.usd(data.root_engine_usd),
          })
        : t('Root’s own use, {{quota}}, is not listed.', {
            quota: fmt.cny(data.root_quota_usd),
          })
    )
  }
  if (engineRead && data.unattributed_engine_usd >= 0.01) {
    parts.push(
      t(
        '{{amount}} of gpt-load’s cost was for a vendor no one was charged for, so it is not shared out.',
        { amount: fmt.usd(data.unattributed_engine_usd) }
      )
    )
  }
  return parts.join(' ')
}

function UserSpendTable(props: {
  data: UserSpend | undefined
  loading: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.data)
  const engineRead = !!props.data?.engine_configured && !props.data.engine_error
  const engine = (row: UserSpendRow) =>
    engineRead ? fmt.usd(row.engine_usd) : '—'
  const flags = useSpendFlags(props.data)

  return (
    <SimpleTable
      rows={props.data?.users}
      rowKey={(row) => row.user_id}
      empty={
        props.loading ? t('Loading...') : t('No consumption in this window')
      }
      columns={[
        {
          key: 'user',
          label: t('User'),
          render: (row) => (
            <UserIdentity row={row} flags={flags.get(row.user_id)} />
          ),
        },
        {
          key: 'quota',
          label: t('new-api value'),
          align: 'right',
          render: (row) => (
            <Stacked
              value={fmt.cny(row.quota_usd)}
              note={fmt.usd(charge.toUSD(row.quota_usd))}
            />
          ),
        },
        {
          key: 'engine',
          label: t('gpt-load value'),
          hint: t(
            'The user’s share of gpt-load’s official-price cost: each model’s cost split by new-api charge, group ratio taken out.'
          ),
          align: 'right',
          render: engine,
        },
        {
          key: 'paid',
          label: t('Total paid'),
          hint: t(
            'Every wallet top-up the customer ever paid, in yuan; plans bought are listed under it.'
          ),
          align: 'right',
          render: (row) => <Paid row={row} />,
        },
        {
          key: 'balance',
          label: t('Balance'),
          align: 'right',
          render: (row) => <Balance value={row.balance_usd} />,
        },
      ]}
      card={(row) => (
        <div className='grid gap-2'>
          <div className='flex items-start justify-between gap-3'>
            <UserIdentity row={row} flags={flags.get(row.user_id)} />
            <div className='shrink-0 text-right'>
              <Stacked
                value={fmt.cny(row.quota_usd)}
                note={t('new-api value')}
              />
            </div>
          </div>
          <dl className='grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t pt-2 text-sm'>
            <div className='min-w-0'>
              <dt className='text-muted-foreground truncate text-xs'>
                {t('gpt-load value')}
              </dt>
              <dd>{engine(row)}</dd>
            </div>
            <div className='min-w-0'>
              <dt className='text-muted-foreground truncate text-xs'>
                {t('Total paid')}
              </dt>
              <dd>
                <Paid row={row} />
              </dd>
            </div>
            <div className='min-w-0 text-right'>
              <dt className='text-muted-foreground truncate text-xs'>
                {t('Balance')}
              </dt>
              <dd>
                <Balance value={row.balance_usd} />
              </dd>
            </div>
          </dl>
        </div>
      )}
    />
  )
}

function UserIdentity(props: { row: UserSpendRow; flags?: SpendFlag[] }) {
  const { t } = useTranslation()
  const labels: Record<SpendFlag, string> = {
    below_cost: t('Below official cost'),
    debt: t('In debt'),
    concentrated: t('Large share'),
  }
  const flags = props.flags ?? []
  return (
    <div className='min-w-0'>
      <p className='truncate font-medium'>
        {props.row.username || '-'}{' '}
        <span className='text-muted-foreground font-mono text-xs font-normal'>
          #{props.row.user_id}
        </span>
      </p>
      {props.row.email && (
        <p
          className='text-muted-foreground max-w-56 truncate text-xs'
          title={props.row.email}
        >
          {props.row.email}
        </p>
      )}
      {flags.length > 0 && (
        <p className={cn('text-xs', TONES.warning)}>
          {flags.map((flag) => labels[flag]).join(' · ')}
        </p>
      )}
    </div>
  )
}

function Stacked(props: { value: string; note: string }) {
  return (
    <div>
      <p>{props.value}</p>
      <p className='text-muted-foreground text-xs'>{props.note}</p>
    </div>
  )
}

function Paid(props: { row: UserSpendRow }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  return (
    <div>
      <p>{fmt.cny(props.row.topup_paid)}</p>
      {props.row.subscription_paid > 0 && (
        <p className='text-muted-foreground text-xs'>
          {t('Plans {{amount}}', {
            amount: fmt.cny(props.row.subscription_paid),
          })}
        </p>
      )}
    </div>
  )
}

function Balance(props: { value: number }) {
  const fmt = useInsightsFormat()
  return (
    <span className={cn(props.value < 0 && 'text-destructive')}>
      {fmt.cny(props.value)}
    </span>
  )
}
