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

import type { Finding } from '../analysis'
import {
  financeDrivers,
  giftShareHigh,
  giftWatch,
  ordersComparable,
  signed,
  UNPAID_CREDIT_WARN,
} from '../finance-analysis'
import { GIFT_SHARE_WARN, useInsightsFormat, type InsightsTab } from '../lib'
import type { FinanceInsights } from '../types'
import { Drivers, Findings, type DriverRow } from './insight-kit'
import { MetricGrid, Panel } from './shared'

const DRIVER_ROWS = 5

/**
 * What moved against the previous period: new-api's charge by model and
 * the money paid by payment method, each part's change largest first.
 */
export function FinanceDriversPanel(props: {
  data: FinanceInsights | undefined
  previous?: FinanceInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
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
      label: getPaymentMethodName(part.key, t) || part.key,
      change: signed(part.change, fmt.cny),
      share: share(part.change, drivers.revenue.change),
      tone: part.change < 0 ? 'warning' : 'good',
    }))
  const fewOrders = !ordersComparable(props.data.orders, props.previous.orders)
  return (
    <Panel
      title={t('What moved')}
      help={t(
        'Each part’s change against the previous period of the same length, largest first, with its share of the total change. Consumption is new-api’s charge at list price by model, root included, in yuan. Revenue is the money paid by payment method.'
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
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const now = giftWatch(props.data)
  const before = props.previous ? giftWatch(props.previous) : undefined
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
      help={t(
        'Gifted share is the gifted part of customers’ consumption (given plans and the unpaid share of each wallet) over all of it, root left out; under ¥100 of consumption it is not judged. Unpaid credit per paid is bonus, redemption codes, referral commission and net manual additions issued in the range, over the top-up credit customers paid for. Amber past 30% and 50%.'
      )}
    >
      <div className='grid gap-4'>
        <MetricGrid
          loading={!props.data}
          items={[
            {
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
                    },
              hint:
                now.giftShare == null
                  ? t('Too little consumption to judge')
                  : t('Amber past {{share}}', {
                      share: fmt.pct(GIFT_SHARE_WARN),
                    }),
            },
            {
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
