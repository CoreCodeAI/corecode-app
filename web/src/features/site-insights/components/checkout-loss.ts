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

import { paymentMethodLabel } from '@/features/wallet/lib/billing'

import type { Finding } from '../analysis'
import { orderFunnels, type OrderFunnelRow } from '../finance-analysis'
import { MIN_CHECKOUTS, SECTIONS } from '../lib'
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

/**
 * One finding for each payment method whose payments were mostly refunded:
 * at least MIN_CHECKOUTS refunded, and at least half of the checkouts that
 * paid. Its checkouts complete, so it is not a checkout loss; what was paid
 * came back, as a card tested or charged back does. Most refunds first.
 */
export function refundedCheckoutFindings(
  t: TFunction,
  fmt: InsightsFormat,
  methods: OrderMethodFunnel[] | null | undefined
): Finding[] {
  return orderFunnels(methods, null)
    .filter(
      (row) =>
        row.refunded >= MIN_CHECKOUTS &&
        row.refunded >= (row.paid + row.refunded) * CHECKOUT_LOSS_SHARE
    )
    .sort((a, b) => b.refunded - a.refunded)
    .map((row) => ({
      key: `finance-checkout-refunds-${row.payment_method}`,
      tone: 'warning' as const,
      title: t('{{method}}: {{refunded}} of {{paid}} payments were refunded', {
        method: paymentMethodLabel(row.payment_method, t),
        refunded: fmt.num(row.refunded),
        paid: fmt.num(row.paid + row.refunded),
      }),
      detail: t(
        'These checkouts went through and the money was returned, so they are not failed checkouts. Refunds this frequent are usually cards being tested or charged back.'
      ),
      tab: 'finance' as const,
      section: SECTIONS.checkouts,
      impact: row.refunded,
    }))
}

function lossFinding(
  t: TFunction,
  fmt: InsightsFormat,
  row: OrderFunnelRow
): Finding {
  const counts = {
    // Paid, refunded since or not: what settledRate counts.
    paid: fmt.num(row.paid + row.refunded),
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
