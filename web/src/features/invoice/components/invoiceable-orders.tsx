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
import { ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'

import { INVOICE_ORDER_TYPE_LABEL } from '../constants'
import { formatInvoiceAmount } from '../lib/amount'
import { orderKey } from '../lib/order-key'
import type { InvoiceableOrder } from '../types'

/** The paid orders the customer can pick, with select-all up to the cap. */
export function InvoiceableOrders(props: {
  orders: InvoiceableOrder[]
  loading: boolean
  selected: ReadonlySet<string>
  maxOrders: number
  orderDays: number
  onToggle: (order: InvoiceableOrder, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const selectable = Math.min(props.orders.length, props.maxOrders)
  const allSelected = selectable > 0 && props.selected.size >= selectable
  const full = props.selected.size >= props.maxOrders

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Invoiceable orders')}</CardTitle>
        <CardDescription>
          {t(
            'Orders paid in the last {{days}} days. At most {{max}} orders per application.',
            { days: props.orderDays, max: props.maxOrders }
          )}
        </CardDescription>
        {props.orders.length > 0 && (
          <CardAction>
            <label className='flex cursor-pointer items-center gap-2 text-sm'>
              <Checkbox
                checked={allSelected}
                indeterminate={props.selected.size > 0 && !allSelected}
                onCheckedChange={(checked) => props.onToggleAll(checked)}
              />
              {t('Select all')}
            </label>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {props.loading && (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-14 rounded-lg' />
            <Skeleton className='h-14 rounded-lg' />
          </div>
        )}
        {!props.loading && props.orders.length === 0 && (
          <EmptyState
            icon={ReceiptText}
            title={t('No invoiceable orders')}
            description={t(
              'Paid top-ups and plan purchases appear here. Plans bought with balance are invoiced through the top-up that funded them.'
            )}
            className='min-h-[200px]'
          />
        )}
        {!props.loading && props.orders.length > 0 && (
          <ul
            className='flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1'
            aria-label={t('Invoiceable orders')}
          >
            {props.orders.map((order) => {
              const key = orderKey(order)
              const checked = props.selected.has(key)
              return (
                <li key={key}>
                  <label className='hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-50'>
                    <Checkbox
                      checked={checked}
                      disabled={!checked && full}
                      onCheckedChange={(next) => props.onToggle(order, next)}
                      aria-label={order.trade_no}
                    />
                    <div className='flex min-w-0 flex-1 flex-col gap-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <StatusBadge
                          label={t(INVOICE_ORDER_TYPE_LABEL[order.order_type])}
                          variant='neutral'
                          size='sm'
                          copyable={false}
                        />
                        <span className='truncate font-mono text-xs'>
                          {order.trade_no}
                        </span>
                      </div>
                      <span className='text-muted-foreground text-xs tabular-nums'>
                        {formatTimestampToDate(order.paid_time)}
                      </span>
                    </div>
                    <span className='shrink-0 font-semibold tabular-nums'>
                      {formatInvoiceAmount(order.amount_cents, locale)}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
