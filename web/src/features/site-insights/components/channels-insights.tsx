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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'

import { getInsights } from '../api'
import {
  GIFT_SHARE_WARN,
  SHORT_ROI_DAYS,
  TONES,
  channelEconomics,
  useInsightsFormat,
} from '../lib'
import type { ChannelCost, ChannelRow } from '../types'
import {
  channelKey,
  contractRows,
  contractStart,
  costParts,
  giftShare,
  revenuePerPayer,
  type ContractRow,
} from './channels-analysis'
import { SampleNote } from './insight-kit'
import { BarSeries, Panel, SimpleTable, UserLabel } from './shared'

/** A source's name as plain text, for a chart's axis and readout. */
function useSourceName(): (row: ChannelRow) => string {
  const { t } = useTranslation()
  return (row: ChannelRow) => {
    if (row.segment === 'invited') return t('Other invitations')
    if (row.segment === 'organic') return t('Organic')
    return `${row.channel.username || '-'} #${row.channel.user_id}`
  }
}

/**
 * Why each source's net is what it is: its fee, the commission it is
 * charged and the given credit its accounts spent, stacked, with its
 * revenue, net, gift share of use and revenue per payer in the readout.
 */
export function ChannelCostChart(props: { rows: ChannelRow[]; rate: number }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const name = useSourceName()
  const rows = props.rows.filter((row) => {
    const parts = costParts(row, props.rate)
    return parts.main !== null || row.revenue > 0
  })
  if (rows.length === 0) return null
  const warned = rows.filter((row) => {
    const share = giftShare(row)
    return share != null && share > GIFT_SHARE_WARN
  })
  return (
    <Panel
      title={t('What each source cost')}
      description={
        warned.length > 0
          ? t(
              'Given credit is over {{share}} of what {{names}} used: their net leans on gifts.',
              {
                share: fmt.pct(GIFT_SHARE_WARN),
                names: warned.map(name).join(', '),
              }
            )
          : undefined
      }
      help={t(
        'Each bar stacks what a source cost over the range, in yuan: the channel fee at the site’s exchange rate, the commission charged to a channel without a fee, and the given credit its accounts spent at list price. Revenue and net are listed in the readout to read the bar against.'
      )}
    >
      <BarSeries
        ariaLabel={t('What each source cost')}
        series={[
          { label: t('Channel fee'), format: fmt.cny },
          { label: t('Commission'), format: fmt.cny },
          { label: t('Gift spent'), format: fmt.cny },
        ]}
        points={rows.map((row) => {
          const parts = costParts(row, props.rate)
          const share = giftShare(row)
          const perPayer = revenuePerPayer(row)
          const warn = share != null && share > GIFT_SHARE_WARN
          return {
            key: channelKey(row),
            title: name(row),
            values: [parts.fee, parts.commission, parts.gift],
            tone: warn ? 'warning' : undefined,
            extra: [
              { label: t('Revenue'), value: fmt.cny(row.revenue) },
              {
                label: t('Net'),
                value: fmt.cny(channelEconomics(row, props.rate).net),
              },
              {
                label: t('Gift share of use'),
                value: share == null ? '-' : fmt.pct(share),
              },
              {
                label: t('Revenue per payer'),
                value: perPayer == null ? '-' : fmt.cny(perPayer),
              },
            ],
          }
        })}
      />
    </Panel>
  )
}

/**
 * Each paid channel since its fee started: one read of the channels view
 * from the earliest fee's start, which reads every order, so one query
 * serves all channels.
 */
