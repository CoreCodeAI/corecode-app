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

import {
  clientFamilies,
  joinSentences,
  MARGIN_VENDORS,
  SMALL_SAMPLE,
  useChargeFormat,
  useInsightsFormat,
  useVendorName,
  vendorMargins,
} from '../lib'
import type { BusinessInsights, FinanceInsights } from '../types'
import {
  Breakdown,
  MetricGrid,
  Panel,
  SimpleTable,
  UserLabel,
  type Tone,
} from './shared'

const MARGIN_TONES: Record<Tone, string> = {
  default: '',
  good: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
}

/**
 * Gross margin by vendor: what each vendor's models earned against what its
 * accounts cost over the range, with one sentence that says where the money
 * is made and lost.
 */
export function VendorMarginPanel(props: {
  data: FinanceInsights | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.data)
  const name = useVendorName()
  const data = props.data
  const rows = data ? vendorMargins(data, charge.rate) : []
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const cost = rows.reduce((sum, row) => sum + row.cost, 0)
  const margin = revenue - cost
  const scale = Math.max(
    ...rows.map((row) => Math.max(row.revenue, row.cost)),
    1
  )
  const losing = rows.filter((row) => row.margin < 0 && row.cost > 0)
  const unpriced = rows.filter((row) => row.unpriced > 0)
  const tone = (value: number, base: number): Tone => {
    if (value < 0) return 'danger'
    if (base > 0 && value / base < 0.2) return 'warning'
    return 'good'
  }

  const sentence = data
    ? joinSentences(
        t(
          'Earned {{revenue}} against {{cost}} of accounts: gross margin {{margin}} ({{rate}}).',
          {
            revenue: fmt.cny(revenue),
            cost: fmt.cny(cost),
            margin: fmt.cny(margin),
            rate: revenue > 0 ? fmt.pct(margin / revenue) : '-',
          }
        ),
        ...losing.map((row) =>
          t('{{vendor}} loses {{amount}}.', {
            vendor: name(row.vendor),
            amount: fmt.cny(-row.margin),
          })
        ),
        unpriced.length > 0 &&
          t(
            'No price is recorded for the {{vendors}} accounts; they count as free.',
            {
              vendors: unpriced.map((row) => name(row.vendor)).join(t(', ')),
            }
          )
      )
    : undefined

  return (
    <Panel
      title={t('Gross margin by vendor')}
      description={sentence}
      help={t(
        'Revenue is the revenue earned in the range (what customers’ use and running plans earned), shared out by each vendor’s part of customers’ list-price consumption; root’s own use is left out. Revenue per list-price dollar is not known by model, so each vendor earns the site’s average: an estimate. Cost is the monthly price of every account in the pool now, over the range’s days, at the site’s exchange rate; accounts without a recorded price count as free. Payment fees are not counted.'
      )}
    >
      {!data && (
        <div className='grid gap-3'>
          {MARGIN_VENDORS.slice(0, 3).map((vendor) => (
            <Skeleton key={vendor} className='h-12 w-full' />
          ))}
        </div>
      )}
      {data && rows.length === 0 && (
        <p className='text-muted-foreground text-xs'>
          {t('No consumption in this range')}
        </p>
      )}
      {data && rows.length > 0 && (
        <ul className='grid gap-3'>
          {rows.map((row) => {
            const rowTone = tone(row.margin, row.revenue)
            return (
              <li
                key={row.vendor}
                className='grid gap-x-4 gap-y-1.5 sm:grid-cols-[8rem_1fr_auto] sm:items-center'
              >
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium'>
                    {name(row.vendor)}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {row.unpriced > 0
                      ? t('{{count}} accounts, {{unpriced}} unpriced', {
                          count: row.accounts,
                          unpriced: row.unpriced,
                        })
                      : t('{{count}} accounts', { count: row.accounts })}
                  </p>
                </div>
                <div
                  className='grid gap-1'
                  aria-label={t(
                    '{{vendor}}: earned {{revenue}}, cost {{cost}}',
                    {
                      vendor: name(row.vendor),
                      revenue: fmt.cny(row.revenue),
                      cost: fmt.cny(row.cost),
                    }
                  )}
                  role='img'
                >
                  <div className='bg-muted h-2 overflow-hidden rounded-full'>
                    <div
                      className='bg-primary h-full rounded-full'
                      style={{ width: `${(row.revenue / scale) * 100}%` }}
                    />
                  </div>
                  <div className='bg-muted h-2 overflow-hidden rounded-full'>
                    <div
                      className='h-full rounded-full bg-amber-500'
                      style={{ width: `${(row.cost / scale) * 100}%` }}
                    />
                  </div>
                </div>
                <dl className='grid grid-cols-3 gap-3 text-right text-xs tabular-nums sm:w-80'>
                  <div>
                    <dt className='text-muted-foreground'>{t('Earned')}</dt>
                    <dd className='text-sm'>{fmt.cny(row.revenue)}</dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('Account cost')}
                    </dt>
                    <dd className='text-sm'>{fmt.cny(row.cost)}</dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('Gross margin')}
                    </dt>
                    <dd
                      className={cn(
                        'text-sm font-semibold',
                        MARGIN_TONES[rowTone]
                      )}
                    >
                      {fmt.cny(row.margin)}
                      {row.revenue > 0 && (
                        <span className='text-muted-foreground ml-1 text-xs font-normal'>
                          {fmt.pct(row.margin / row.revenue)}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            )
          })}
        </ul>
      )}
      {data && rows.length > 0 && (
        <p className='text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs'>
          <span className='inline-flex items-center gap-1.5'>
            <span className='bg-primary size-2 rounded-full' />
            {t('Earned')}
          </span>
          <span className='inline-flex items-center gap-1.5'>
            <span className='size-2 rounded-full bg-amber-500' />
            {t('Account cost')}
          </span>
        </p>
      )}
    </Panel>
  )
}

