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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import {
  OTHER_COLOR,
  SERIES_COLORS,
  TONES,
  tableState,
  useInsightsFormat,
  type SourceState,
} from '../lib'
import type {
  ChurnWarning,
  CustomerInsights,
  CustomerProfile,
  SpendTier,
  SpendTierGroup,
  SpendTierVendor,
} from '../types'
import { ShareDonut, type ShareSlice } from './share-donut'
import { Panel, ProviderSwitch, SimpleTable, Sparkline, UserLabel } from './shared'

const DAY = 86400

/** A date with its year, in the interface language. */
function useDateFormat() {
  const { i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const format = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
  return (unix: number) => (unix > 0 ? format.format(new Date(unix * 1000)) : '-')
}

/** How the top customers' shares of spending are drawn: one bar each against the whole. */
function Concentration(props: { data: CustomerInsights }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  const rows = [
    { key: 'top5', label: t('Top {{n}} customers', { n: 5 }), share: data.top5_share, count: 5 },
    { key: 'top10', label: t('Top {{n}} customers', { n: 10 }), share: data.top10_share, count: 10 },
    { key: 'top20', label: t('Top {{n}} customers', { n: 20 }), share: data.top20_share, count: 20 },
  ]
  return (
    <ul
      className='grid gap-2 sm:grid-cols-3 sm:gap-4'
      aria-label={t('Share of consumption from the largest customers')}
    >
      {rows.map((row) => (
        <li key={row.key} className='grid gap-1'>
          <div className='flex items-baseline justify-between text-xs'>
            <span className='text-muted-foreground'>{row.label}</span>
            <span className='text-sm font-semibold tabular-nums'>
              {fmt.pct(row.share)}
            </span>
          </div>
          <div
            role='meter'
            aria-label={row.label}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={row.share}
            className='bg-muted/50 h-2 overflow-hidden rounded-full'
          >
            <div
              className={cn(
                'h-full rounded-full',
                // The five largest past 60% is the concentration the Top 3 card warns about.
                row.key === 'top5' && row.share > 0.6
                  ? 'bg-amber-500'
                  : 'bg-primary/70'
              )}
              style={{ width: `${Math.min(row.share, 1) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * The range's biggest customers: how concentrated spending is, then one row
 * each with their history, spending and what they use. Money is in quota
 * dollars (what new-api charged, which customers buy at ¥1 each) except
 * what they paid, which is in the payment currency.
 */
export function CustomersPanel(props: {
  data: CustomerInsights | undefined
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const date = useDateFormat()
  const data = props.data
  const state = tableState(props.source, data?.top) ?? (data ? undefined : 'loading')
  const now = Math.floor(Date.now() / 1000)
  const lastRequest = (row: CustomerProfile) => {
    if (row.last_used_at <= 0) return t('Never')
    const days = Math.floor((now - row.last_used_at) / DAY)
    return (
      <span title={fmt.time(row.last_used_at)}>
        {days < 1 ? t('Today') : t('{{count}} days ago', { count: days })}
      </span>
    )
  }
  return (
    <Panel
      title={t('Biggest customers')}
      id='biggest-customers'
      help={t(
        'The 20 customers who spent most in the range, staff left out. Top-ups paid is the money they paid for top-ups and, below it, for plans, in the payment currency. Lifetime, balance and range spend are quota dollars: what new-api charged, which customers buy at ¥1 each, the $ their wallet shows. The trend is each of the last seven days, counted back from now in blocks of 24 hours. The main group is the one whose key has spent the most over the account’s life. Active days are the days of the last 30 with a request.'
      )}
      error={
        !data && props.source?.status === 'error'
          ? (props.source.error ?? t('Could not be read'))
          : undefined
      }
      description={
        data && data.customers_spending > 0
          ? t('{{count}} customers spent {{total}} in the range.', {
              count: fmt.num(data.customers_spending),
              total: fmt.usd(data.total_usd),
            })
          : undefined
      }
    >
      <div className='grid gap-4'>
        {data && data.top.length > 0 && <Concentration data={data} />}
        <SimpleTable<CustomerProfile>
          rows={data?.top}
          rowKey={(row) => row.user_id}
          empty={t('No consumption in this range')}
          state={state}
          card={(row) => (
            <div className='grid gap-1.5 text-sm'>
              <div className='flex items-baseline justify-between gap-2'>
                <UserLabel user_id={row.user_id} username={row.username} />
                <span className='font-medium'>{fmt.usd(row.quota_usd)}</span>
              </div>
              {row.remark && (
                <p className='text-muted-foreground truncate text-xs'>
                  {row.remark}
                </p>
              )}
              <div className='w-full'>
                <CustomerTrend row={row} />
              </div>
              <dl className='text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs'>
                <dt>{t('Top-ups paid')}</dt>
                <dd className='text-foreground text-right'>
                  {fmt.cny(row.topup_paid)}
                </dd>
                <dt>{t('Balance')}</dt>
                <dd className='text-foreground text-right'>
                  {fmt.usd(row.balance_usd)}
                </dd>
                <dt>{t('Main model')}</dt>
                <dd className='text-foreground truncate text-right'>
                  {row.main_model || '-'}
                </dd>
                <dt>{t('Last request')}</dt>
                <dd className='text-foreground text-right'>
                  {lastRequest(row)}
                </dd>
              </dl>
            </div>
          )}
          columns={[
            {
              key: 'user',
              label: t('User'),
              render: (row) => (
                <UserLabel user_id={row.user_id} username={row.username} />
              ),
            },
            {
              key: 'remark',
              label: t('Remark'),
              render: (row) =>
                row.remark ? (
                  <span
                    className='block max-w-32 truncate'
                    title={row.remark}
                  >
                    {row.remark}
                  </span>
                ) : (
                  '-'
                ),
            },
            {
              key: 'registered',
              label: t('Registered'),
              render: (row) => date(row.registered_at),
            },
            {
              key: 'paid',
              label: t('Top-ups paid'),
              align: 'right',
              hint: t(
                'Money paid for top-ups, in the payment currency; plans bought with money are shown below it.'
              ),
              render: (row) => (
                <span className='tabular-nums'>
                  {fmt.cny(row.topup_paid)}
                  {row.subscription_paid > 0 && (
                    <span className='text-muted-foreground block text-xs'>
                      {t('plans {{amount}}', {
                        amount: fmt.cny(row.subscription_paid),
                      })}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'lifetime',
              label: t('Lifetime use'),
              align: 'right',
              render: (row) => fmt.usd(row.lifetime_usd),
            },
            {
              key: 'balance',
              label: t('Balance'),
              align: 'right',
              render: (row) => fmt.usd(row.balance_usd),
            },
            {
              key: 'range',
              label: t('Range use'),
              align: 'right',
              render: (row) => (
                <span className='tabular-nums'>
                  {fmt.usd(row.quota_usd)}
                  <span className='text-muted-foreground block text-xs'>
                    {fmt.pct(row.share)}
                  </span>
                </span>
              ),
            },
            {
              key: 'trend',
              label: t('Last 7 days'),
              render: (row) => (
                <div className='w-24'>
                  <CustomerTrend row={row} />
                </div>
              ),
            },
            {
              key: 'model',
              label: t('Main model'),
              render: (row) => (
                <span className='block max-w-36 truncate' title={row.main_model}>
                  {row.main_model || '-'}
                </span>
              ),
            },
            {
              key: 'group',
              label: t('Main group'),
              render: (row) => row.main_group || '-',
            },
            {
              key: 'last',
              label: t('Last request'),
              render: lastRequest,
            },
            {
              key: 'active',
              label: t('Active days'),
              align: 'right',
              render: (row) => `${fmt.num(row.active_days)} / 30`,
            },
          ]}
        />
      </div>
    </Panel>
  )
}

/** A customer's spend over the last seven days, oldest first. */
function CustomerTrend(props: { row: CustomerProfile }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const trend = props.row.trend
  return (
    <Sparkline
      bars
      label={t('Spend of {{name}} over the last 7 days', {
        name: props.row.username || `#${props.row.user_id}`,
      })}
      format={fmt.usd}
      points={trend.map((value, index) => ({
        title: t('{{count}} days ago', { count: trend.length - 1 - index }),
        value,
      }))}
    />
  )
}

/**
 * Customers among the month's biggest whose use has dropped off: the last seven
 * days under half the seven before, or no request in three days. The list the
 * owner acts on before a large customer is gone.
 */
export function ChurnWatchPanel(props: {
  data: CustomerInsights | undefined
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  const state = tableState(props.source, data?.churn) ?? (data ? undefined : 'loading')
  const now = Math.floor(Date.now() / 1000)
  const reason = (value: ChurnWarning['reasons'][number]) =>
    value === 'dropped' ? t('Use fell by over half') : t('No request in 3 days')
  let watchSentence: string | undefined
  if (data && data.churn.length > 0) {
    watchSentence = t('{{count}} of the {{watched}} biggest customers are slipping.', {
      count: fmt.num(data.churn.length),
      watched: fmt.num(data.watched),
    })
  } else if (data) {
    watchSentence = t('None of the {{watched}} biggest customers has dropped off.', {
      watched: fmt.num(data.watched),
    })
  }
  const change = (row: ChurnWarning) =>
    row.previous7_usd > 0
      ? fmt.pct(row.last7_usd / row.previous7_usd - 1)
      : '-'
  return (
    <Panel
      title={t('Churn watch')}
      id='churn-watch'
      help={t(
        'Among the {{count}} customers who spent most in the last 30 days, those whose last 7 days came to under half the 7 days before, or who sent no request in the last 3 days. The weeks are 24-hour blocks counted back from now. Staff are left out. Money is in quota dollars.',
        { count: data?.watched ?? 50 }
      )}
      description={watchSentence}
    >
      <SimpleTable<ChurnWarning>
        rows={data?.churn}
        rowKey={(row) => row.user_id}
        empty={t('No customer among the biggest has dropped off')}
        state={state}
        card={(row) => (
          <div className='grid gap-1 text-sm'>
            <div className='flex items-baseline justify-between gap-2'>
              <UserLabel user_id={row.user_id} username={row.username} />
              <span className={TONES.warning}>{change(row)}</span>
            </div>
            <p className='text-muted-foreground text-xs'>
              {row.reasons.map(reason).join(' · ')}
            </p>
            <p className='text-muted-foreground text-xs tabular-nums'>
              {fmt.usd(row.last7_usd)} / {fmt.usd(row.previous7_usd)}
            </p>
          </div>
        )}
        columns={[
          {
            key: 'user',
            label: t('User'),
            render: (row) => (
              <UserLabel user_id={row.user_id} username={row.username} />
            ),
          },
          {
            key: 'month',
            label: t('30 days'),
            align: 'right',
            render: (row) => fmt.usd(row.month_usd),
          },
          {
            key: 'last7',
            label: t('Last 7 days'),
            align: 'right',
            render: (row) => fmt.usd(row.last7_usd),
          },
          {
            key: 'previous7',
            label: t('The 7 days before'),
            align: 'right',
            render: (row) => fmt.usd(row.previous7_usd),
          },
          {
            key: 'change',
            label: t('Change'),
            align: 'right',
            render: (row) => (
              <span className={row.previous7_usd > 0 ? TONES.warning : ''}>
                {change(row)}
              </span>
            ),
          },
          {
            key: 'last',
            label: t('Last request'),
            render: (row) => {
              if (row.last_request_at <= 0) return t('Never')
              const days = Math.floor((now - row.last_request_at) / DAY)
              return (
                <span title={fmt.time(row.last_request_at)}>
                  {days < 1 ? t('Today') : t('{{count}} days ago', { count: days })}
                </span>
              )
            },
          },
          {
            key: 'why',
            label: t('Why'),
            render: (row) => (
              <span className='flex flex-wrap gap-1'>
                {row.reasons.map((value) => (
                  <span
                    key={value}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs',
                      TONES.warning
                    )}
                  >
                    {reason(value)}
                  </span>
                ))}
              </span>
            ),
          },
        ]}
      />
    </Panel>
  )
}

const TIER_COLORS: Record<SpendTier['tier'], string> = {
  whale: SERIES_COLORS[1],
  large: SERIES_COLORS[0],
  mid: SERIES_COLORS[2],
  tail: SERIES_COLORS[3] ?? OTHER_COLOR,
}

/**
 * Customers banded by what they spent in the range: how many there are in each
 * band and how much of the revenue each brings, for every model or one vendor.
 */
export function SpendTiersPanel(props: {
  groups: SpendTierGroup[] | null | undefined
  error?: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [vendor, setVendor] = useState<SpendTierVendor>('all')
  const groups = props.groups
  if (!groups && !props.error) return null
  const group = groups?.find((item) => item.vendor === vendor)
  const tiers = group?.tiers ?? []
  const names: Record<SpendTier['tier'], string> = {
    whale: t('Whales'),
    large: t('Large'),
    mid: t('Mid'),
    tail: t('Long tail'),
  }
  const rangeOf = (index: number) => {
    const floor = tiers[index].floor_usd
    const above = index > 0 ? tiers[index - 1].floor_usd : undefined
    if (above == null) return t('{{from}} and up', { from: fmt.usdWhole(floor) })
    if (floor <= 0) return t('Under {{to}}', { to: fmt.usdWhole(above) })
    return `${fmt.usdWhole(floor)} – ${fmt.usdWhole(above)}`
  }
  const totalUsers = tiers.reduce((sum, tier) => sum + tier.users, 0)
  const totalSpend = tiers.reduce((sum, tier) => sum + tier.quota_usd, 0)
  const slices = (pick: (tier: SpendTier) => number): ShareSlice[] =>
    tiers.map((tier) => ({
      key: tier.tier,
      label: names[tier.tier],
      value: pick(tier),
      color: TIER_COLORS[tier.tier],
    }))
  const whale = tiers.find((tier) => tier.tier === 'whale')
  const vendorLabels: Record<SpendTierVendor, string> = {
    all: t('All models'),
    claude: t('Claude'),
    gpt: t('GPT'),
    other: t('Other'),
  }
  return (
    <Panel
      title={t('Customer tiers by spend')}
      error={props.error}
      help={t(
        'Customers banded by what they spent in the range, in quota dollars: what new-api charged, which customers buy at ¥1 each, the $ their wallet shows. Whales spent $500 or more, large $100 to $500, mid $10 to $100, the long tail under $10. A vendor filter counts only that vendor’s models, so a customer sits in the band of their spend there alone. Staff are left out; a customer who spent nothing is in no band.'
      )}
      description={
        whale && totalUsers > 0 && totalSpend > 0
          ? t(
              '{{users}} whales ({{userShare}} of customers) brought {{share}} of the spend.',
              {
                users: fmt.num(whale.users),
                userShare: fmt.pct(whale.users / totalUsers),
                share: fmt.pct(whale.quota_usd / totalSpend),
              }
            )
          : undefined
      }
      actions={
        <ProviderSwitch
          ariaLabel={t('Which models to count')}
          value={vendor}
          onChange={setVendor}
          items={(['all', 'claude', 'gpt', 'other'] as const).map((key) => ({
            key,
            label: vendorLabels[key],
          }))}
        />
      }
    >
      {!groups ? null : (
      <div className='grid gap-4'>
        <div className='grid gap-4 lg:grid-cols-2'>
          <div className='grid gap-2'>
            <p className='text-muted-foreground text-xs'>
              {t('Customers by tier')}
            </p>
            <ShareDonut
              slices={slices((tier) => tier.users)}
              format={fmt.num}
              ariaLabel={t('Customers by tier')}
              totalLabel={t('Customers')}
              empty={t('No consumption in this range')}
            />
          </div>
          <div className='grid gap-2'>
            <p className='text-muted-foreground text-xs'>
              {t('Spend by tier')}
            </p>
            <ShareDonut
              slices={slices((tier) => tier.quota_usd)}
              format={fmt.usdWhole}
              ariaLabel={t('Spend by tier')}
              totalLabel={t('Spend')}
              empty={t('No consumption in this range')}
            />
          </div>
        </div>
        <SimpleTable<SpendTier>
          rows={tiers}
          rowKey={(row) => row.tier}
          empty={t('No consumption in this range')}
          columns={[
            {
              key: 'tier',
              label: t('Tier'),
              render: (row) => (
                <span className='inline-flex items-center gap-2'>
                  <span
                    aria-hidden
                    className='size-2.5 rounded-sm'
                    style={{ backgroundColor: TIER_COLORS[row.tier] }}
                  />
                  {names[row.tier]}
                </span>
              ),
            },
            {
              key: 'range',
              label: t('Spend in the range'),
              render: (row) => rangeOf(tiers.indexOf(row)),
            },
            {
              key: 'users',
              label: t('Customers'),
              align: 'right',
              render: (row) => (
                <span className='tabular-nums'>
                  {fmt.num(row.users)}
                  <span className='text-muted-foreground ml-1 text-xs'>
                    {totalUsers > 0 ? fmt.pct(row.users / totalUsers) : '-'}
                  </span>
                </span>
              ),
            },
            {
              key: 'spend',
              label: t('Spend'),
              align: 'right',
              render: (row) => (
                <span className='tabular-nums'>
                  {fmt.usd(row.quota_usd)}
                  <span className='text-muted-foreground ml-1 text-xs'>
                    {totalSpend > 0 ? fmt.pct(row.quota_usd / totalSpend) : '-'}
                  </span>
                </span>
              ),
            },
            {
              key: 'each',
              label: t('Per customer'),
              align: 'right',
              render: (row) =>
                row.users > 0 ? fmt.usd(row.quota_usd / row.users) : '-',
            },
          ]}
        />
      </div>
      )}
    </Panel>
  )
}
