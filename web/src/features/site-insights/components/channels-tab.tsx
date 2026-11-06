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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { saveChannelCosts } from '../api'
import { channelEconomics, useInsightsFormat } from '../lib'
import type { ChannelCost, ChannelInsights, ChannelRow } from '../types'
import {
  CountRate,
  MetricGrid,
  Panel,
  SimpleTable,
  UserLabel,
  type Tone,
} from './shared'

const DAY_SECONDS = 86400

/** Local midnight of a date input's value, in unix seconds. */
function dateSeconds(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000)
}

function useSegmentLabel() {
  const { t } = useTranslation()
  return (row: ChannelRow) => {
    if (row.segment === 'invited') return t('Other invitations')
    if (row.segment === 'organic') return t('Organic')
    return <UserLabel {...row.channel} />
  }
}

/**
 * What each acquisition source brought in against what it cost: the
 * channel's fee or, without one, its commission, and the given credit its
 * accounts spent.
 */
export function ChannelsTab(props: { data: ChannelInsights | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useSegmentLabel()
  const data = props.data
  const rate = data?.usd_exchange_rate || 1
  // A segment with no account, payment or fee has nothing to compare.
  const rows = (data?.channels ?? []).filter(
    (row) => row.accounts > 0 || row.revenue > 0 || row.fee_usd > 0
  )
  const paidChannels = rows.filter((row) => row.fee_usd > 0)
  const totals = paidChannels.reduce(
    (sum, row) => {
      const economics = channelEconomics(row, rate)
      sum.fee += economics.fee
      sum.revenue += row.revenue
      sum.net += economics.net
      sum.newPayers += row.new_payers
      return sum
    },
    { fee: 0, revenue: 0, net: 0, newPayers: 0 }
  )
  const pct = (part: number, whole: number) =>
    whole ? fmt.pct(part / whole) : '-'
  const money = (value: number | null) => (value == null ? '-' : fmt.cny(value))
  const tone = (value: number | null): Tone => {
    if (value == null) return 'default'
    return value < 0 ? 'danger' : 'good'
  }
  const toneClass: Record<Tone, string> = {
    default: '',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-destructive',
    good: 'text-emerald-600 dark:text-emerald-400',
  }
  const economicsHelp = t(
    'Money is in yuan. Revenue is what the source’s accounts paid in the range, whenever they signed up. Cost is the channel fee over the range at the site’s exchange rate, and the given credit its accounts spent (gift plans, administrators’ credits, and the unpaid share of each wallet), at list price. A channel with a fee is not charged its commission, shown struck through: its affiliate account only attributes sign-ups. A channel without a fee is charged the commission it earned. Net is revenue less cost; ROI is net over the fee.'
  )
  const cohortHelp = t(
    'Accounts created in the range, followed up to now. Activated: sent a request. Paid: completed a gateway order.'
  )

  return (
    <div className='grid gap-4'>
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Channel fees'),
            featured: true,
            value: fmt.cny(totals.fee),
            hint: t('{{count}} paid channels', {
              count: paidChannels.length,
            }),
            help: economicsHelp,
          },
          {
            label: t('Revenue from paid channels'),
            value: fmt.cny(totals.revenue),
            help: economicsHelp,
          },
          {
            label: t('Net after channel cost'),
            value: fmt.cny(totals.net),
            tone: tone(paidChannels.length ? totals.net : null),
            help: economicsHelp,
          },
          {
            label: t('ROI'),
            value: totals.fee ? fmt.pct(totals.net / totals.fee) : '-',
            tone: tone(totals.fee ? totals.net : null),
            help: economicsHelp,
          },
          {
            label: t('Fee per new payer'),
            value: totals.newPayers
              ? fmt.cny(totals.fee / totals.newPayers)
              : '-',
            hint: t('{{count}} new payers', { count: totals.newPayers }),
            help: t(
              'The paid channels’ fee over the range divided by their accounts that paid for the first time in the range.'
            ),
          },
        ]}
      />
      <Panel title={t('Channel return')} help={economicsHelp}>
        <SimpleTable<ChannelRow>
          rows={rows}
          rowKey={(row) => `${row.segment}-${row.channel.user_id}`}
          empty={t('No data')}
          columns={[
            { key: 'source', label: t('Source'), render: label },
            {
              key: 'revenue',
              label: t('Revenue'),
              align: 'right',
              render: (row) => (
                <span className='tabular-nums'>
                  {fmt.cny(row.revenue)}
                  <span className='text-muted-foreground ml-1 text-xs'>
                    {t('{{count}} payers', { count: row.payers })}
                  </span>
                </span>
              ),
            },
            {
              key: 'fee',
              label: t('Channel fee'),
              align: 'right',
              render: (row) =>
                row.fee_usd ? (
                  <span className='tabular-nums'>
                    {fmt.cny(row.fee_usd * rate)}
                    <span className='text-muted-foreground ml-1 text-xs'>
                      {fmt.usd(row.fee_usd)}
                    </span>
                  </span>
                ) : (
                  '-'
                ),
            },
            {
              key: 'commission',
              label: t('Commission'),
              align: 'right',
              render: (row) => {
                if (!row.commission_usd) return '-'
                if (row.fee_usd > 0) {
                  return (
                    <span className='text-muted-foreground tabular-nums line-through'>
                      {fmt.cny(row.commission_usd)}
                    </span>
                  )
                }
                return fmt.cny(row.commission_usd)
              },
            },
            {
              key: 'gift',
              label: t('Gift spent'),
              hint: t(
                'Given credit the accounts spent in the range, at list price.'
              ),
              align: 'right',
              render: (row) => fmt.cny(row.gift_consumption_usd),
            },
            {
              key: 'net',
              label: t('Net'),
              align: 'right',
              render: (row) => {
                const { net } = channelEconomics(row, rate)
                return (
                  <span className={`tabular-nums ${toneClass[tone(net)]}`}>
                    {fmt.cny(net)}
                  </span>
                )
              },
            },
            {
              key: 'roi',
              label: t('ROI'),
              align: 'right',
              render: (row) => {
                const { roi } = channelEconomics(row, rate)
                return roi == null ? '-' : fmt.pct(roi)
              },
            },
            {
              key: 'cac',
              label: t('Fee per new payer'),
              align: 'right',
              render: (row) => money(channelEconomics(row, rate).cac),
            },
          ]}
        />
      </Panel>
      <Panel title={t('Sign-ups by source')} help={cohortHelp}>
        <SimpleTable<ChannelRow>
          rows={rows}
          rowKey={(row) => `${row.segment}-${row.channel.user_id}`}
          empty={t('No data')}
          columns={[
            { key: 'source', label: t('Source'), render: label },
            {
              key: 'reg',
              label: t('Registered'),
              align: 'right',
              render: (row) => fmt.num(row.registered),
            },
            {
              key: 'act',
              label: t('Activated'),
              align: 'right',
              render: (row) => (
                <CountRate
                  count={fmt.num(row.activated)}
                  rate={pct(row.activated, row.registered)}
                />
              ),
            },
            {
              key: 'paid',
              label: t('Has paid'),
              align: 'right',
              render: (row) => (
                <CountRate
                  count={fmt.num(row.paid)}
                  rate={pct(row.paid, row.registered)}
                />
              ),
            },
            {
              key: 'repeat',
              label: t('Paid again'),
              align: 'right',
              render: (row) => (
                <CountRate
                  count={fmt.num(row.repeat)}
                  rate={pct(row.repeat, row.paid)}
                />
              ),
            },
            {
              key: 'accounts',
              label: t('All accounts'),
              hint: t('Every account the source has brought, at any time.'),
              align: 'right',
              render: (row) => fmt.num(row.accounts),
            },
          ]}
        />
      </Panel>
      <Panel
        title={t('Given credit by source')}
        help={t(
          'Granted: gift plans and administrators’ balance changes in the range. Spent: given credit used in the range. Unspent: what is left now on running gift plans and in the unpaid share of wallets, which can still be spent.'
        )}
      >
        <SimpleTable<ChannelRow>
          rows={rows.filter(
            (row) =>
              row.granted_usd ||
              row.gift_consumption_usd ||
              row.gift_outstanding_usd
          )}
          rowKey={(row) => `${row.segment}-${row.channel.user_id}`}
          empty={t('No data')}
          columns={[
            { key: 'source', label: t('Source'), render: label },
            {
              key: 'granted',
              label: t('Granted'),
              align: 'right',
              render: (row) => fmt.cny(row.granted_usd),
            },
            {
              key: 'spent',
              label: t('Spent'),
              align: 'right',
              render: (row) => fmt.cny(row.gift_consumption_usd),
            },
            {
              key: 'unspent',
              label: t('Unspent'),
              align: 'right',
              render: (row) => fmt.cny(row.gift_outstanding_usd),
            },
            {
              key: 'consumption',
              label: t('All use'),
              hint: t(
                'Every request of the accounts in the range, at list price.'
              ),
              align: 'right',
              render: (row) => fmt.cny(row.consumption_usd),
            },
          ]}
        />
      </Panel>
      <ChannelCostsPanel
        costs={data?.costs ?? []}
        channels={rows.filter((row) => row.segment === 'channel')}
      />
    </div>
  )
}

