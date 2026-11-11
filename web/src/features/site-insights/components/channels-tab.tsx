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
import {
  GIFT_SHARE_WARN,
  MIN_COHORT,
  SHORT_ROI_DAYS,
  TONES,
  channelEconomics,
  useInsightsFormat,
  type InsightsRangeInfo,
  type InsightsTab,
} from '../lib'
import type { ChannelCost, ChannelInsights, ChannelRow } from '../types'
import { useChannelsVerdict } from '../verdicts/channels'
import {
  MIN_NEW_PAYERS,
  channelKey,
  channelTotals,
  cohortRate,
  giftShare,
  monthFees,
  monthStartOf,
  newAccountShare,
  organicLift,
  paidChannels,
  revenuePerPayer,
  roiMuted,
} from './channels-analysis'
import { ChannelContractPanel, ChannelCostChart } from './channels-insights'
import {
  CountRate,
  MetricGrid,
  Panel,
  SimpleTable,
  UserLabel,
  Verdict,
  type MetricItem,
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
export function ChannelsTab(props: {
  data: ChannelInsights | undefined
  previous?: ChannelInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useSegmentLabel()
  const data = props.data
  const verdict = useChannelsVerdict(data, props.previous, props.range)
  // Without a range, the moment the tab first drew stands for now, so the
  // contract read keeps one query key.
  const [mounted] = useState(() => Math.floor(Date.now() / 1000))
  const end = props.range?.end ?? mounted
  const days = props.range?.days
  const rate = data?.usd_exchange_rate || 1
  // A segment with no account, payment or fee has nothing to compare.
  const rows = (data?.channels ?? []).filter(
    (row) => row.accounts > 0 || row.revenue > 0 || row.fee_usd > 0
  )
  const paid = paidChannels(rows)
  const totals = channelTotals(rows, rate)
  const previous = props.previous
  const previousRate = previous?.usd_exchange_rate || 1
  const before = previous
    ? channelTotals(previous.channels ?? [], previousRate)
    : undefined
  const previousRows = new Map(
    (previous?.channels ?? []).map((row) => [channelKey(row), row])
  )
  const organic = rows.find((row) => row.segment === 'organic')
  // Channels by how much better than organic their sign-ups pay; the
  // invited and organic segments stay last.
  const cohortRows = [...rows].sort((a, b) => {
    if ((a.segment === 'channel') !== (b.segment === 'channel')) {
      return a.segment === 'channel' ? -1 : 1
    }
    if (a.segment !== 'channel') return 0
    const liftA = organicLift(a, organic).paid ?? -1
    const liftB = organicLift(b, organic).paid ?? -1
    return liftB - liftA
  })
  const muted = roiMuted(days, totals.newPayers)
  const fees = monthFees(data?.costs ?? [], monthStartOf(end), end)
  const showsNewAccounts = rows.some((row) => row.revenue_new_accounts != null)
  const rateOf = (events: number, whole: number) => {
    const value = cohortRate(events, whole)
    return value == null ? '-' : fmt.pct(value)
  }
  const signed = (value: number) =>
    value > 0 ? `+${fmt.cny(value)}` : fmt.cny(value)
  const tone = (value: number | null): Tone => {
    if (value == null) return 'default'
    return value < 0 ? 'danger' : 'good'
  }
  const economicsHelp = t(
    'Money is in yuan. Revenue is what the source’s accounts paid in the range, whenever they signed up. Cost is the channel fee over the range at the site’s exchange rate, and the given credit its accounts spent (gift plans, administrators’ credits, and the unpaid share of each wallet), at list price. A channel with a fee is not charged its commission, shown struck through: its affiliate account only attributes sign-ups. A channel without a fee is charged the commission it earned. Net is revenue less cost; ROI is net over the fee.'
  )
  const cohortHelp = t(
    'Accounts created in the range, followed up to now. Activated: sent a request. Paid: completed a gateway order.'
  )
  let mutedHint: string | undefined
  if (muted === 'short') {
    mutedHint = t('Not judged over a range under {{days}} days', {
      days: SHORT_ROI_DAYS,
    })
  } else if (muted === 'few') {
    mutedHint = t('Not judged on fewer than {{count}} new payers', {
      count: MIN_NEW_PAYERS,
    })
  }
  const roiItem: MetricItem = {
    label: t('ROI'),
    value: totals.fee && !muted ? fmt.pct(totals.net / totals.fee) : '-',
    tone: tone(totals.fee && !muted ? totals.net : null),
    hint: mutedHint,
    help: economicsHelp,
  }
  const cacItem: MetricItem = {
    label: t('Fee per new payer'),
    value:
      totals.newPayers && !muted ? fmt.cny(totals.fee / totals.newPayers) : '-',
    hint: mutedHint ?? t('{{count}} new payers', { count: totals.newPayers }),
    help: t(
      'The paid channels’ fee over the range divided by their accounts that paid for the first time in the range.'
    ),
    ...(!muted &&
      totals.newPayers > 0 &&
      before &&
      before.newPayers >= MIN_NEW_PAYERS && {
        delta: {
          current: totals.fee / totals.newPayers,
          previous: before.fee / before.newPayers,
          better: 'down' as const,
        },
      }),
  }
  const projects = days != null && days >= SHORT_ROI_DAYS

  return (
    <div className='grid gap-4'>
      <Verdict
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
        loading={!data}
      />
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Channel fees'),
            featured: true,
            value: fmt.cny(totals.fee),
            hint: t(
              '{{count}} paid channels; the monthly fee prorated over the range',
              { count: paid.length }
            ),
            help: economicsHelp,
            delta: {
              current: totals.fee,
              previous: before?.fee,
              better: 'neutral',
            },
          },
          {
            label: t('Revenue from paid channels'),
            value: fmt.cny(totals.revenue),
            help: economicsHelp,
            delta: {
              current: totals.revenue,
              previous: before?.revenue,
              better: 'up',
            },
          },
          {
            label: t('Net after channel cost'),
            value: fmt.cny(totals.net),
            tone: tone(paid.length ? totals.net : null),
            hint: projects
              ? t('Projected month: {{net}}', {
                  net: fmt.cny((totals.net / days) * 30),
                })
              : undefined,
            help: t(
              'Revenue from the paid channels less their fees and the given credit their accounts spent. The projection runs the range’s daily net over 30 days; it is shown from ranges of 7 days.'
            ),
            delta: { current: totals.net, previous: before?.net, better: 'up' },
          },
          roiItem,
          cacItem,
          {
            label: t('Fees this month'),
            value: fmt.cny(fees.accrued * rate),
            hint: t('of {{monthly}} a month running now', {
              monthly: fmt.cny(fees.monthly * rate),
            }),
            help: t(
              'Channel fees accrued from the first of this month to now, a thirtieth of each monthly fee a day, at the site’s exchange rate, against the monthly fees of the entries running now.'
            ),
            ...(fees.monthly > 0 && {
              meter: {
                value: Math.min(fees.accrued / fees.monthly, 1),
                label: t('Share of this month’s fees accrued'),
              },
            }),
          },
        ]}
      />
      <ChannelContractPanel
        costs={data?.costs ?? []}
        current={rows}
        days={days}
        end={end}
      />
      <ChannelCostChart rows={rows} rate={rate} />
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
              render: (row) => {
                const perPayer = revenuePerPayer(row)
                return (
                  <span className='tabular-nums'>
                    {fmt.cny(row.revenue)}
                    <span className='text-muted-foreground ml-1 text-xs'>
                      {perPayer == null
                        ? t('{{count}} payers', { count: row.payers })
                        : t('{{count}} payers, {{each}} each', {
                            count: row.payers,
                            each: fmt.cny(perPayer),
                          })}
                    </span>
                  </span>
                )
              },
            },
            ...(showsNewAccounts
              ? [
                  {
                    key: 'new-accounts',
                    label: t('From new accounts'),
                    hint: t(
                      'The share of revenue paid by accounts the source brought in this range; the rest came from accounts it brought earlier.'
                    ),
                    align: 'right' as const,
                    render: (row: ChannelRow) => {
                      const share = newAccountShare(row)
                      return share == null ? '-' : fmt.pct(share)
                    },
                  },
                ]
              : []),
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
              render: (row) => {
                const share = giftShare(row)
                const warn = share != null && share > GIFT_SHARE_WARN
                return (
                  <span className='tabular-nums'>
                    {fmt.cny(row.gift_consumption_usd)}
                    {share != null && (
                      <span
                        className={`ml-1 text-xs ${warn ? TONES.warning : 'text-muted-foreground'}`}
                        title={t('Gift share of use')}
                      >
                        {fmt.pct(share)}
                      </span>
                    )}
                  </span>
                )
              },
            },
            {
              key: 'net',
              label: t('Net'),
              hint: t(
                'The change is against the previous period of the same length.'
              ),
              align: 'right',
              render: (row) => {
                const { net } = channelEconomics(row, rate)
                const prior = previousRows.get(channelKey(row))
                const moved = prior
                  ? net - channelEconomics(prior, previousRate).net
                  : null
                return (
                  <span className='tabular-nums'>
                    <span className={TONES[tone(net)]}>{fmt.cny(net)}</span>
                    {moved != null && Math.abs(moved) >= 0.01 && (
                      <span className='text-muted-foreground ml-1 text-xs'>
                        {signed(moved)}
                      </span>
                    )}
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
                if (roi == null || roiMuted(days, row.new_payers)) return '-'
                return fmt.pct(roi)
              },
            },
            {
              key: 'cac',
              label: t('Fee per new payer'),
              align: 'right',
              render: (row) => {
                const { cac } = channelEconomics(row, rate)
                if (cac == null || roiMuted(days, row.new_payers)) return '-'
                return fmt.cny(cac)
              },
            },
          ]}
        />
      </Panel>
      <Panel
        title={t('Sign-ups by source')}
        help={cohortHelp}
        description={t(
          'Rates show from {{count}} sign-ups. Against organic: the rate as a multiple of organic sign-ups’, when both reach {{count}}.',
          { count: MIN_COHORT }
        )}
      >
        <SimpleTable<ChannelRow>
          rows={cohortRows}
          rowKey={(row) => channelKey(row)}
          empty={t('No data')}
          faded={(row) => row.registered < MIN_COHORT}
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
                  rate={rateOf(row.activated, row.registered)}
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
                  rate={rateOf(row.paid, row.registered)}
                />
              ),
            },
            {
              key: 'lift',
              label: t('Against organic'),
              hint: t(
                'Activation and paying rates as multiples of organic sign-ups’ rates, when both cohorts reach the minimum.'
              ),
              align: 'right',
              render: (row) => {
                if (row.segment === 'organic') return '-'
                const lift = organicLift(row, organic)
                if (lift.activated == null && lift.paid == null) return '-'
                return (
                  <span className='tabular-nums'>
                    {t('Active {{active}}, paid {{paid}}', {
                      active:
                        lift.activated == null
                          ? '-'
                          : fmt.multiple(lift.activated),
                      paid: lift.paid == null ? '-' : fmt.multiple(lift.paid),
                    })}
                  </span>
                )
              },
            },
            {
              key: 'repeat',
              label: t('Paid again'),
              align: 'right',
              render: (row) => (
                <CountRate
                  count={fmt.num(row.repeat)}
                  rate={rateOf(row.repeat, row.paid)}
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
              label: t('Unspent now'),
              hint: t(
                'Valued now, whatever the range: it does not compare with the range’s figures.'
              ),
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
