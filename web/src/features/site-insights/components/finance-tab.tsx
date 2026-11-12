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

import {
  bestWholeDay,
  bucketBeforeLogs,
  financeHours,
  financeRange,
  peakHour,
} from '../finance-analysis'
import {
  joinSentences,
  paymentSlices,
  previousBeforeLogs,
  rangeHours,
  tableState,
  useHourAxis,
  useInsightsDefinitions,
  useInsightsFormat,
  type InsightsRangeInfo,
  type InsightsSources,
  type InsightsTab,
  paymentMethodLabel,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type { BusinessInsights, FinanceInsights } from '../types'
import { useFinanceVerdict } from '../verdicts'
import { ModelMixPanel, VendorMarginPanel } from './business-panels'
import {
  FinanceDriversPanel,
  GiftWatchPanel,
  GroupConsumptionPanel,
  OrdersPanel,
  PlanBookPanel,
} from './finance-insights'
import { FinanceSummary } from './finance-summary'
import { StaleNote } from './insight-kit'
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
  businessPrevious?: BusinessInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  /** Where each query stands, so a figure still loading or failed is not read as zero. */
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const defs = useInsightsDefinitions()
  const hourAxis = useHourAxis()
  const partialDay = usePartialDays('finance')
  const data = props.data
  const previous = props.previous
  const range = financeRange(data, props.range)
  const logsSince = data?.logs_since
  // A previous period wholly before the logs has no data: nothing is
  // compared with it, so the verdict and the drivers see none.
  const comparable =
    previous && !previousBeforeLogs(range, logsSince) ? previous : undefined
  const verdict = useFinanceVerdict(props.data, comparable)
  const view = props.sources?.view
  const failed = !data && view?.status === 'error'
  const failedText = failed
    ? (view?.error ?? t('Could not be read'))
    : undefined
  const hours = financeHours(data, range)
  const daily = data?.daily ?? []
  // Partial days at either end of the range are never the best day.
  const best = bestWholeDay(daily, data?.start_time, data?.end_time)
  const peak = hours ? peakHour(hours, range.end) : undefined
  let chartNote: string | undefined
  if (peak) {
    chartNote = t('Peak hour {{hour}}: {{amount}}.', {
      hour: fmt.time(peak.hour),
      amount: fmt.cny(peak.topup + peak.subscription),
    })
  } else if (!hours && best) {
    chartNote = t('Best day {{day}}: {{amount}}.', {
      day: fmt.day(best.day),
      amount: fmt.cny(best.topup + best.subscription),
    })
  }
  const revenueSeries = [
    { label: t('Top-ups'), format: fmt.cny, compact: fmt.cnyCompact },
    { label: t('Subscriptions'), format: fmt.cny },
  ]
  // Check-in, sign-up and invitee credit arrive with the server's release;
  // without it the panel keeps its five rows.
  const signupRead = data?.checkin_credit_usd != null
  const issuedRows: [string, number, string][] = [
    [
      t('Top-up credit'),
      data?.topup_credit_usd ?? 0,
      t('Credit customers paid for in a top-up, ¥1 for each.'),
    ],
    [
      t('Top-up bonus'),
      data?.bonus_usd ?? 0,
      t(
        'Credit added free on top of a top-up. Spending it counts in the gifted part of consumption, and it lowers the average price paid per quota dollar, so revenue earned stays right.'
      ),
    ],
    [
      t('Redemption codes'),
      data?.redemption_usd ?? 0,
      t('Credit from redeemed codes.'),
    ],
    [
      t('Referral commission'),
      data?.commission_usd ?? 0,
      t(
        'Commission inviters earned in the range, whether or not they have moved it into a wallet yet.'
      ),
    ],
    [
      t('Manual adjustments (net)'),
      data?.adjustment_net_usd ?? 0,
      t(
        'Balance an administrator added, less what one took away, over the whole range from the audit log. Root and staff wallets included.'
      ),
    ],
  ]
  if (signupRead) {
    issuedRows.push(
      [
        t('Check-in credit'),
        data?.checkin_credit_usd ?? 0,
        t('Credit awarded for daily check-ins in the range.'),
      ],
      [
        t('Sign-up bonus (est.)'),
        data?.signup_credit_estimate_usd ?? 0,
        t('{{count}} sign-up bonuses times today’s bonus: an estimate.', {
          count: fmt.num(data?.signup_bonuses ?? 0),
        }),
      ],
      [
        t('Invitee bonus (est.)'),
        data?.invitee_credit_estimate_usd ?? 0,
        t('{{count}} invitee bonuses times today’s bonus: an estimate.', {
          count: fmt.num(data?.invitee_bonuses ?? 0),
        }),
      ]
    )
  }
  const issued = issuedRows.reduce((sum, row) => sum + row[1], 0)
  return (
    <div className='grid gap-4'>
      <Verdict
        loading={!props.data && !failed}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text ?? failedText}
      />
      <StaleNote
        staleHours={data?.stale_hours}
        rangeHours={rangeHours(range)}
      />
      <FinanceSummary
        data={data}
        previous={previous}
        range={range}
        source={view}
      />

      <FinanceDriversPanel
        data={data}
        previous={comparable}
        previousSource={props.sources?.previous}
      />

      <VendorMarginPanel data={data} range={range} source={view} />

      <VendorTabs data={data} />

      <ModelMixPanel data={props.business} source={props.sources?.business} />

      <GroupConsumptionPanel
        data={data}
        previous={comparable}
        sources={props.sources}
      />

      <PlanBookPanel data={data} sources={props.sources} />

      <Panel
        title={hours ? t('Hourly revenue paid') : t('Daily revenue paid')}
        description={chartNote}
        error={failedText}
        help={joinSentences(
          t(
            'The bars are revenue paid, top-ups and plans, in yuan. Consumption at list price, root and staff’s internal use included, reads out on each bar, and by the day revenue earned too.'
          ),
          defs.paidRevenue
        )}
      >
        {!failed && hours && (
          <BarSeries
            ariaLabel={t('Hourly revenue')}
            series={revenueSeries}
            points={hourAxis.bars(
              hours,
              range.end,
              (hour) => ({
                values: [hour.topup, hour.subscription],
                extra: [
                  {
                    label: t('Consumed at list price'),
                    value: fmt.cny(
                      hour.consumption_usd + hour.root_consumption_usd
                    ),
                  },
                ],
              }),
              logsSince
            )}
          />
        )}
        {!failed && !hours && (
          <BarSeries
            ariaLabel={t('Daily revenue')}
            series={revenueSeries}
            points={daily.map((day) => ({
              key: day.day,
              title: fmt.day(day.day),
              values: [day.topup, day.subscription],
              partial: partialDay(day.day, [day.topup, day.subscription]),
              missing: bucketBeforeLogs(day.day, 'day', logsSince),
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
        )}
      </Panel>

      <GiftWatchPanel
        data={data}
        previous={previous}
        range={range}
        onOpen={props.onOpen}
        source={view}
      />

      <OrdersPanel data={data} previous={comparable} sources={props.sources} />

      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel
          title={t('Wallet credit issued')}
          error={failedText}
          help={
            signupRead
              ? t(
                  'Credit added to customers’ wallets in the range, in yuan, by where it came from. Only top-up credit was paid for. Sign-up and invitee bonuses are counts times today’s settings, so estimates.'
                )
              : t(
                  'Credit added to customers’ wallets in the range, in yuan, by where it came from. Only top-up credit was paid for.'
                )
          }
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
            {issuedRows.map(([label, value, help]) => (
              <div key={label} className='flex justify-between gap-2'>
                <dt className='text-muted-foreground'>
                  <HelpLabel label={label} help={help} />
                </dt>
                <dd className='tabular-nums'>{data ? fmt.cny(value) : '-'}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title={t('By payment method')}>
          {!failed && (
            <ShareDonut
              loading={!data}
              slices={paymentSlices(data?.methods, (method) =>
                paymentMethodLabel(method, t)
              )}
              format={fmt.cny}
              ariaLabel={t('Revenue by payment method')}
              totalLabel={t('Revenue paid')}
              empty={t('No successful orders in this range')}
            />
          )}
          <div className='mt-4' />
          <SimpleTable
            rows={data?.methods}
            rowKey={(row) => row.payment_method}
            empty={t('No successful orders in this range')}
            state={tableState(view, data?.methods)}
            columns={[
              {
                key: 'method',
                label: t('Payment Method'),
                render: (row) => paymentMethodLabel(row.payment_method, t),
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
            state={tableState(view, data?.top_balances)}
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
          description={
            data?.adjustments_truncated && data.adjustments_total != null
              ? t('Showing the newest {{shown}} of {{total}}.', {
                  shown: fmt.num(data.adjustments.length),
                  total: fmt.num(data.adjustments_total),
                })
              : undefined
          }
        >
          <SimpleTable
            rows={data?.adjustments}
            rowKey={(row, index) => `${row.created_at}-${index}`}
            empty={t('No manual adjustments in this range')}
            state={tableState(view, data?.adjustments)}
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
            state={tableState(view, data?.debtors)}
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

      <UserSpendPanel onOpen={props.onOpen} />
    </div>
  )
}
