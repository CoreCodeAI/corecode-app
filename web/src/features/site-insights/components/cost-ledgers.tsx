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
import { paymentMethodLabel } from '@/features/wallet/lib/billing'

import { saveCommissionExempt, saveIPCosts, savePaymentFeeRates } from '../api'
import { tableState, useInsightsFormat, type SourceState } from '../lib'
import type {
  FinanceInsights,
  IPCost,
  PaymentFee,
  PaymentFeeRate,
} from '../types'
import { Panel, SimpleTable, UserLabel } from './shared'

const DAY_SECONDS = 86400
const CYCLES = [1, 3, 6, 12] as const

/** Local midnight of a date input's value, in unix seconds. */
function dateSeconds(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000)
}

function useSavedToast(message: string) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return {
    onSuccess: () => {
      toast.success(t(message))
      void queryClient.invalidateQueries({ queryKey: ['site-insights'] })
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  }
}

/**
 * The egress IPs and proxy hosts, each with its price and billing cycle. The
 * funds view spreads each over the range, a thirtieth of a month a day, and
 * the gross margin subtracts it.
 */
export function IPCostsPanel(props: {
  data: FinanceInsights | undefined
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<IPCost['currency']>('CNY')
  const [cycle, setCycle] = useState<IPCost['cycle_months']>(1)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const save = useMutation({
    mutationFn: saveIPCosts,
    ...useSavedToast('IP costs saved'),
  })
  // Undefined until read, or on a server before this release: nothing can be
  // saved over a list that was not read.
  const stored = props.data?.ip_costs ?? undefined
  const price = Number(amount)
  const valid =
    stored != null &&
    name.trim() !== '' &&
    amount !== '' &&
    Number.isFinite(price) &&
    price >= 0 &&
    start !== '' &&
    (end === '' || end >= start)
  const add = () => {
    if (!valid || !stored) return
    const entry: IPCost = {
      name: name.trim(),
      amount: price,
      currency,
      cycle_months: cycle,
      start: dateSeconds(start),
      // The end date is the last day paid for.
      end: end ? dateSeconds(end) + DAY_SECONDS : 0,
      note,
    }
    save.mutate([...stored, entry], {
      onSuccess: () => {
        setName('')
        setAmount('')
        setNote('')
        setEnd('')
      },
    })
  }
  const money = (value: number, unit: IPCost['currency']) =>
    unit === 'USD' ? fmt.usd(value) : fmt.cny(value)
  const total = props.data
    ? t('{{cny}} and {{usd}} over this range', {
        cny: fmt.cny(props.data.ip_cost_cny ?? 0),
        usd: fmt.usd(props.data.ip_cost_usd ?? 0),
      })
    : undefined

  return (
    <Panel
      title={t('IP costs')}
      description={total}
      help={t(
        'Every egress IP and proxy host, with what it costs per billing cycle. Each entry counts every day from its start to its last day, a thirtieth of a month a day; with no last day it runs until now. A changed price is a new entry: give the old one a last day. The gross margin subtracts the total, dollars at the site’s exchange rate.'
      )}
    >
      <div className='grid gap-3'>
        <SimpleTable<IPCost>
          rows={stored}
          rowKey={(row, index) => `${row.name}-${row.start}-${index}`}
          empty={t('No IP costs recorded')}
          state={tableState(props.source, stored)}
          columns={[
            { key: 'name', label: t('IP or host'), render: (row) => row.name },
            {
              key: 'amount',
              label: t('Price'),
              align: 'right',
              render: (row) => money(row.amount, row.currency),
            },
            {
              key: 'cycle',
              label: t('Billing cycle'),
              align: 'right',
              render: (row) =>
                t('{{months}}-month cycle', { months: row.cycle_months }),
            },
            {
              key: 'monthly',
              label: t('Per month'),
              align: 'right',
              render: (row) =>
                money(row.amount / row.cycle_months, row.currency),
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
                  onClick={() => {
                    if (stored) {
                      save.mutate(stored.filter((cost) => cost !== row))
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              ),
            },
          ]}
        />
        <div className='flex flex-wrap items-end gap-2'>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('IP or host')}</span>
            <Input
              className='h-7 w-40'
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('Price')}</span>
            <Input
              className='h-7 w-28'
              type='number'
              min={0}
              step='any'
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('Currency')}</span>
            <NativeSelect
              size='sm'
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value as IPCost['currency'])
              }
            >
              <NativeSelectOption value='CNY'>CNY</NativeSelectOption>
              <NativeSelectOption value='USD'>USD</NativeSelectOption>
            </NativeSelect>
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('Billing cycle')}</span>
            <NativeSelect
              size='sm'
              value={String(cycle)}
              onChange={(event) =>
                setCycle(Number(event.target.value) as IPCost['cycle_months'])
              }
            >
              {CYCLES.map((months) => (
                <NativeSelectOption key={months} value={String(months)}>
                  {t('{{months}}-month cycle', { months })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
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

/**
 * The affiliate accounts whose commission is not a cost: the site's own
 * promotion accounts, which never withdraw it. The profit waterfall leaves
 * their commission out.
 */
export function CommissionExemptPanel(props: {
  data: FinanceInsights | undefined
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [userID, setUserID] = useState('')
  const save = useMutation({
    mutationFn: saveCommissionExempt,
    ...useSavedToast('Commission exemptions saved'),
  })
  const stored = props.data?.commission_exempt ?? undefined
  const ids = stored?.map((row) => row.user_id) ?? []
  const id = Number(userID)
  const valid =
    stored != null && Number.isInteger(id) && id > 0 && !ids.includes(id)
  const description = props.data
    ? t('{{exempt}} of {{total}} commission in this range left out', {
        exempt: fmt.cny(props.data.commission_exempt_usd ?? 0),
        total: fmt.cny(props.data.commission_usd),
      })
    : undefined

  return (
    <Panel
      title={t('Commission not counted as cost')}
      description={description}
      help={t(
        'Accounts listed here are the site’s own promotion accounts. Their commission stays in their wallets and is never withdrawn, so the profit waterfall leaves it out. Every other account’s commission still counts.'
      )}
    >
      <div className='grid gap-3'>
        <SimpleTable
          rows={stored}
          rowKey={(row) => String(row.user_id)}
          empty={t('No accounts exempted')}
          state={tableState(props.source, stored)}
          columns={[
            {
              key: 'user',
              label: t('Account'),
              render: (row) => (
                <UserLabel user_id={row.user_id} username={row.username} />
              ),
            },
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
                    save.mutate(ids.filter((other) => other !== row.user_id))
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
            <span className='text-muted-foreground'>{t('User ID')}</span>
            <Input
              className='h-7 w-28'
              type='number'
              min={1}
              step={1}
              value={userID}
              onChange={(event) => setUserID(event.target.value)}
            />
          </label>
          <Button
            size='sm'
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate([...ids, id], { onSuccess: () => setUserID('') })
            }
          >
            {t('Add')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/** One payment method's row: its fee in the range and the rate it was priced at. */
type PaymentFeeRow = PaymentFee & { rate: PaymentFeeRate | undefined }

/**
 * What each payment method's processor kept of the range's paid orders, at a
 * rate the operator can change. The gross margin subtracts the fees' share of
 * the cash, applied to recognized revenue.
 */
export function PaymentFeesPanel(props: {
  data: FinanceInsights | undefined
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [method, setMethod] = useState('')
  const [percent, setPercent] = useState('')
  const [fixed, setFixed] = useState('')
  const save = useMutation({
    mutationFn: savePaymentFeeRates,
    ...useSavedToast('Payment fee rates saved'),
  })
  const rates = props.data?.payment_fee_rates ?? undefined
  const fees = props.data?.payment_fees ?? undefined
  const rows: PaymentFeeRow[] | undefined =
    rates && fees
      ? [
          ...fees.map((fee) => ({
            ...fee,
            rate: rates.find((rate) => rate.method === fee.method),
          })),
          // Rates for methods with no orders in the range, so they can be edited.
          ...rates
            .filter((rate) => !fees.some((fee) => fee.method === rate.method))
            .map((rate) => ({
              method: rate.method,
              orders: 0,
              money: 0,
              refunded: 0,
              fee: 0,
              priced: true,
              rate,
            })),
        ]
      : undefined
  const percentValue = Number(percent)
  const fixedValue = fixed === '' ? 0 : Number(fixed)
  const valid =
    rates != null &&
    method.trim() !== '' &&
    percent !== '' &&
    Number.isFinite(percentValue) &&
    percentValue >= 0 &&
    percentValue <= 50 &&
    Number.isFinite(fixedValue) &&
    fixedValue >= 0
  const put = () => {
    if (!valid || !rates) return
    const key = method.trim()
    save.mutate(
      [
        ...rates.filter((rate) => rate.method !== key),
        { method: key, percent: percentValue, fixed: fixedValue },
      ],
      {
        onSuccess: () => {
          setMethod('')
          setPercent('')
          setFixed('')
        },
      }
    )
  }
  const cash = fees?.reduce((sum, row) => sum + row.money, 0) ?? 0
  const total = fees?.reduce((sum, row) => sum + row.fee, 0) ?? 0
  const unpriced = fees?.filter((row) => !row.priced && row.money > 0) ?? []
  const description = fees
    ? [
        t('{{fee}} of {{cash}} cash in this range ({{rate}})', {
          fee: fmt.cny(total),
          cash: fmt.cny(cash),
          rate: cash > 0 ? fmt.pct(total / cash) : '-',
        }),
        unpriced.length > 0 &&
          t(
            'No rate is recorded for {{methods}}; their fees count as nothing.',
            {
              methods: unpriced
                .map((row) => paymentMethodLabel(row.method, t))
                .join(t(', ')),
            }
          ),
      ]
        .filter(Boolean)
        .join(' ')
    : undefined
  const rateText = (rate: PaymentFeeRate | undefined) => {
    if (!rate) return t('No rate')
    if (rate.fixed <= 0) return `${rate.percent}%`
    return t('{{percent}}% + {{fixed}}', {
      percent: rate.percent,
      fixed: fmt.cny(rate.fixed),
    })
  }

  return (
    <Panel
      title={t('Payment fees')}
      description={description}
      help={t(
        'What each payment processor keeps of an order: a percentage of its money plus a fixed amount in yuan. A refunded order keeps its fee, so it counts here though its money does not. The gross margin subtracts the fees’ share of the cash, applied to recognized revenue. Saving a rate for a method replaces its old one; deleting every rate restores the measured defaults.'
      )}
    >
      <div className='grid gap-3'>
        <SimpleTable<PaymentFeeRow>
          rows={rows}
          rowKey={(row) => row.method}
          empty={t('No paid orders in this range')}
          state={tableState(props.source, rows)}
          columns={[
            {
              key: 'method',
              label: t('Payment method'),
              render: (row) => paymentMethodLabel(row.method, t),
            },
            {
              key: 'orders',
              label: t('Orders'),
              align: 'right',
              render: (row) =>
                row.refunded > 0
                  ? t('{{orders}} + {{refunded}} refunded', {
                      orders: fmt.num(row.orders),
                      refunded: fmt.num(row.refunded),
                    })
                  : fmt.num(row.orders),
            },
            {
              key: 'money',
              label: t('Cash'),
              align: 'right',
              render: (row) => fmt.cny(row.money),
            },
            {
              key: 'rate',
              label: t('Rate'),
              align: 'right',
              render: (row) => rateText(row.rate),
            },
            {
              key: 'fee',
              label: t('Fee'),
              align: 'right',
              render: (row) => fmt.cny(row.fee),
            },
            {
              key: 'remove',
              label: '',
              align: 'right',
              render: (row) =>
                row.rate && (
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Delete')}
                    disabled={save.isPending}
                    onClick={() => {
                      if (rates) {
                        save.mutate(
                          rates.filter((rate) => rate.method !== row.method)
                        )
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                ),
            },
          ]}
        />
        <div className='flex flex-wrap items-end gap-2'>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('Payment method')}</span>
            <Input
              className='h-7 w-40'
              maxLength={50}
              list='payment-fee-methods'
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            />
            <datalist id='payment-fee-methods'>
              {rows?.map((row) => (
                <option key={row.method} value={row.method} />
              ))}
            </datalist>
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>{t('Percent')}</span>
            <Input
              className='h-7 w-24'
              type='number'
              min={0}
              max={50}
              step='any'
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
            />
          </label>
          <label className='grid gap-1 text-xs'>
            <span className='text-muted-foreground'>
              {t('Fixed per order (yuan)')}
            </span>
            <Input
              className='h-7 w-24'
              type='number'
              min={0}
              step='any'
              value={fixed}
              onChange={(event) => setFixed(event.target.value)}
            />
          </label>
          <Button size='sm' disabled={!valid || save.isPending} onClick={put}>
            {t('Save rate')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
