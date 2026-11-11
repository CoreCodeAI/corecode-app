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
// CoreCode fork: the hooks the upstream tab and its panels share. They live
// apart from the panels because a component file may only export components.

import { useTranslation } from 'react-i18next'

import {
  joinSentences,
  useInsightsDefinitions,
  useInsightsFormat,
} from '../lib'
import type { BarSeriesItem } from './shared'

/**
 * The tab's unit and definition sentences, one each, so every figure that
 * rests on them says the same. units goes with revenue and margin,
 * costUnits with cost, clientLeftOut with a channel failure rate on a
 * server that tells customers' bad requests apart.
 */
export function useUpstreamHelp(): {
  units: string
  costUnits: string
  clientLeftOut: string
} {
  const { t } = useTranslation()
  const definitions = useInsightsDefinitions()
  const compared = t(
    'Bills and fees are set against revenue one for one, with no conversion.'
  )
  return {
    units: joinSentences(
      t('Revenue is in quota dollars, which customers buy at ¥1 each.'),
      definitions.upstreamBill,
      definitions.fee,
      compared
    ),
    costUnits: joinSentences(
      definitions.upstreamBill,
      definitions.fee,
      compared
    ),
    clientLeftOut: t(
      'Failures the customer’s own request caused (a 4xx other than 401, 402, 403, 404 and 408) are left out of the rate, as the channel did not cause them; they still count as attempts.'
    ),
  }
}

type RevenueSlot = {
  costedRevenue: number
  uncostedRevenue: number
  cost: number
}

/**
 * The revenue-and-cost bars of a day or hour series: revenue on channels
 * whose cost is known beside their cost, and, when there is any, revenue
 * with no known cost as a grey third bar. The margin readout sets only the
 * costed revenue against the cost.
 */
export function useRevenueBars(slots: RevenueSlot[]): {
  series: BarSeriesItem[]
  values: (slot: RevenueSlot) => number[]
  extra: (slot: RevenueSlot) => { label: string; value: string }[]
} {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const uncosted = slots.some((slot) => slot.uncostedRevenue > 0)
  const series: BarSeriesItem[] = [
    {
      label: t('Revenue with a known cost'),
      format: fmt.usd,
      compact: fmt.usdCompact,
    },
    { label: t('Cost'), format: fmt.usd, compact: fmt.usdCompact },
  ]
  if (uncosted) {
    series.push({
      label: t('Revenue with no known cost'),
      format: fmt.usd,
      compact: fmt.usdCompact,
      muted: true,
    })
  }
  return {
    series,
    values: (slot) =>
      uncosted
        ? [slot.costedRevenue, slot.cost, slot.uncostedRevenue]
        : [slot.costedRevenue, slot.cost],
    extra: (slot) => [
      {
        label: t('Gross margin'),
        value: fmt.usd(slot.costedRevenue - slot.cost),
      },
    ],
  }
}
