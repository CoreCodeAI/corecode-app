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

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { TONES, useInsightsFormat, type SourceState } from '../lib'
import type { UpstreamAccount, UpstreamPool, UpstreamRunway } from '../types'
import {
  formatDays,
  runwayAccounts,
  runwayTone,
  type RunwayTone,
} from '../upstream-runway'
import { Panel } from './shared'

const BORDERS: Record<RunwayTone, string> = {
  default: '',
  good: '',
  warning: 'border-amber-500/50',
  danger: 'border-destructive/60',
}

const BARS: Record<RunwayTone, string> = {
  default: 'bg-primary/60',
  good: 'bg-primary/60',
  warning: 'bg-amber-500/70',
  danger: 'bg-destructive/70',
}

/** The last days' spend as small bars, the tallest as high as the box. */
function SpendBars(props: { values: number[]; tone: RunwayTone }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const peak = Math.max(...props.values, 0)
  if (props.values.length === 0 || peak <= 0) return null
  return (
    <ul
      role='list'
      aria-label={t('Spend per day, oldest first')}
      className='mt-2 flex h-8 items-end gap-1'
    >
      {props.values
        .map((value, index) => ({
          value,
          // Days back from the latest slot: the slots are a fixed week.
          key: props.values.length - index,
        }))
        .map(({ value, key }) => (
          <li
            key={key}
            title={fmt.usd(value)}
            className='flex h-full flex-1 items-end'
          >
            <div
              className={cn('w-full rounded-sm', BARS[props.tone])}
              style={{ height: `${Math.max((value / peak) * 100, 4)}%` }}
            />
          </li>
        ))}
    </ul>
  )
}

function Stat(props: { label: string; value: string; hint?: string }) {
  return (
    <div className='min-w-0'>
      <dt className='text-muted-foreground text-[11px]'>{props.label}</dt>
      <dd
        className='truncate text-[13px] font-semibold tabular-nums sm:text-sm'
        title={props.hint}
      >
        {props.value}
      </dd>
    </div>
  )
}

function AccountCard(props: { account: UpstreamAccount }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const account = props.account
  const tone = runwayTone(account.days_left)
  const measured = account.days_left != null
  let basis = t(
    'No bill is read for this account, so there is no spend to divide by'
  )
  if (account.basis === 'request') {
    basis = t(
      'The upstream’s own bill per request, last {{days}} 24-hour blocks',
      {
        days: account.daily.length || 7,
      }
    )
  } else if (account.basis === 'day') {
    basis = t('The supplier’s day totals, last {{days}} whole days', {
      days: account.daily.length || 7,
    })
  }
  return (
    <li className={cn('bg-card min-w-0 rounded-lg border p-3', BORDERS[tone])}>
      <p className='truncate text-sm font-medium' title={account.host}>
        {account.host}
      </p>
      <p
        className='text-muted-foreground truncate text-[11px]'
        title={account.names.join(', ')}
      >
        {account.names.join(' · ')}
      </p>
      <p
        className={cn('mt-2 text-2xl font-semibold tabular-nums', TONES[tone])}
      >
        {measured ? (
          <>
            {formatDays(account.days_left ?? 0)}
            <span className='text-muted-foreground ml-1 text-xs font-normal'>
              {t('days left')}
            </span>
          </>
        ) : (
          <span className='text-muted-foreground text-base font-normal'>
            {account.basis === 'none' ? '—' : t('No spend')}
          </span>
        )}
      </p>
      <dl className='mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5'>
        <Stat
          label={t('Balance')}
          value={fmt.usd(account.balance)}
          hint={t('read {{time}}', {
            time: fmt.time(account.balance_updated_at),
          })}
        />
        <Stat
          label={t('Daily spend')}
          value={account.basis === 'none' ? '—' : fmt.usd(account.daily_usd)}
          hint={basis}
        />
        <Stat
          label={t('Balance read')}
          value={fmt.time(account.balance_updated_at)}
        />
        <Stat
          label={t('Spent in {{days}} days', {
            days: account.daily.length || 7,
          })}
          value={account.basis === 'none' ? '—' : fmt.usd(account.spent_usd)}
          hint={basis}
        />
      </dl>
      <SpendBars values={account.daily} tone={tone} />
    </li>
  )
}

function PoolCard(props: { pool: UpstreamPool }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const pool = props.pool
  return (
    <li className='bg-card min-w-0 rounded-lg border border-dashed p-3'>
      <p className='truncate text-sm font-medium' title={pool.name}>
        {pool.name}
      </p>
      <p className='text-muted-foreground text-[11px]'>{t('Claude pool')}</p>
      <p className='mt-2 text-2xl font-semibold tabular-nums'>
        {fmt.usd(pool.balance)}
        <span className='text-muted-foreground ml-1 text-xs font-normal'>
          {t('left this week')}
        </span>
      </p>
      <p className='text-muted-foreground mt-2 text-[11px]'>
        {t('read {{time}}', { time: fmt.time(pool.balance_updated_at) })}
      </p>
    </li>
  )
}

/**
 * How long each upstream account's balance lasts at its last week's spend: one
 * card per account, fewest days first, red under three days and yellow under
 * seven. The Claude pool's remainder is in reference cost, not money, so it is
 * listed apart with no days.
 */
export function UpstreamRunwayCards(props: {
  data: UpstreamRunway | undefined
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const accounts = runwayAccounts(props.data)
  const pools = props.data?.pools ?? []
  const failed = !props.data && props.source?.status === 'error'
  const loading = !props.data && !failed
  if (props.data && accounts.length === 0 && pools.length === 0) return null
  return (
    <Panel
      title={t('How long the balances last')}
      description={
        props.data
          ? t(
              'Balance over the average daily spend of the last {{days}} days.',
              {
                days: props.data.days,
              }
            )
          : undefined
      }
      error={
        failed ? (props.source?.error ?? t('Could not be read')) : undefined
      }
      help={t(
        'One card per upstream account; channels that draw on the same account count once, on the freshest balance read. Spend is what the upstream itself billed, not what we charged. Under 3 days is red, under 7 yellow. The Claude pool’s figure is its weekly remainder in reference cost, so it has no days.'
      )}
    >
      {loading && (
        <div className='grid grid-cols-2 gap-2 xl:grid-cols-4'>
          <Skeleton className='h-36 w-full' />
          <Skeleton className='h-36 w-full' />
        </div>
      )}
      {props.data && (
        <ul
          role='list'
          aria-label={t('Upstream accounts')}
          className='grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4'
        >
          {accounts.map((account) => (
            <AccountCard key={account.host} account={account} />
          ))}
          {pools.map((pool) => (
            <PoolCard key={pool.channel} pool={pool} />
          ))}
        </ul>
      )}
      {props.data && (
        <p className='text-muted-foreground mt-2 text-[11px]'>
          {t('Read {{time}}', { time: fmt.time(props.data.at) })}
        </p>
      )}
    </Panel>
  )
}
