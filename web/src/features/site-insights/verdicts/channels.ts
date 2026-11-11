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
  channelTotals,
  costParts,
  paidChannels,
  worstPaidChannel,
} from '../components/channels-analysis'
import type { Tone } from '../components/shared'
import {
  SHORT_ROI_DAYS,
  channelEconomics,
  useInsightsFormat,
  type InsightsRangeInfo,
} from '../lib'
import type { ChannelInsights } from '../types'
import { join, useChange, type TabVerdict } from './shared'

/** A fee is renegotiated on a loss read over at least this many days. */
const JUDGE_DAYS = 30

export function useChannelsVerdict(
  data: ChannelInsights | undefined,
  previous: ChannelInsights | undefined,
  range?: InsightsRangeInfo
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const change = useChange()
  if (!data) return undefined
  const rate = data.usd_exchange_rate || 1
  const paid = paidChannels(data.channels ?? [])
  if (paid.length === 0) {
    return { tone: 'default', text: t('No channel has a fee recorded.') }
  }
  const totals = channelTotals(paid, rate)
  const before = previous
    ? channelTotals(previous.channels ?? [], previous.usd_exchange_rate || 1)
    : undefined
  const moved = change(totals.revenue, before?.revenue)
  const vars = { revenue: fmt.cny(totals.revenue), net: fmt.cny(totals.net) }
  const headline = moved
    ? t(
        'Paid channels brought {{revenue}} ({{change}}), net {{net}} after their cost.',
        { ...vars, change: moved }
      )
    : t(
        'Paid channels brought {{revenue}}, net {{net}} after their cost.',
        vars
      )
  if (range && range.days < SHORT_ROI_DAYS) {
    return {
      tone: 'default',
      text: join(
        headline,
        t(
          'A range under {{days}} days cannot judge a channel: read 30 days or the contract to date.',
          { days: SHORT_ROI_DAYS }
        )
      ),
    }
  }
  const worst = worstPaidChannel(paid, rate)
  const worstNet = worst ? channelEconomics(worst, rate).net : 0
  if (!worst || worstNet >= 0) {
    return {
      tone: 'good',
      text: join(headline, t('Every paid channel covers its cost.')),
    }
  }
  const long = !range || range.days >= JUDGE_DAYS
  const parts = costParts(worst, rate)
  const named = {
    name: worst.channel.username || `#${worst.channel.user_id}`,
    net: fmt.cny(worstNet),
  }
  let action: string
  if (parts.main === 'gift') {
    action = t(
      '{{name}} loses the most ({{net}}), mostly to given credit its accounts spent ({{gift}}): tighten its gifts.',
      { ...named, gift: fmt.cny(parts.gift) }
    )
  } else if (long) {
    action = t(
      '{{name}} loses the most ({{net}}), mostly to its fee ({{fee}}): renegotiate or drop it.',
      { ...named, fee: fmt.cny(parts.fee) }
    )
  } else {
    action = t(
      '{{name}} loses the most ({{net}}), mostly to its fee ({{fee}}): read it over 30 days before renegotiating.',
      { ...named, fee: fmt.cny(parts.fee) }
    )
  }
  let tone: Tone = 'warning'
  if (totals.net < 0 && long) tone = 'danger'
  return { tone, text: join(headline, action) }
}
