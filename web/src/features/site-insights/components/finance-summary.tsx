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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { isOpenHour } from '../analysis'
import {
  balanceRunway,
  financeHours,
  financeRange,
  ordersComparable,
  owedNow,
  RUNWAY_WARN_DAYS,
  signed,
} from '../finance-analysis'
import {
  DEBT_ALERT_USD,
  joinSentences,
  TONES,
  useChargeFormat,
  useInsightsDefinitions,
  useInsightsFormat,
  type InsightsRangeInfo,
  type SourceState,
} from '../lib'
import type { FinanceInsights } from '../types'
import {
  DeltaBadge,
  HelpLabel,
  Panel,
  Sparkline,
  type MetricDelta,
  type Tone,
  type TrendPoint,
} from './shared'

/**
 * new-api's credit, in yuan: customers pay ¥1 for each quota dollar, so
 * the quota dollars the server reports are yuan. Root's own requests are
 * internal use, counted with everyone's and as given: nobody pays for them.
 */
function creditTotals(data: FinanceInsights | undefined) {
  const root = data?.root_consumption_usd ?? 0
  const customers = data?.consumption_usd ?? 0
  const consumed = customers + root
  const gifted = data?.gift_consumption_usd ?? 0
  const paid = customers - gifted
  const earned = data?.recognized_revenue ?? 0
  return {
    consumed,
    paid,
    gifted,
    root,
    // Customers on both sides: earned revenue leaves root out, so root's
    // internal use stays out of the yuan it is divided by.
    earnedPerYuan: customers > 0 ? earned / customers : 0,
    paidPerYuan: paid > 0 ? earned / paid : 0,
    cashPerYuan: customers > 0 ? (data?.revenue ?? 0) / customers : 0,
  }
}

/**
 * The funds view's headline, in two ledgers. Cash is the money customers
 * paid. Credit is what new-api holds in yuan: what was used and what is
 * still owed. Each credit figure also reads in dollars, the unit new-api's
 * charge is compared with gpt-load's cost in.
 */
