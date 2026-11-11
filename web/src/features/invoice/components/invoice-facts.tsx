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

import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'

import {
  INVOICE_ORDER_TYPE_LABEL,
  INVOICE_STATUS_CONFIG,
  INVOICE_TAX_METHOD_LABEL,
} from '../constants'
import { formatInvoiceAmount } from '../lib/amount'
import type { Invoice, InvoiceItem, InvoiceTaxMethod } from '../types'

/**
 * An application's status, title, amounts and orders, as both the customer
 * and an administrator read them.
 */
export function InvoiceFacts(props: {
  invoice: Invoice
  items: InvoiceItem[]
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const invoice = props.invoice
  const status = INVOICE_STATUS_CONFIG[invoice.status]
  const taxMethod =
    INVOICE_TAX_METHOD_LABEL[invoice.tax_method as InvoiceTaxMethod]
  const rows = [
    { label: t('Invoice type'), value: t('General VAT invoice') },
    {
      label: t('Title type'),
      value: invoice.title_type === 'company' ? t('Company') : t('Individual'),
    },
    { label: t('Invoice title'), value: invoice.title },
    { label: t('Taxpayer identification number'), value: invoice.tax_no },
    { label: t('Product category'), value: invoice.category },
    { label: t('Email for the invoice'), value: invoice.email },
    {
      label: t('Invoice amount'),
      value: formatInvoiceAmount(invoice.order_cents, locale),
    },
    {
      label: t('Tax ({{rate}}%)', { rate: invoice.tax_rate }),
      value: formatInvoiceAmount(invoice.tax_cents, locale),
    },
    { label: t('Paid with'), value: taxMethod ? t(taxMethod) : '' },
    { label: t('Tax order number'), value: invoice.tax_trade_no },
    {
      label: t('Submitted at'),
      value: formatTimestampToDate(invoice.created_time),
    },
    {
      label: t('Tax paid at'),
      value: invoice.tax_paid_time
        ? formatTimestampToDate(invoice.tax_paid_time)
        : '',
    },
    {
      label: t('Issued at'),
      value: invoice.issued_time
        ? formatTimestampToDate(invoice.issued_time)
        : '',
    },
  ].filter((row) => row.value !== '')

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <StatusBadge
          label={t(status?.labelKey ?? invoice.status)}
          variant={status?.variant ?? 'neutral'}
          showDot
          copyable={false}
        />
      </div>
      {invoice.status === 'rejected' && invoice.reject_reason && (
        <p className='bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm break-words'>
          {t('Rejection reason: {{reason}}', { reason: invoice.reject_reason })}
        </p>
      )}
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm'>
        {rows.map((row) => (
          <div key={row.label} className='contents'>
            <dt className='text-muted-foreground'>{row.label}</dt>
            <dd className='min-w-0 break-all'>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className='flex flex-col gap-2'>
        <span className='text-sm font-medium'>
          {t('Orders in this application')}
        </span>
        <ul className='flex max-h-64 flex-col gap-1.5 overflow-y-auto'>
          {props.items.map((item) => (
            <li
              key={item.id}
              className='flex items-center gap-2 rounded-md border px-3 py-2 text-xs'
            >
              <StatusBadge
                label={t(INVOICE_ORDER_TYPE_LABEL[item.order_type])}
                variant='neutral'
                size='sm'
                copyable={false}
              />
              <span className='min-w-0 flex-1 truncate font-mono'>
                {item.trade_no}
              </span>
              <span className='shrink-0 tabular-nums'>
                {formatInvoiceAmount(item.amount_cents, locale)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
