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

import { Badge } from '@/components/ui/badge'

import {
  useInsightsFormat,
  useSharedAddresses,
  useSignupMethodLabel,
} from '../lib'
import type { RiskInsights } from '../types'
import {
  BarSeries,
  Breakdown,
  MetricGrid,
  Panel,
  SimpleTable,
  UserLabel,
  type Tone,
} from './shared'

export function RiskTab(props: {
  data: RiskInsights | undefined
  previous?: RiskInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const methodLabel = useSignupMethodLabel()
  const data = props.data
  const previous = props.previous
  const clusters = useSharedAddresses(data)
  const repeatBuyers = clusters.some(
    (cluster) => cluster.subscription_buyers > 1
  )
  let sharedTone: Tone = clusters.length > 0 ? 'warning' : 'default'
  if (repeatBuyers) sharedTone = 'danger'
  const zeroShare = (insights: RiskInsights | undefined) =>
    insights?.signups ? insights.zero_use_accounts / insights.signups : 0
  const pointTitle = (at: number) =>
    data?.series_unit === 'day' ? fmt.day(at) : fmt.time(at)

  return (
    <div className='grid gap-4'>
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Sign-ups'),
            featured: true,
            value: fmt.num(data?.signups ?? 0),
            delta: {
              current: data?.signups ?? 0,
              previous: previous?.signups,
              better: 'neutral',
            },
            trend: (data?.signup_series ?? []).map((point) => ({
              title: pointTitle(point.at),
              value: point.count,
            })),
            hint: data?.peak_signups.count
              ? t('Busiest {{unit}}: {{count}} at {{time}}', {
                  unit: data.series_unit === 'day' ? t('day') : t('hour'),
                  count: fmt.num(data.peak_signups.count),
                  time: fmt.time(data.peak_signups.at),
                })
              : undefined,
          },
          {
            label: t('Never sent a request'),
            value: fmt.num(data?.zero_use_accounts ?? 0),
            hint: data?.signups ? fmt.pct(zeroShare(data)) : undefined,
            delta: {
              current: zeroShare(data),
              previous: previous ? zeroShare(previous) : undefined,
              better: 'down',
              points: true,
            },
          },
          {
            label: t('Alias emails'),
            value: fmt.num(data?.alias_emails ?? 0),
            tone: (data?.alias_emails ?? 0) > 0 ? 'warning' : 'default',
          },
          {
            label: t('Off the domain allowlist'),
            value: fmt.num(data?.off_whitelist ?? 0),
            tone: (data?.off_whitelist ?? 0) > 0 ? 'warning' : 'default',
          },
          {
            label: t('Shared addresses'),
            value: fmt.num(clusters.length),
            hint: repeatBuyers ? t('One has several plan buyers') : undefined,
            tone: sharedTone,
          },
        ]}
      />

      <Panel title={t('Sign-ups over time')}>
        <BarSeries
          ariaLabel={t('Sign-ups over time')}
          series={[{ label: t('Sign-ups') }]}
          points={(data?.signup_series ?? []).map((point) => ({
            key: point.at,
            title: pointTitle(point.at),
            axis:
              data?.series_unit === 'hour' &&
              new Date(point.at * 1000).getHours() === 0
                ? fmt.day(point.at)
                : undefined,
            values: [point.count],
          }))}
        />
      </Panel>

      <Panel
        title={t('Accounts sharing an address')}
        description={
          data &&
          (clusters.length
            ? t('{{count}} addresses are shared by several accounts.', {
                count: clusters.length,
              })
            : undefined)
        }
        help={t(
          'Addresses several accounts sent requests or signed in from: one person with several accounts, a shared machine, or a reseller. Several plan buyers on one address suggest repeated trial purchases.'
        )}
      >
        {clusters.length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            {t('No address is shared in this range')}
          </p>
        ) : (
          <ul className='grid gap-3'>
            {clusters.map((cluster) => (
              <li
                key={cluster.ip}
                className='min-w-0 rounded-md border px-4 py-3'
              >
                <div className='mb-2 flex flex-wrap items-center gap-2 text-sm'>
                  <span className='font-mono'>{cluster.ip}</span>
                  <Badge variant='outline'>
                    {t('{{count}} accounts', { count: cluster.users.length })}
                  </Badge>
                  {cluster.subscription_buyers > 1 && (
                    <Badge variant='destructive'>
                      {t('{{count}} plan buyers', {
                        count: cluster.subscription_buyers,
                      })}
                    </Badge>
                  )}
                  <span className='text-muted-foreground text-xs'>
                    {t('{{count}} requests', { count: cluster.requests })}
                  </span>
                </div>
                <SimpleTable
                  rows={cluster.users}
                  rowKey={(row) => row.user_id}
                  empty=''
                  columns={[
                    {
                      key: 'user',
                      label: t('User'),
                      render: (row) => <UserLabel {...row} />,
                    },
                    {
                      key: 'created',
                      label: t('Registered'),
                      render: (row) => fmt.time(row.created_at),
                    },
                    {
                      key: 'flags',
                      label: t('Has paid'),
                      render: (row) =>
                        [
                          row.paid && t('Topped up'),
                          row.subscription && t('Plan'),
                        ]
                          .filter(Boolean)
                          .join(' · ') || '-',
                    },
                    {
                      key: 'req',
                      label: t('Requests'),
                      align: 'right',
                      render: (row) => fmt.num(row.requests),
                    },
                    {
                      key: 'bal',
                      label: t('Balance'),
                      align: 'right',
                      render: (row) => fmt.usd(row.balance_usd),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel title={t('Sign-up method')}>
          <Breakdown
            items={data?.signup_methods}
            label={methodLabel}
            empty={t('No sign-ups in this range')}
          />
        </Panel>
        <Panel title={t('Email domains')}>
          <SimpleTable
            rows={data?.email_domains}
            rowKey={(row) => row.domain}
            empty={t('No sign-ups in this range')}
            columns={[
              {
                key: 'domain',
                label: t('Domain'),
                render: (row) => (
                  <span
                    className={
                      row.whitelisted
                        ? undefined
                        : 'text-amber-600 dark:text-amber-400'
                    }
                  >
                    {row.domain}
                  </span>
                ),
              },
              {
                key: 'n',
                label: t('Accounts'),
                align: 'right',
                render: (row) => row.count,
              },
            ]}
          />
        </Panel>
        <Panel title={t('Negative balances')}>
          <SimpleTable
            rows={data?.debtors}
            rowKey={(row) => row.user_id}
            empty={t('No customer owes money')}
            columns={[
              {
                key: 'user',
                label: t('User'),
                render: (row) => <UserLabel {...row} />,
              },
              {
                key: 'b',
                label: t('Balance'),
                align: 'right',
                render: (row) => fmt.usd(row.balance_usd),
              },
            ]}
          />
        </Panel>
      </div>
    </div>
  )
}
