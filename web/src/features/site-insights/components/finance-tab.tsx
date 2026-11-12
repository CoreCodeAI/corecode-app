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

import { getPaymentMethodName } from '@/features/wallet/lib/billing'

import { paymentSlices, useInsightsFormat } from '../lib'
import { usePartialDays } from '../partial-days'
import type { BusinessInsights, FinanceInsights } from '../types'
import { useFinanceVerdict } from '../verdicts'
import { ModelMixPanel, VendorMarginPanel } from './business-panels'
import { FinanceSummary } from './finance-summary'
import { ShareDonut } from './share-donut'
import {
  BarSeries,
  HelpLabel,
  Panel,
  SimpleTable,
  UserLabel,
  Verdict,
} from './shared'
import { UserSpendPanel } from './user-spend'
import { VendorTabs } from './vendor-usage'

export function FinanceTab(props: {
  data: FinanceInsights | undefined
  previous?: FinanceInsights
  /** Read for the revenue by model, which moved here from its own tab. */
  business?: BusinessInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('finance')
  const verdict = useFinanceVerdict(props.data, props.previous)
  const data = props.data
  const previous = props.previous
  const daily = data?.daily ?? []
  const best = daily.reduce<(typeof daily)[number] | undefined>(
    (top, day) =>
      !top || day.topup + day.subscription > top.topup + top.subscription
        ? day
        : top,
    undefined
  )
  const issued = [
    data?.topup_credit_usd ?? 0,
    data?.bonus_usd ?? 0,
    data?.redemption_usd ?? 0,
    data?.commission_usd ?? 0,
    data?.adjustment_net_usd ?? 0,
  ].reduce((sum, value) => sum + value, 0)
  return (
    <div className='grid gap-4'>
      <Verdict
        loading={!props.data}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
      />
      <FinanceSummary data={data} previous={previous} />

      <VendorMarginPanel data={data} />

      <VendorTabs data={data} />

      <ModelMixPanel data={props.business} />

      <Panel
        title={t('Daily revenue and consumption')}
        description={
          best && best.topup + best.subscription > 0
            ? t('Best day {{day}}: {{amount}}.', {
                day: fmt.day(best.day),
                amount: fmt.cny(best.topup + best.subscription),
              })
            : undefined
        }
        help={t(
          'Revenue is the money paid, in yuan. Consumption is new-api credit used at list price, in yuan, root’s internal use included.'
        )}
      >
        <BarSeries
          ariaLabel={t('Daily revenue')}
          series={[
            { label: t('Top-ups'), format: fmt.cny, compact: fmt.cnyCompact },
            { label: t('Subscriptions'), format: fmt.cny },
          ]}
          points={daily.map((day) => ({
            key: day.day,
            title: fmt.day(day.day),
            values: [day.topup, day.subscription],
            partial: partialDay(day.day, [day.topup, day.subscription]),
            extra: [
              {
                label: t('Revenue earned'),
                value: fmt.cny(day.recognized_revenue ?? 0),
              },
              {
                label: t('Consumed at list price'),
                value: fmt.cny(
                  day.consumption_usd + (day.root_consumption_usd ?? 0)
                ),
              },
            ],
          }))}
        />
      </Panel>

      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel
          title={t('Wallet credit issued')}
          help={t(
            'Credit added to customers’ wallets in the range, in yuan, by where it came from. Only top-up credit was paid for.'
          )}
          description={
            data && issued > 0
              ? t('{{total}} in all; manual adjustments are {{share}}.', {
                  total: fmt.cny(issued),
                  share: fmt.pct((data.adjustment_net_usd ?? 0) / issued),
                })
              : undefined
          }
        >
          <dl className='grid gap-2 text-sm'>
            {[
              [
                t('Top-up credit'),
                fmt.cny(data?.topup_credit_usd ?? 0),
                t('Credit customers paid for in a top-up, ¥1 for each.'),
              ],
              [
                t('Top-up bonus'),
                fmt.cny(data?.bonus_usd ?? 0),
                t('Credit added on top of a top-up, unpaid.'),
              ],
              [
                t('Redemption codes'),
                fmt.cny(data?.redemption_usd ?? 0),
                t('Credit from redeemed codes.'),
              ],
              [
                t('Referral commission'),
                fmt.cny(data?.commission_usd ?? 0),
                t('Referral rewards moved into a wallet.'),
              ],
              [
                t('Manual adjustments (net)'),
                fmt.cny(data?.adjustment_net_usd ?? 0),
                t(
                  'Balance an administrator added, less what one took away, from the audit log. Root’s own wallet included.'
                ),
              ],
            ].map(([label, value, help]) => (
              <div key={label} className='flex justify-between gap-2'>
                <dt className='text-muted-foreground'>
                  <HelpLabel label={label} help={help} />
                </dt>
                <dd className='tabular-nums'>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title={t('By payment method')}>
          <ShareDonut
            loading={!data}
            slices={paymentSlices(
              data?.methods,
              (method) => getPaymentMethodName(method, t) || method
            )}
            format={fmt.cny}
            ariaLabel={t('Revenue by payment method')}
            totalLabel={t('Revenue')}
            empty={t('No successful orders in this range')}
          />
          <div className='mt-4' />
          <SimpleTable
            rows={data?.methods}
            rowKey={(row) => row.payment_method}
            empty={t('No successful orders in this range')}
            columns={[
              {
                key: 'method',
                label: t('Payment Method'),
                render: (row) =>
                  getPaymentMethodName(row.payment_method, t) ||
                  row.payment_method,
              },
              {
                key: 'count',
                label: t('Orders'),
                align: 'right',
                render: (row) => row.count,
              },
              {
                key: 'money',
                label: t('Amount'),
                align: 'right',
                render: (row) => fmt.cny(row.money),
              },
            ]}
          />
        </Panel>
        <Panel title={t('Largest balances')}>
          <SimpleTable
            rows={data?.top_balances}
            rowKey={(row) => row.user_id}
            empty={t('No customer balances')}
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
                render: (row) => fmt.cny(row.balance_usd),
              },
            ]}
          />
        </Panel>
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel
          title={t('Manual balance adjustments')}
          help={t(
            'From the audit log: who changed whose balance, and by how much.'
          )}
        >
          <SimpleTable
            rows={data?.adjustments}
            rowKey={(row, index) => `${row.created_at}-${index}`}
            empty={t('No manual adjustments in this range')}
            columns={[
              {
                key: 'at',
                label: t('Time'),
                render: (row) => fmt.time(row.created_at),
              },
              {
                key: 'op',
                label: t('Operator'),
                render: (row) => row.operator,
              },
              {
                key: 'target',
                label: t('User'),
                render: (row) => <UserLabel {...row.target} />,
              },
              {
                key: 'delta',
                label: t('Change'),
                align: 'right',
                render: (row) => {
                  if (!row.success) return t('Failed')
                  if (!row.has_snapshot) {
                    return `${row.mode} ${fmt.cny(row.request_usd)}`
                  }
                  return `${fmt.cny(row.before_usd)} → ${fmt.cny(row.after_usd)}`
                },
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
                render: (row) => fmt.cny(row.balance_usd),
              },
            ]}
          />
        </Panel>
      </div>

      <UserSpendPanel />
    </div>
  )
}
