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
import type { TFunction } from 'i18next'

import type { Finding } from '../analysis'
import { orderFunnels, type OrderFunnelRow } from '../finance-analysis'
import { MIN_CHECKOUTS, paymentMethodLabel, SECTIONS } from '../lib'
import type { OrderMethodFunnel } from '../types'
import type { InsightsFormat } from './overview-analysis'

/** A method is named when under this share of its settled checkouts paid. */
export const CHECKOUT_LOSS_SHARE = 0.5

/**
 * One finding per payment method that completed under CHECKOUT_LOSS_SHARE of
 * its settled checkouts, over at least MIN_CHECKOUTS of them, whether or not
 * the rate changed. Ranked by the estimate of its unpaid checkouts, which is
 * the finding's impact. No method is special-cased: a method the owner cannot
 * change is named too.
 */
export function checkoutLossFindings(
  t: TFunction,
  fmt: InsightsFormat,
  methods: OrderMethodFunnel[] | null | undefined
): Finding[] {
  return orderFunnels(methods, null)
    .filter(
      (row) =>
        row.settled >= MIN_CHECKOUTS &&
        row.settledRate != null &&
        row.settledRate < CHECKOUT_LOSS_SHARE
    )
    .map((row) => lossFinding(t, fmt, row))
    .sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0))
}

function lossFinding(
  t: TFunction,
  fmt: InsightsFormat,
  row: OrderFunnelRow
): Finding {
  const counts = {
    paid: fmt.num(row.paid),
    settled: fmt.num(row.settled),
    unpaid: fmt.num(row.unpaid),
  }
  const detail =
    row.estimate == null
      ? t(
          '{{paid}} of {{settled}} settled checkouts paid, so there is no average paid amount to value the {{unpaid}} unpaid ones.',
          counts
        )
      : t(
          '{{paid}} of {{settled}} settled checkouts paid. The {{unpaid}} unpaid could be worth up to {{estimate}}, at {{average}} each: an upper estimate, since some customers pay another way.',
          {
            ...counts,
            estimate: fmt.cny(row.estimate),
            average: fmt.cny(row.averagePaid ?? 0),
          }
        )
  return {
    key: `finance-checkout-loss-${row.payment_method}`,
    tone: 'warning',
    title: t('{{method}} completed {{rate}} of settled checkouts', {
      method: paymentMethodLabel(row.payment_method, t),
      rate: fmt.pct(row.settledRate ?? 0),
    }),
    detail,
    tab: 'finance',
    section: SECTIONS.checkouts,
    impact: row.estimate ?? 0,
  }
}
