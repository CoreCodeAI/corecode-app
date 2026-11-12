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

import type { Tone } from '../components/shared'
import {
  financeDrivers,
  financeMargins,
  giftShareHigh,
  giftWatch,
  orderFunnels,
  ordersComparable,
  signed,
} from '../finance-analysis'
import { useChargeFormat, useInsightsFormat, useVendorName } from '../lib'
import type { FinanceInsights } from '../types'
import { join, useChange, worse, type TabVerdict } from './shared'

export function useFinanceVerdict(
  data: FinanceInsights | undefined,
  previous: FinanceInsights | undefined
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const change = useChange()
  const charge = useChargeFormat(data)
  const vendorName = useVendorName()
  if (!data) return undefined
  const margins = financeMargins(data, charge.rate)
  const revenue = margins.revenue
  const margin = margins.margin
  const rate = margins.rate ?? 0
  const freeAccounts = margins.unpricedAccounts + margins.ungroupedAccounts
  const drivers = financeDrivers(data, previous)
  const gifts = giftWatch(data)
  const fell = orderFunnels(data.order_methods, previous?.order_methods).filter(
    (row) => row.fell
  )
  let tone: Tone = 'good'
  if (margin < 0) tone = 'danger'
  else if (rate < 0.2) tone = 'warning'
  // Accounts counted as free make the margin read high.
  if (freeAccounts > 0) tone = worse(tone, 'warning')
  if (data.debt_usd < -1) tone = worse(tone, 'warning')
  if (giftShareHigh(gifts)) tone = worse(tone, 'warning')
  if (fell.length > 0) tone = worse(tone, 'warning')
  const method = (key: string) => getPaymentMethodName(key, t) || key

  let marginText: string | null = null
  if (revenue > 0) {
    const vars = { margin: fmt.cny(margin), rate: fmt.pct(rate) }
    marginText = margins.upstreamRead
      ? t('Gross margin {{margin}} ({{rate}}).', vars)
      : t('Gross margin before upstream bills {{margin}} ({{rate}}).', vars)
  }

  const paid = (() => {
    const vars = {
      revenue: fmt.cny(data.revenue),
      earned: fmt.cny(data.recognized_revenue ?? 0),
    }
    if (!previous) return t('Paid {{revenue}}, earned {{earned}}.', vars)
    if (!ordersComparable(data.orders, previous.orders)) {
      if (data.revenue === previous.revenue) {
        return t('Paid {{revenue}}, earned {{earned}}.', vars)
      }
      return t(
        'Paid {{revenue}} ({{amount}}, {{before}} → {{now}} orders), earned {{earned}}.',
        {
          ...vars,
          amount: signed(data.revenue - previous.revenue, fmt.cny),
          before: fmt.num(previous.orders),
          now: fmt.num(data.orders),
        }
      )
    }
    const moved = change(data.revenue, previous.revenue)
    if (!moved) return t('Paid {{revenue}}, earned {{earned}}.', vars)
    const [driver] = drivers?.revenueBy ?? []
    if (driver && drivers?.revenueBy.length === 1) {
      return t(
        'Paid {{revenue}} ({{change}}, mostly {{method}} {{amount}}), earned {{earned}}.',
        {
          ...vars,
          change: moved,
          method: method(driver.key),
          amount: signed(driver.change, fmt.cny),
        }
      )
    }
    return t('Paid {{revenue}} ({{change}}), earned {{earned}}.', {
      ...vars,
      change: moved,
    })
  })()

  const consumed = (() => {
    if (!drivers) return null
    const { current, previous: before } = drivers.consumption
    if (before <= 0 || Math.abs(current / before - 1) < 0.005) return null
    const moved = change(current, before)
    if (!moved) return null
    const vars = {
      amount: fmt.cny(drivers.consumption.current),
      change: moved,
    }
    const by = drivers.consumptionBy
    const label = (key: string) =>
      by.kind === 'vendor' ? vendorName(key) : key
    const [first, second] = by.parts
    if (first && second) {
      return t(
        'Consumption {{amount}} ({{change}}), mostly {{first}} {{firstAmount}} and {{second}} {{secondAmount}}.',
        {
          ...vars,
          first: label(first.key),
          firstAmount: signed(first.change, fmt.cny),
          second: label(second.key),
          secondAmount: signed(second.change, fmt.cny),
        }
      )
    }
    if (first) {
      return t(
        'Consumption {{amount}} ({{change}}), mostly {{first}} {{firstAmount}}.',
        {
          ...vars,
          first: label(first.key),
          firstAmount: signed(first.change, fmt.cny),
        }
      )
    }
    return t('Consumption {{amount}} ({{change}}).', vars)
  })()

  return {
    tone,
    text: join(
      paid,
      consumed,
      marginText,
      revenue > 0 &&
        freeAccounts > 0 &&
        t(
          '{{count}} pool accounts have no recorded price and count as free, so the margin reads high.',
          { count: fmt.num(freeAccounts) }
        ),
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
      giftShareHigh(gifts) &&
        t('Gifted credit is {{share}} of customers’ consumption.', {
          share: fmt.pct(gifts.giftShare ?? 0),
        }),
      data.debt_usd < -1 &&
        t('Customers owe {{debt}}.', { debt: fmt.cny(-data.debt_usd) })
    ),
  }
}