/** A share drawn as a bar under its figure. */
function ShareBar(props: { label: string; share: number }) {
  return (
    <span className='inline-grid w-28 gap-1 text-right'>
      <span>{props.label}</span>
      <span className='bg-muted h-1 overflow-hidden rounded-full'>
        <span
          className='bg-primary/70 block h-full rounded-full'
          style={{ width: `${Math.min(props.share, 1) * 100}%` }}
        />
      </span>
    </span>
  )
}

/** Each model's consumption, its share and the revenue it is credited with. */
export function ModelMixPanel(props: { data: BusinessInsights | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  const top = data?.models?.[0]
  return (
    <Panel
      title={t('Revenue by model')}
      description={
        top
          ? t('{{model}} takes {{share}} of consumption.', {
              model: top.model,
              share: fmt.pct(top.share),
            })
          : undefined
      }
      help={t(
        'Revenue is allocated to models by their share of list-price consumption; it is an estimate. Models with under 100 requests are faded.'
      )}
    >
      <SimpleTable
        rows={data?.models}
        rowKey={(row) => row.model}
        faded={(row) => row.requests < SMALL_SAMPLE}
        empty={t('No consumption in this range')}
        columns={[
          {
            key: 'model',
            label: t('Model'),
            render: (row) => (
              <span className='font-mono text-xs'>{row.model}</span>
            ),
          },
          {
            key: 'usd',
            label: t('Consumption'),
            align: 'right',
            render: (row) => (
              <ShareBar
                label={`${fmt.usd(row.quota_usd)} · ${fmt.pct(row.share)}`}
                share={row.share}
              />
            ),
          },
          {
            key: 'rev',
            label: t('Revenue (est.)'),
            align: 'right',
            render: (row) => fmt.cny(row.revenue_estimate),
          },
          {
            key: 'per',
            label: t('Per request'),
            align: 'right',
            render: (row) => fmt.usd(row.per_request_usd),
          },
          {
            key: 'users',
            label: t('Users'),
            align: 'right',
            render: (row) => fmt.num(row.users),
          },
        ]}
      />
    </Panel>
  )
}

/**
 * What referrals bring: invitees' payments and use against the commission
 * paid for them, then each inviter's return.
 */
export function ReferralPanel(props: {
  data: BusinessInsights | undefined
  previous?: BusinessInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  const previous = props.previous
  // Commission is credit, sold at ¥1 a dollar, so it compares with yuan paid.
  const returned =
    data && data.commission_usd > 0
      ? data.invitee_payments / data.commission_usd
      : null
  const share =
    data && data.revenue > 0 ? data.invitee_payments / data.revenue : 0
  return (
    <Panel
      title={t('Referrals')}
      description={
        data
          ? joinSentences(
              t('Invitees paid {{payments}}, {{share}} of revenue.', {
                payments: fmt.cny(data.invitee_payments),
                share: fmt.pct(share),
              }),
              returned != null &&
                t('Commission of {{commission}} returned {{times}}×.', {
                  commission: fmt.usd(data.commission_usd),
                  times: fmt.num(Math.round(returned * 10) / 10),
                })
            )
          : undefined
      }
      help={t(
        'Invitees are users signed up through an inviter’s link. Their payments are money paid in the range; their consumption is credit used at list price. Commission is credit given to inviters, sold at ¥1 a dollar, so the return is payments over commission.'
      )}
    >
      <div className='grid gap-4'>
        <MetricGrid
          loading={!data}
          items={[
            {
              label: t('Invitee payments'),
              featured: true,
              value: fmt.cny(data?.invitee_payments ?? 0),
              delta: {
                current: data?.invitee_payments ?? 0,
                previous: previous?.invitee_payments,
                better: 'up',
              },
              hint: t('{{inviters}} inviters brought {{invitees}} invitees', {
                inviters: fmt.num(data?.inviters ?? 0),
                invitees: fmt.num(data?.invitees ?? 0),
              }),
            },
            {
              label: t('Invitee consumption'),
              value: fmt.usd(data?.invitee_spend_usd ?? 0),
              delta: {
                current: data?.invitee_spend_usd ?? 0,
                previous: previous?.invitee_spend_usd,
                better: 'up',
              },
            },
            {
              label: t('Commission credited'),
              value: fmt.usd(data?.commission_usd ?? 0),
              hint: t('{{rate}} of invitee consumption', {
                rate: fmt.pct(data?.commission_to_spend ?? 0),
              }),
              help: t('Colored above 30%, where commission eats the margin.'),
              tone:
                (data?.commission_to_spend ?? 0) > 0.3 ? 'warning' : 'default',
            },
            {
              label: t('Payments ÷ commission'),
              value:
                returned == null
                  ? '-'
                  : `${fmt.num(Math.round(returned * 10) / 10)}×`,
              help: t(
                'Yuan invitees paid for each dollar of commission; commission is sold at ¥1 a dollar, so under 1× it costs more than it brings.'
              ),
              tone: returned != null && returned < 1 ? 'danger' : 'default',
            },
          ]}
        />
        <SimpleTable
          rows={data?.top_inviters}
          rowKey={(row) => row.user_id}
          empty={t('No referrals')}
          columns={[
            {
              key: 'user',
              label: t('Inviter'),
              render: (row) => <UserLabel {...row} />,
            },
            {
              key: 'inv',
              label: t('Invitees (active)'),
              align: 'right',
              render: (row) => `${row.invitees} (${row.active_invitees})`,
            },
            {
              key: 'pay',
              label: t('Invitee payments'),
              align: 'right',
              render: (row) => fmt.cny(row.payments),
            },
            {
              key: 'spend',
              label: t('Invitee consumption'),
              align: 'right',
              render: (row) => fmt.usd(row.spend_usd),
            },
            {
              key: 'com',
              label: t('Commission'),
              align: 'right',
              render: (row) => fmt.usd(row.commission_usd),
            },
          ]}
        />
      </div>
    </Panel>
  )
}

/** Users by the group they are in. */
export function GroupsPanel(props: { data: BusinessInsights | undefined }) {
  const { t } = useTranslation()
  return (
    <Panel title={t('Users by group')}>
      <Breakdown items={props.data?.groups} empty={t('No users')} />
    </Panel>
  )
}

/** Requests by client, then by client and version. */
export function ClientsPanel(props: { data: BusinessInsights | undefined }) {
  const { t } = useTranslation()
  const clients = props.data?.clients
  return (
    <Panel
      title={t('Clients')}
      help={t(
        'Requests by client and version. Logs written before this was recorded count as unknown.'
      )}
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='grid content-start gap-2'>
          <h4 className='text-muted-foreground text-xs'>{t('By client')}</h4>
          <Breakdown
            items={clientFamilies(clients)}
            empty={t('No requests in this range')}
          />
        </div>
        <div className='grid content-start gap-2'>
          <h4 className='text-muted-foreground text-xs'>{t('By version')}</h4>
          <Breakdown
            items={clients?.slice(0, 10)}
            empty={t('No requests in this range')}
          />
        </div>
      </div>
    </Panel>
  )
}
