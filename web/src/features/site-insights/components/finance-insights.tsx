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

import type { Finding } from '../analysis'
import {
  financeDrivers,
  financeRange,
  giftShareHigh,
  giftWatch,
  groupRows,
  orderFunnels,
  ordersComparable,
  planBookTotals,
  signed,
  UNPAID_CREDIT_WARN,
  type GroupRow,
  type OrderFunnelRow,
} from '../finance-analysis'
import {
  GIFT_SHARE_WARN,
  joinSentences,
  MIN_CHECKOUTS,
  previousBeforeLogs,
  tableState,
  TONES,
  useInsightsDefinitions,
  useInsightsFormat,
  type InsightsRangeInfo,
  type InsightsSources,
  type InsightsTab,
  type SourceState,
  paymentMethodLabel,
} from '../lib'
import type { FinanceInsights, PlanBookRow } from '../types'
import { Drivers, Findings, type DriverRow } from './insight-kit'
import { MetricGrid, Panel, SimpleTable } from './shared'

const DRIVER_ROWS = 5

/**
 * What moved against the previous period: new-api's charge by model and
 * the money paid by payment method, each part's change largest first.
 */
export function FinanceDriversPanel(props: {
  data: FinanceInsights | undefined
  previous?: FinanceInsights
  /** The previous period's read: a failure is named, not left blank. */
  previousSource?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  if (
    props.data &&
    !props.previous &&
    props.previousSource?.status === 'error'
  ) {
    return (
      <Panel
        title={t('What moved')}
        error={
          props.previousSource.error ??
          t('The previous period could not be read, so nothing is compared.')
        }
      >
        <p className='text-muted-foreground text-xs'>
          {t('The previous period could not be read, so nothing is compared.')}
        </p>
      </Panel>
    )
  }
  if (!props.data || !props.previous) return null
  const drivers = financeDrivers(props.data, props.previous)
  if (!drivers) return null
  const share = (part: number, total: number) =>
    total !== 0 && Math.sign(part) === Math.sign(total)
      ? fmt.pct(part / total)
      : undefined
  const models: DriverRow[] = drivers.models
    .slice(0, DRIVER_ROWS)
    .map((part) => ({
      key: part.key,
      label: part.key,
      change: signed(part.change, fmt.cny),
      share: share(part.change, drivers.consumption.change),
    }))
  const methods: DriverRow[] = drivers.methods
    .slice(0, DRIVER_ROWS)
    .map((part) => ({
      key: part.key,
      label: paymentMethodLabel(part.key, t),
      change: signed(part.change, fmt.cny),
      share: share(part.change, drivers.revenue.change),
      tone: part.change < 0 ? 'warning' : 'good',
    }))
  const fewOrders = !ordersComparable(props.data.orders, props.previous.orders)
  return (
    <Panel
      title={t('What moved')}
      help={t(
        'Each part’s change against the previous period of the same length, largest first, with its share of the total change. Consumption is new-api’s charge at list price by model, root and staff included, in yuan. Revenue is the money paid by payment method.'
      )}
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        <Drivers
          title={t('Consumption {{change}}, by model', {
            change: signed(drivers.consumption.change, fmt.cny),
          })}
          rows={models}
          empty={t('No change in consumption')}
        />
        <div className='grid content-start gap-1'>
          <Drivers
            title={t('Revenue {{change}}, by payment method', {
              change: signed(drivers.revenue.change, fmt.cny),
            })}
            rows={methods}
            empty={t('No change in revenue')}
          />
          {fewOrders && (
            <p className='text-muted-foreground text-xs'>
              {t('Only {{before}} → {{now}} orders: too few to read a trend.', {
                before: fmt.num(props.previous.orders),
                now: fmt.num(props.data.orders),
              })}
            </p>
          )}
        </div>
      </div>
    </Panel>
  )
}

/**
 * Whether given credit is leaking: its share of what customers consumed,
 * and the unpaid credit issued for each yuan of paid credit, with their
 * change and where to look.
 */
export function GiftWatchPanel(props: {
  data: FinanceInsights | undefined
  previous?: FinanceInsights
  /** The page's range, for whether the previous period predates the logs. */
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const failed = !props.data && props.source?.status === 'error'
  const signupRead = props.data?.checkin_credit_usd != null
  const now = giftWatch(props.data)
  const before = props.previous ? giftWatch(props.previous) : undefined
  // A previous period wholly before the logs has nothing to compare with.
  const noPrevious =
    !!props.data &&
    previousBeforeLogs(
      financeRange(props.data, props.range),
      props.data.logs_since
    )
  const ratioHigh =
    now.unpaidPerPaid != null && now.unpaidPerPaid > UNPAID_CREDIT_WARN
  const findings: Finding[] = []
  if (giftShareHigh(now)) {
    findings.push({
      key: 'gift-share',
      tone: 'warning',
      title: t('Gifted credit is {{share}} of customers’ consumption.', {
        share: fmt.pct(now.giftShare ?? 0),
      }),
      detail: t(
        'Given plans, bonuses and codes are being used faster than paid credit. See which sign-ups and sources they went to.'
      ),
      tab: 'growth',
      impact: props.data?.gift_consumption_usd ?? 0,
    })
  }
  if (ratioHigh) {
    findings.push({
      key: 'unpaid-credit',
      tone: 'warning',
      title: t('{{amount}} of unpaid credit was issued for each ¥1 paid.', {
        amount: fmt.cny(now.unpaidPerPaid ?? 0),
      }),
      detail: t(
        'Bonuses, redemption codes, commission and manual additions. Check which promotion channel issued them.'
      ),
      tab: 'channels',
      impact: now.unpaid,
    })
  }
  return (
    <Panel
      title={t('Gift watch')}
      error={
        failed ? (props.source?.error ?? t('Could not be read')) : undefined
      }
      help={
        signupRead
          ? t(
              'Gifted share is the gifted part of customers’ consumption (given plans and the unpaid share of each wallet) over all of it, root and staff left out; under ¥100 of consumption it is not judged. Unpaid credit per paid is top-up bonus, redemption codes, referral commission, net manual additions, check-in credit and sign-up and invitee bonuses (those two estimated at today’s settings) issued in the range, over the top-up credit customers paid for. Amber past 30% and 50%.'
            )
          : t(
              'Gifted share is the gifted part of customers’ consumption (given plans and the unpaid share of each wallet) over all of it, root and staff left out; under ¥100 of consumption it is not judged. Unpaid credit per paid is bonus, redemption codes, referral commission and net manual additions issued in the range, over the top-up credit customers paid for. Amber past 30% and 50%.'
            )
      }
    >
      <div className='grid gap-4'>
        <MetricGrid
          loading={!props.data && !failed}
          items={[
            {
              missing: failed,
              label: t('Gifted share of consumption'),
              value: now.giftShare == null ? '-' : fmt.pct(now.giftShare),
              tone: giftShareHigh(now) ? 'warning' : 'default',
              delta:
                now.giftShare == null
                  ? undefined
                  : {
                      current: now.giftShare,
                      previous: before?.giftShare ?? undefined,
                      better: 'down',
                      points: true,
                      missing: noPrevious,
                    },
              hint:
                now.giftShare == null
                  ? t('Too little consumption to judge')
                  : t('Amber past {{share}}', {
                      share: fmt.pct(GIFT_SHARE_WARN),
                    }),
            },
            {
              missing: failed,
              label: t('Unpaid credit per ¥1 paid'),
              value:
                now.unpaidPerPaid == null ? '-' : fmt.cny(now.unpaidPerPaid),
              tone: ratioHigh ? 'warning' : 'default',
              delta:
                now.unpaidPerPaid == null
                  ? undefined
                  : {
                      current: now.unpaidPerPaid,
                      previous: before?.unpaidPerPaid ?? undefined,
                      better: 'down',
                      missing: noPrevious,
                    },
              hint:
                now.unpaidPerPaid == null
                  ? t('No paid top-up credit in this range')
                  : t('{{unpaid}} unpaid issued', {
                      unpaid: fmt.cny(now.unpaid),
                    }),
            },
          ]}
        />
        <Findings items={findings} onOpen={props.onOpen} />
      </div>
    </Panel>
  )
}

/** The error a panel shows when its source failed and there is nothing to draw. */
function failedText(
  source: SourceState | undefined,
  data: unknown,
  fallback: string
): string | undefined {
  if (data != null || source?.status !== 'error') return undefined
  return source.error ?? fallback
}

/**
 * Checkouts by payment method: how many were opened, paid, failed, expired
 * and left pending past an hour, and the share completed, against the same
 * method's previous period. Hidden on a server that does not send them.
 */
export function OrdersPanel(props: {
  data: FinanceInsights | undefined
  previous?: FinanceInsights
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  if (data && data.order_methods == null) return null
  const rows = data
    ? orderFunnels(data.order_methods, props.previous?.order_methods)
    : undefined
  const fell = (rows ?? []).filter((row) => row.fell)
  const stale = (rows ?? []).reduce((sum, row) => sum + row.pending_stale, 0)
  const method = (key: string) => paymentMethodLabel(key, t)
  const description = joinSentences(
    ...fell.map((row) =>
      t(
        'Checkouts by {{method}} completed {{now}}, down from {{before}}: check the payment page.',
        {
          method: method(row.payment_method),
          now: fmt.pct(row.completion_rate),
          before: fmt.pct(row.previousRate ?? 0),
        }
      )
    ),
    stale > 0 &&
      t(
        '{{count}} checkouts are still pending more than an hour after they opened.',
        { count: fmt.num(stale) }
      )
  )
  return (
    <Panel
      title={t('Checkouts by payment method')}
      error={failedText(props.sources?.view, data, t('Could not be read'))}
      description={description || undefined}
      help={t(
        'Checkouts opened in the range, top-ups and plan orders, by payment method; wallet-paid plans are left out. Completed is paid over opened. Most unpaid checkouts are abandoned, so a rate is judged only against the same method in the previous period: amber when it fell to half or less, over at least 5 checkouts in both. Under 10 checkouts a rate is not colored. Some gateways never close an unpaid checkout, so pending past an hour is their only failure signal.'
      )}
    >
      <SimpleTable
        rows={rows}
        rowKey={(row) => row.payment_method}
        empty={t('No checkouts in this range')}
        state={tableState(props.sources?.view, rows)}
        faded={(row) => !row.judged}
        columns={[
          {
            key: 'method',
            label: t('Payment Method'),
            render: (row) => method(row.payment_method),
          },
          {
            key: 'created',
            label: t('Opened'),
            align: 'right',
            render: (row) => fmt.num(row.created),
          },
          {
            key: 'paid',
            label: t('Paid'),
            align: 'right',
            render: (row) =>
              `${fmt.num(row.paid)} · ${fmt.cny(row.paid_money)}`,
          },
          {
            key: 'failed',
            label: t('Failed or expired'),
            align: 'right',
            render: (row) => fmt.num(row.failed + row.expired),
          },
          {
            key: 'pending',
            label: t('Pending past an hour'),
            align: 'right',
            render: (row) => (
              <span
                className={row.pending_stale > 0 ? TONES.warning : undefined}
              >
                {fmt.num(row.pending_stale)}
              </span>
            ),
          },
          {
            key: 'rate',
            label: t('Completed'),
            hint: t('Paid over opened, with the previous period’s rate.'),
            align: 'right',
            render: (row: OrderFunnelRow) => (
              <span
                className={row.judged && row.fell ? TONES.warning : undefined}
              >
                {fmt.pct(row.completion_rate)}
                {row.previousRate != null && (
                  <span className='text-muted-foreground text-xs'>
                    {' '}
                    ({fmt.pct(row.previousRate)})
                  </span>
                )}
              </span>
            ),
          },
        ]}
      />
      {rows &&
        rows.length > 0 &&
        rows.every((row) => row.created < MIN_CHECKOUTS) && (
          <p className='text-muted-foreground mt-2 text-xs'>
            {t('Too few checkouts to judge a completion rate.')}
          </p>
        )}
    </Panel>
  )
}

/**
 * The plan book: per plan, how many run now, what sold, renewed, was given
 * and ran out in the range, what ends within a week, and how much of its
 * quota finished plans used. Hidden on a server that does not send it.
 */
export function PlanBookPanel(props: {
  data: FinanceInsights | undefined
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const defs = useInsightsDefinitions()
  const data = props.data
  if (data && data.plan_book == null) return null
  const rows = data?.plan_book ?? undefined
  const totals = rows ? planBookTotals(rows) : undefined
  return (
    <Panel
      title={t('Plan book')}
      error={failedText(props.sources?.view, data, t('Could not be read'))}
      description={
        totals && rows && rows.length > 0
          ? t(
              '{{running}} paid plans running now, {{deferred}} not yet earned; {{sold}} sold in the range for {{value}}, {{renewed}} of them renewals; {{expiring}} end within 7 days ({{expiringValue}}).',
              {
                running: fmt.num(totals.runningPaid),
                deferred: fmt.cny(totals.deferred),
                sold: fmt.num(totals.sold),
                value: fmt.cny(totals.soldValue),
                renewed: fmt.num(totals.renewed),
                expiring: fmt.num(totals.expiring),
                expiringValue: fmt.cny(totals.expiringValue),
              }
            )
          : undefined
      }
      help={joinSentences(
        t(
          'Running, not yet earned and ending within 7 days are as of now, whatever the range. Sold, renewed, given and ended count plans that started or ended in the range. A renewal is a sale to a buyer who held the same plan ending no more than 7 days before. Used is quota used over quota granted by the paid plans with a fixed total that ended in the range; plans that reset each period are not counted. Amounts are in yuan; not yet earned is each plan’s price times the share of its time still to run.'
        ),
        defs.live
      )}
    >
      <SimpleTable
        rows={rows}
        rowKey={(row) => row.plan_id}
        empty={t('No plans running or sold in this range')}
        state={tableState(props.sources?.view, rows)}
        columns={[
          {
            key: 'plan',
            label: t('Plan'),
            render: (row: PlanBookRow) => (
              <span className='flex flex-col leading-tight'>
                <span>{row.title || `#${row.plan_id}`}</span>
                <span className='text-muted-foreground text-xs'>
                  {fmt.cny(row.price)}
                </span>
              </span>
            ),
          },
          {
            key: 'running',
            label: t('Running now'),
            hint: t('Paid plans running now, with given ones after the plus.'),
            align: 'right',
            render: (row) =>
              row.running_gifted > 0
                ? `${fmt.num(row.running_paid)} + ${fmt.num(row.running_gifted)}`
                : fmt.num(row.running_paid),
          },
          {
            key: 'sold',
            label: t('Sold'),
            hint: t('Paid plans started in the range, renewals in brackets.'),
            align: 'right',
            render: (row) =>
              `${fmt.num(row.sold)} (${fmt.num(row.renewed)}) · ${fmt.cny(row.sold_value)}`,
          },
          {
            key: 'gifted',
            label: t('Given'),
            align: 'right',
            render: (row) => fmt.num(row.gifted),
          },
          {
            key: 'expired',
            label: t('Ended'),
            align: 'right',
            render: (row) => fmt.num(row.expired),
          },
          {
            key: 'expiring',
            label: t('Ending in 7 days'),
            align: 'right',
            render: (row) =>
              row.expiring_7d > 0
                ? `${fmt.num(row.expiring_7d)} · ${fmt.cny(row.expiring_7d_value)}`
                : fmt.num(0),
          },
          {
            key: 'deferred',
            label: t('Not yet earned'),
            align: 'right',
            render: (row) => fmt.cny(row.deferred_value),
          },
          {
            key: 'used',
            label: t('Used'),
            hint: t(
              'Quota used by the finished paid plans with a fixed total, with how many there were.'
            ),
            align: 'right',
            render: (row) =>
              row.finished_plans > 0
                ? `${fmt.pct(row.finished_used_share)} (${fmt.num(row.finished_plans)})`
                : '-',
          },
        ]}
      />
    </Panel>
  )
}

/**
 * Customers' use by the group each request was billed in, with each
 * group's share and its change against the previous period. Hidden on a
 * server that does not send it.
 */
export function GroupConsumptionPanel(props: {
  data: FinanceInsights | undefined
  previous?: FinanceInsights
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const defs = useInsightsDefinitions()
  const data = props.data
  if (data && data.groups == null) return null
  const rows: GroupRow[] | undefined = data
    ? groupRows(data.groups, props.previous?.groups)
    : undefined
  const top = rows?.[0]
  const name = (group: string) => group || t('Not recorded')
  const points = (value: number) =>
    t('{{change}} pt', {
      change: `${value > 0 ? '+' : ''}${fmt.num(Math.round(value * 1000) / 10)}`,
    })
  return (
    <Panel
      title={t('Use by group')}
      error={failedText(props.sources?.view, data, t('Could not be read'))}
      description={
        top
          ? t('{{group}} takes {{share}} of customers’ consumption.', {
              group: name(top.group),
              share: fmt.pct(top.share),
            })
          : undefined
      }
      help={joinSentences(
        t(
          'Each group the requests were billed in, customers only. Consumption is after the group’s ratio; at list price divides it by today’s ratio, so a group sold cheaper shows how much use it carried. Change is in percentage points of share against the previous period. Requests logged before groups were recorded show as not recorded.'
        ),
        defs.listCharge,
        t(
          'Revenue (est.) is consumption’s pro-rata share of the range’s revenue earned: an estimate, not a margin, since the data has no cost by group.'
        )
      )}
    >
      <SimpleTable
        rows={rows}
        rowKey={(row) => row.group}
        empty={t('No consumption in this range')}
        state={tableState(props.sources?.view, rows)}
        columns={[
          {
            key: 'group',
            label: t('Group'),
            render: (row) => (
              <span className='flex flex-col leading-tight'>
                <span>{name(row.group)}</span>
                {row.ratio > 0 && (
                  <span className='text-muted-foreground text-xs'>
                    {fmt.multiple(row.ratio)}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'usd',
            label: t('Consumption'),
            align: 'right',
            render: (row) =>
              `${fmt.cny(row.consumption_usd)} · ${fmt.pct(row.share)}`,
          },
          {
            key: 'change',
            label: t('Change'),
            hint: t(
              'Share of consumption against the previous period, in percentage points.'
            ),
            align: 'right',
            render: (row) =>
              row.shareChange == null ? '-' : points(row.shareChange),
          },
          {
            key: 'list',
            label: t('At list price'),
            align: 'right',
            render: (row) => (row.list_usd > 0 ? fmt.cny(row.list_usd) : '-'),
          },
          {
            key: 'requests',
            label: t('Requests'),
            align: 'right',
            render: (row) => fmt.num(row.requests),
          },
          {
            key: 'users',
            label: t('Users'),
            align: 'right',
            render: (row) => fmt.num(row.users),
          },
          {
            key: 'rev',
            label: t('Revenue (est.)'),
            hint: t(
              'Consumption’s pro-rata share of revenue earned, an estimate, not a margin.'
            ),
            align: 'right',
            render: (row) => fmt.cny(row.revenue_estimate),
          },
        ]}
      />
    </Panel>
  )
}