/**
 * The fees paid to channels. A fee runs monthly from its start; a changed
 * fee is a new entry starting where the old one ends.
 */
function ChannelCostsPanel(props: {
  costs: ChannelCost[]
  channels: ChannelRow[]
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const queryClient = useQueryClient()
  const [userID, setUserID] = useState('')
  const [monthly, setMonthly] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const names = new Map(
    props.channels.map((row) => [row.channel.user_id, row.channel.username])
  )
  const save = useMutation({
    mutationFn: saveChannelCosts,
    onSuccess: () => {
      toast.success(t('Channel costs saved'))
      setMonthly('')
      setStart('')
      setEnd('')
      setNote('')
      void queryClient.invalidateQueries({
        queryKey: ['site-insights', 'channels'],
      })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  })
  const amount = Number(monthly)
  const valid =
    userID !== '' &&
    monthly !== '' &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    start !== '' &&
    (end === '' || end >= start)
  const add = () =>
    save.mutate([
      ...props.costs,
      {
        user_id: Number(userID),
        monthly_usd: amount,
        start: dateSeconds(start),
        // The end date is the last day paid for.
        end: end ? dateSeconds(end) + DAY_SECONDS : 0,
        note,
      },
    ])

  return (
    <Panel
      title={t('Channel fees')}
      help={t(
        'What each channel is paid, in US dollars a month. The fee counts every day from its start to its last day, a thirtieth of the month a day; with no last day it runs until now. When a fee changes, set the old entry’s last day and add a new one.'
      )}
    >
      <div className='grid gap-3'>
        <SimpleTable<ChannelCost>
          rows={props.costs}
          rowKey={(row, index) => `${row.user_id}-${row.start}-${index}`}
          empty={t('No channel fees recorded')}
          columns={[
            {
              key: 'channel',
              label: t('Promotion channel'),
              render: (row) => (
                <UserLabel
                  user_id={row.user_id}
                  username={names.get(row.user_id) ?? ''}
                />
              ),
            },
            {
              key: 'monthly',
              label: t('Per month'),
              align: 'right',
              render: (row) => fmt.usd(row.monthly_usd),
            },
            {
              key: 'start',
              label: t('From'),
              align: 'right',
              render: (row) => fmt.day(row.start),
            },
            {
              key: 'end',
              label: t('Last day'),
              align: 'right',
              render: (row) =>
                row.end ? fmt.day(row.end - DAY_SECONDS) : t('Ongoing'),
            },
            { key: 'note', label: t('Note'), render: (row) => row.note || '-' },
            {
              key: 'remove',
              label: '',
              align: 'right',
              render: (row) => (
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Delete')}
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate(props.costs.filter((cost) => cost !== row))
                  }
                >
                  <Trash2 />
                </Button>
              ),
            },
          ]}
        />
        <div className='flex flex-wrap items-end gap-2'>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>
              {t('Promotion channel')}
            </span>
            <NativeSelect
              size='sm'
              value={userID}
              onChange={(event) => setUserID(event.target.value)}
            >
              <NativeSelectOption value=''>-</NativeSelectOption>
              {props.channels.map((row) => (
                <NativeSelectOption
                  key={row.channel.user_id}
                  value={String(row.channel.user_id)}
                >
                  {row.channel.username} #{row.channel.user_id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('USD per month')}</span>
            <Input
              className='h-7 w-28'
              type='number'
              min={0}
              step='any'
              value={monthly}
              onChange={(event) => setMonthly(event.target.value)}
            />
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('From')}</span>
            <Input
              className='h-7 w-36'
              type='date'
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>
              {t('Last day (optional)')}
            </span>
            <Input
              className='h-7 w-36'
              type='date'
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('Note')}</span>
            <Input
              className='h-7 w-40'
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <Button size='sm' disabled={!valid || save.isPending} onClick={add}>
            {t('Add')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