export function FinanceSummary(props: {
  data: FinanceInsights | undefined
  previous?: FinanceInsights
  range?: InsightsRangeInfo
  /** The funds view's read: a failure shows - rather than zero. */
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const defs = useInsightsDefinitions()
  const data = props.data
  const previous = props.previous
  const charge = useChargeFormat(data)
  const credit = creditTotals(data)
  const before = previous ? creditTotals(previous) : undefined
  const missing = !data && props.source?.status === 'error'
  const loading = !data && !missing
  const owed = owedNow(data)
  const dollars = (yuan: number) => `≈ ${fmt.usd(charge.toUSD(yuan))}`
  const range = financeRange(data, props.range)
  const hours = financeHours(data, range)

  // A day split at the viewer's midnight is two partial days on a short
  // range: there the cash trend reads by the hour, the open one marked.
  const cashTrend: TrendPoint[] = hours
    ? hours.map((hour) => ({
        title: isOpenHour(hour.hour, range.end)
          ? t('{{time}} (in progress)', { time: fmt.time(hour.hour) })
          : fmt.time(hour.hour),
        value: hour.topup + hour.subscription,
      }))
    : (data?.daily ?? []).map((day) => ({
        title: fmt.day(day.day),
        value: day.topup + day.subscription,
      }))

  // Over a handful of orders a percentage is noise: the change reads as an
  // amount with the order counts instead.
  const fewOrders =
    !!data && !!previous && !ordersComparable(data.orders, previous.orders)
  let revenueNote: string | undefined
  if (fewOrders && data && previous) {
    revenueNote = t('{{amount}} on {{before}} → {{now}} orders', {
      amount: signed(data.revenue - previous.revenue, fmt.cny),
      before: fmt.num(previous.orders),
      now: fmt.num(data.orders),
    })
  }

  const runway = balanceRunway(data, range.days)
  let runwayNote: string | undefined
  if (runway != null) {
    runwayNote = t(
      'Covers {{days}} days of customers’ paid use at this range’s pace.',
      { days: fmt.num(Math.round(runway)) }
    )
  } else if (data && data.liability_usd > 0) {
    runwayNote = t('No paid use in this range to measure a runway against.')
  }

  let balanceTone: Tone = 'default'
  if ((data?.debt_usd ?? 0) < DEBT_ALERT_USD) {
    balanceTone = 'danger'
  } else if (runway != null && runway > RUNWAY_WARN_DAYS) {
    balanceTone = 'warning'
  }

  return (
    <TooltipProvider delay={150}>
      <div className='grid gap-4 xl:grid-cols-5'>
        <Panel
          className='xl:col-span-2'
          title={t('Cash')}
          description={t('Money customers paid, in yuan.')}
          error={
            missing
              ? (props.source?.error ?? t('Could not be read'))
              : undefined
          }
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <Stat
              loading={loading}
              missing={missing}
              label={t('Revenue paid')}
              help={joinSentences(
                defs.paidRevenue,
                t(
                  'In yuan: wallet top-ups and plans. Credit given away brings in nothing. Revenue earned, beside it, is what the range earned of all money paid.'
                )
              )}
              value={fmt.cny(data?.revenue ?? 0)}
              delta={
                fewOrders
                  ? undefined
                  : {
                      current: data?.revenue ?? 0,
                      previous: previous?.revenue,
                      better: 'up',
                    }
              }
              sub={revenueNote}
              trend={cashTrend}
              trendFormat={fmt.cny}
              trendBars={!!hours}
              hint={t(
                '{{orders}} orders · {{users}} payers · top-ups {{topup}} · plans {{plans}}',
                {
                  orders: data?.orders ?? 0,
                  users: data?.paying_users ?? 0,
                  topup: fmt.cny(data?.topup_revenue ?? 0),
                  plans: fmt.cny(data?.subscription_revenue ?? 0),
                }
              )}
            />
            <Stat
              loading={loading}
              missing={missing}
              label={t('Revenue earned')}
              help={defs.earnedRevenue}
              value={fmt.cny(data?.recognized_revenue ?? 0)}
              delta={{
                current: data?.recognized_revenue ?? 0,
                previous: previous?.recognized_revenue,
                better: 'up',
              }}
              trend={
                hours
                  ? undefined
                  : (data?.daily ?? []).map((day) => ({
                      title: fmt.day(day.day),
                      value: day.recognized_revenue ?? 0,
                    }))
              }
              trendFormat={fmt.cny}
              trendBars
              hint={t('Wallets {{wallet}} · plans {{plans}}', {
                wallet: fmt.cny(data?.recognized_wallet_revenue ?? 0),
                plans: fmt.cny(data?.recognized_subscription_revenue ?? 0),
              })}
            />
          </div>
        </Panel>

        <Panel
          className='xl:col-span-3'
          title={t('new-api credit')}
          error={
            missing
              ? (props.source?.error ?? t('Could not be read'))
              : undefined
          }
          description={t(
            'In yuan: customers pay ¥1 for each credit dollar. ≈ is in dollars at ¥{{rate}} to the dollar, the unit compared with gpt-load.',
            { rate: fmt.num(charge.rate) }
          )}
        >
          <div className='grid gap-4 sm:grid-cols-3'>
            <Stat
              loading={loading}
              missing={missing}
              label={t('Consumed at list price')}
              help={joinSentences(
                defs.listCharge,
                t(
                  'Every request new-api charged in the range at list price, root’s internal use included. Paid is what customers’ payments cover; gifted is given plans and the unpaid share of each wallet; root’s is internal use, which nobody pays for.'
                )
              )}
              value={fmt.cny(credit.consumed)}
              sub={dollars(credit.consumed)}
              delta={{
                current: credit.consumed,
                previous: before?.consumed,
                better: 'neutral',
              }}
              parts={[
                { label: t('Paid part'), value: credit.paid },
                { label: t('Gifted part'), value: credit.gifted },
                { label: t('Root (internal)'), value: credit.root },
              ]}
            />
            <Stat
              loading={loading}
              missing={missing}
              label={t('Earned per ¥1 consumed')}
              help={t(
                'Revenue earned divided by customers’ consumption, root’s internal use left out on both sides: what each yuan customers used earned. Paid use divides by the paid part only: the price customers actually paid. Cash basis divides the revenue paid in the range instead, which swings with when customers pay.'
              )}
              value={fmt.cny(credit.earnedPerYuan)}
              delta={{
                current: credit.earnedPerYuan,
                previous: before?.earnedPerYuan,
                better: 'up',
              }}
              hint={t('Paid use {{paid}} · cash basis {{cash}}', {
                paid: fmt.cny(credit.paidPerYuan),
                cash: fmt.cny(credit.cashPerYuan),
              })}
            />
            <Stat
              loading={loading}
              missing={missing}
              label={t('Balances owed')}
              help={joinSentences(
                t(
                  'Credit customers hold now and can still spend, in yuan. Deferred revenue is what they paid for it at each wallet’s price, money taken but not yet earned; the rest was given. Root’s balance is internal and not counted. The runway is the balance over customers’ paid use per day in this range. Red when debt passes the alert line; amber when the balance covers more than 60 days of paid use, money owed back in use or refunds that the current pace takes over two months to earn.'
                ),
                owed &&
                  t(
                    'Running paid plans also owe the share of their price whose time has not run yet, and the quota they still hold; owed in all is that plus the wallets’ deferred revenue.'
                  ),
                defs.live
              )}
              value={fmt.cny(data?.liability_usd ?? 0)}
              sub={dollars(data?.liability_usd ?? 0)}
              tone={balanceTone}
              hint={
                <>
                  {t(
                    '{{count}} customers · deferred revenue {{paid}} · debt {{debt}}',
                    {
                      count: data?.liability_users ?? 0,
                      paid: fmt.cny(data?.liability_paid_value ?? 0),
                      debt: fmt.cny(Math.abs(data?.debt_usd ?? 0)),
                    }
                  )}
                  {owed && (
                    <span className='block'>
                      {t(
                        'Plans {{plans}} not yet run on {{count}} paid plans, {{quota}} of quota left · owed in all {{total}}',
                        {
                          plans: fmt.cny(owed.plans),
                          count: fmt.num(owed.paidPlans),
                          quota: fmt.cny(owed.planQuotaLeft),
                          total: fmt.cny(owed.total),
                        }
                      )}
                    </span>
                  )}
                </>
              }
              note={runwayNote}
            />
          </div>
        </Panel>
      </div>
    </TooltipProvider>
  )
}

const PART_COLORS = ['bg-primary', 'bg-sky-500', 'bg-muted-foreground/50']

/**
 * One headline figure in a ledger: its value and change, the dollars it
 * comes to, its trend, and either a hint or the parts it is made of, drawn
 * as a bar.
 */
function Stat(props: {
  label: string
  help?: string
  value: string
  sub?: string
  delta?: MetricDelta
  tone?: Tone
  trend?: TrendPoint[]
  trendFormat?: (value: number) => string
  /** Draws the trend as a bar per day, for amounts settled each day. */
  trendBars?: boolean
  hint?: ReactNode
  /** A line read with the figure's tone, such as what explains its color. */
  note?: ReactNode
  parts?: { label: string; value: number }[]
  loading: boolean
  /** The source failed: a muted - and nothing that reads as a value. */
  missing?: boolean
}) {
  const fmt = useInsightsFormat()
  const total = (props.parts ?? []).reduce(
    (sum, part) => sum + Math.max(0, part.value),
    0
  )
  if (props.missing) {
    return (
      <dl className='flex min-w-0 flex-col gap-1'>
        <dt className='text-muted-foreground text-xs'>
          <HelpLabel label={props.label} help={props.help} />
        </dt>
        <dd className='text-muted-foreground text-2xl font-semibold'>-</dd>
      </dl>
    )
  }
  return (
    <dl className='flex min-w-0 flex-col gap-1'>
      <dt className='text-muted-foreground text-xs'>
        <HelpLabel label={props.label} help={props.help} />
      </dt>
      <dd className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
        {props.loading ? (
          <Skeleton className='h-8 w-24' />
        ) : (
          <>
            <span
              className={cn(
                'text-2xl font-semibold tabular-nums',
                TONES[props.tone ?? 'default']
              )}
            >
              {props.value}
            </span>
            {props.delta && <DeltaBadge delta={props.delta} />}
          </>
        )}
      </dd>
      {props.sub && !props.loading && (
        <dd className='text-muted-foreground -mt-1 text-xs tabular-nums'>
          {props.sub}
        </dd>
      )}
      {props.trend && !props.loading && (
        <dd className='-mx-0.5'>
          <Sparkline
            points={props.trend}
            format={props.trendFormat ?? fmt.num}
            label={props.label}
            bars={props.trendBars}
          />
        </dd>
      )}
      {props.parts && total > 0 && !props.loading && (
        <dd className='mt-1 grid gap-1.5'>
          <div className='bg-muted flex h-1.5 overflow-hidden rounded-full'>
            {props.parts.map((part, index) => (
              <span
                key={part.label}
                className={PART_COLORS[index]}
                style={{ width: `${(Math.max(0, part.value) / total) * 100}%` }}
              />
            ))}
          </div>
          <ul className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums'>
            {props.parts.map((part, index) => (
              <li key={part.label} className='flex items-center gap-1'>
                <span
                  aria-hidden
                  className={cn('size-1.5 rounded-full', PART_COLORS[index])}
                />
                {part.label} {fmt.cny(part.value)}
              </li>
            ))}
          </ul>
        </dd>
      )}
      {props.hint != null && (
        <dd className='text-muted-foreground text-xs'>{props.hint}</dd>
      )}
      {props.note != null && !props.loading && (
        <dd className={cn('text-xs', TONES[props.tone ?? 'default'])}>
          {props.note}
        </dd>
      )}
    </dl>
  )
}
