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

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import {
  financeMargins,
  profitWaterfall,
  type WaterfallCost,
} from '../finance-analysis'
import {
  joinSentences,
  useChargeFormat,
  useInsightsFormat,
  type SourceState,
} from '../lib'
import type { FinanceInsights } from '../types'
import { Panel } from './shared'

/**
 * Revenue taken down to what is left, one cost at a time, each with its share
 * of revenue. The first four steps reproduce the vendor panel's gross margin;
 * the last figure is not net profit, and the note under it says what is missing.
 * Hidden on a server that does not send channel_fee_usd.
 */
export function ProfitWaterfallPanel(props: {
  data: FinanceInsights | undefined
  /** The funds view's state, so a failed read is not drawn as loading. */
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.data)
  const data = props.data
  const margins = data ? financeMargins(data, charge.rate) : undefined
  const waterfall =
    data && margins ? profitWaterfall(data, margins, charge.rate) : undefined
  if (data && !waterfall) return null
  const failed = !data && props.source?.status === 'error'
  const revenue = waterfall?.revenue ?? 0
  const share = (amount: number) =>
    revenue > 0 ? fmt.pct(amount / revenue) : '-'
  const costLabels: Record<WaterfallCost, string> = {
    accounts: t('Pool accounts'),
    bills: t('Upstream bills'),
    fees: t('Upstream monthly fees'),
    ips: t('Egress IP costs'),
    channels: t('Promotion-channel fees'),
    commission: t('Referral commission, exempt accounts left out'),
  }
  const costAmount = (key: WaterfallCost) =>
    waterfall?.steps.find((step) => step.key === key)?.amount ?? 0
  // A row's bar is its amount against revenue, clamped to the track.
  const bar = (amount: number) =>
    revenue > 0 ? Math.min(Math.max(amount / revenue, 0), 1) : 0
  const line = (key: string, label: string, amount: number, total: boolean) => (
    <li
      key={key}
      className='grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1'
    >
      <span className={cn('text-sm', total && 'font-medium')}>{label}</span>
      <span className='text-right text-sm tabular-nums'>
        {total || amount <= 0 ? '' : '−'}
        {fmt.cny(amount)}
        <span className='text-muted-foreground ml-2 text-xs'>
          {share(amount)}
        </span>
      </span>
      <div className='bg-muted col-span-2 h-1.5 overflow-hidden rounded-full'>
        <div
          className={cn(
            'h-full rounded-full',
            total ? 'bg-primary' : 'bg-muted-foreground/40'
          )}
          style={{ width: `${bar(amount) * 100}%` }}
        />
      </div>
    </li>
  )
  const description =
    waterfall &&
    t(
      'Earned {{revenue}}; gross margin {{margin}} ({{rate}}) after accounts, upstream bills, fees and IP costs; {{left}} ({{leftRate}}) left after channel fees and commission.',
      {
        revenue: fmt.cny(waterfall.revenue),
        margin: fmt.cny(waterfall.grossMargin),
        rate: share(waterfall.grossMargin),
        left: fmt.cny(waterfall.left),
        leftRate: share(waterfall.left),
      }
    )
  return (
    <Panel
      title={t('Profit waterfall')}
      description={description}
      error={
        failed ? (props.source?.error ?? t('Could not be read')) : undefined
      }
      help={joinSentences(
        t(
          'Each step is a cost the dashboard records, in yuan, with its share of recognized revenue. The first four steps are the gross margin in the vendor panel above. IP costs are the entries under IP costs below; channel fees are real US dollars, converted at the site’s exchange rate as on the channels tab.'
        ),
        t(
          'Commission is credited to wallets as quota, not paid in cash. Commission earned by the exempt accounts listed below, the site’s own promotion accounts, is left out; the rest is shown as the cost of that credit.'
        )
      )}
    >
      {!data && !failed && (
        <div className='grid gap-3'>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className='h-8 w-full' />
          ))}
        </div>
      )}
      {waterfall && (
        <>
          <ol className='grid gap-3'>
            {line('revenue', t('Recognized revenue'), waterfall.revenue, true)}
            {line(
              'accounts',
              costLabels.accounts,
              costAmount('accounts'),
              false
            )}
            {line('bills', costLabels.bills, costAmount('bills'), false)}
            {line('fees', costLabels.fees, costAmount('fees'), false)}
            {line('ips', costLabels.ips, costAmount('ips'), false)}
            {line('gross', t('Gross margin'), waterfall.grossMargin, true)}
            {line(
              'channels',
              costLabels.channels,
              costAmount('channels'),
              false
            )}
            {line(
              'commission',
              costLabels.commission,
              costAmount('commission'),
              false
            )}
            {line('left', t('Left after these costs'), waterfall.left, true)}
          </ol>
          <p className='text-muted-foreground mt-3 text-xs'>
            {t(
              'Not in it: payment processing fees, refunds (a refunded order stays in revenue), and any cost the dashboard does not record. The last figure is therefore not net profit.'
            )}
          </p>
        </>
      )}
    </Panel>
  )
}