export function ChannelContractPanel(props: {
  costs: ChannelCost[]
  /** The selected range's rows, whose net gives each channel's current daily rate. */
  current: ChannelRow[]
  days: number | undefined
  end: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const start = contractStart(props.costs, props.end)
  const range = { start_time: start ?? 0, end_time: props.end }
  const query = useQuery({
    queryKey: ['site-insights', 'channels', 'contract', range],
    queryFn: () => getInsights('channels', range),
    enabled: start != null,
    staleTime: 5 * 60_000,
    meta: { errorToast: false },
  })
  if (start == null) return null
  const current = new Map(props.current.map((row) => [channelKey(row), row]))
  // A range too short to judge gives no current rate; the contract's own
  // average then serves.
  const judged = props.days != null && props.days >= SHORT_ROI_DAYS
  const days = props.days
  const data = query.data
  const rate = data?.usd_exchange_rate || 1
  const rows = data
    ? contractRows(
        data.channels ?? [],
        props.costs,
        rate,
        start,
        props.end,
        (row) => {
          const now = current.get(channelKey(row))
          if (!judged || !now || days == null) return undefined
          return channelEconomics(now, rate).net / days
        }
      )
    : []
  const preContract = rows.filter((row) => row.preContractDays >= 1)
  const clipped = props.costs.some(
    (cost) => cost.monthly_usd > 0 && cost.start < start
  )
  let body
  if (query.isError) {
    body = (
      <p className='text-destructive text-sm'>
        {query.error instanceof Error
          ? query.error.message
          : t('Failed to load site insights')}
      </p>
    )
  } else if (!data) {
    body = <Skeleton className='h-24 w-full' />
  } else {
    body = (
      <div className='grid gap-2'>
        <SimpleTable<ContractRow>
          rows={rows}
          rowKey={(row) => channelKey(row.row)}
          empty={t('No data')}
          columns={[
            {
              key: 'source',
              label: t('Promotion channel'),
              render: (row) => <UserLabel {...row.row.channel} />,
            },
            {
              key: 'since',
              label: t('From'),
              align: 'right',
              render: (row) => (
                <span className='tabular-nums'>
                  {fmt.day(row.start)}
                  <span className='text-muted-foreground ml-1 text-xs'>
                    {t('{{days}} days', {
                      days: fmt.num(Math.floor(row.days)),
                    })}
                  </span>
                </span>
              ),
            },
            {
              key: 'fee',
              label: t('Fees so far'),
              align: 'right',
              render: (row) => fmt.cny(row.fee),
            },
            {
              key: 'revenue',
              label: t('Revenue'),
              align: 'right',
              render: (row) => fmt.cny(row.row.revenue),
            },
            {
              key: 'net',
              label: t('Net'),
              align: 'right',
              render: (row) => (
                <span
                  className={`tabular-nums ${TONES[row.paidBack ? 'good' : 'danger']}`}
                >
                  {fmt.cny(row.net)}
                </span>
              ),
            },
            {
              key: 'payback',
              label: t('Paid back'),
              hint: t(
                'Days until net reaches zero at the channel’s daily net over the selected range, or over the contract to date when the range is under 7 days. A net that is not climbing gives no date.'
              ),
              align: 'right',
              render: (row) => {
                if (row.paidBack) return t('Paid back')
                if (row.breakEvenDays == null) return t('Not at this rate')
                return t('In {{days}} days', {
                  days: fmt.num(Math.ceil(row.breakEvenDays)),
                })
              },
            },
          ]}
        />
        {preContract.length > 0 && (
          <SampleNote>
            {t(
              'Read from the earliest fee’s start, so revenue for {{names}} includes days before their own fee started.',
              {
                names: preContract
                  .map(
                    (row) =>
                      row.row.channel.username || `#${row.row.channel.user_id}`
                  )
                  .join(', '),
              }
            )}
          </SampleNote>
        )}
        {clipped && (
          <SampleNote>
            {t(
              'The view reads at most 366 days back, so older fees are left out.'
            )}
          </SampleNote>
        )}
      </div>
    )
  }
  return (
    <Panel
      title={t('Contract to date')}
      description={t('Since {{date}}, to now.', { date: fmt.day(start) })}
      help={t(
        'Each paid channel from the day its fee started to now, whatever range is selected: the fees accrued, the revenue of every account it brought, less those fees and the given credit its accounts spent. Paid back means net is at or above zero.'
      )}
    >
      {body}
    </Panel>
  )
}
