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
import { FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { submitPaymentForm } from '@/features/wallet/lib/payment'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import {
  cancelInvoice,
  downloadMyInvoice,
  getMyInvoice,
  getMyInvoices,
  payInvoiceTax,
} from '../api'
import {
  INVOICE_KEY,
  INVOICE_STATUS_CONFIG,
  INVOICE_STATUSES,
  INVOICE_TAX_METHOD_LABEL,
} from '../constants'
import { formatInvoiceAmount } from '../lib/amount'
import type { Invoice, InvoiceEpayMethod, InvoiceTaxMethod } from '../types'
import { InvoiceFacts } from './invoice-facts'

const PAGE_SIZE = 10
const ALL = 'all'

function InvoiceDetailDialog(props: { id: number; onClose: () => void }) {
  const { t } = useTranslation()
  const detail = useQuery({
    queryKey: [...INVOICE_KEY, 'detail', props.id],
    queryFn: () => getMyInvoice(props.id),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={t('Application #{{id}}', { id: props.id })}
      contentClassName='sm:max-w-lg'
    >
      {detail.isPending && <Skeleton className='h-40' />}
      {detail.data && (
        <InvoiceFacts invoice={detail.data.invoice} items={detail.data.items} />
      )}
    </Dialog>
  )
}

/** The customer's applications, with paying, cancelling and downloading. */
export function MyInvoices(props: {
  payMethods: InvoiceEpayMethod[]
  onChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState(ALL)
  const [openId, setOpenId] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState<Invoice | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const list = useQuery({
    queryKey: [...INVOICE_KEY, 'self', page, status],
    queryFn: () =>
      getMyInvoices(
        { p: page, page_size: PAGE_SIZE },
        status === ALL ? undefined : status
      ),
    placeholderData: (previous) => previous,
  })
  const items = list.data?.items ?? []
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE))
  // A cancellation or expiry can shrink the list under the current page.
  const lastPage = list.data ? pages : page
  useEffect(() => {
    if (page > lastPage) setPage(lastPage)
  }, [page, lastPage])

  async function pay(invoice: Invoice, method: InvoiceTaxMethod) {
    setBusyId(invoice.id)
    try {
      const result = await payInvoiceTax(invoice.id, method)
      if (result.url && result.params) {
        submitPaymentForm(result.url, result.params)
      } else {
        toast.success(t('The tax was paid with your balance'))
        props.onChanged()
      }
    } catch (error) {
      handleServerError(error, t('Failed to start payment'))
    } finally {
      setBusyId(null)
    }
  }

  async function confirmCancel() {
    if (!cancelling) return
    setBusyId(cancelling.id)
    try {
      await cancelInvoice(cancelling.id)
      toast.success(t('Application cancelled'))
      setCancelling(null)
      props.onChanged()
    } catch (error) {
      handleServerError(error, t('Failed to cancel the application'))
    } finally {
      setBusyId(null)
    }
  }

  async function download(invoice: Invoice) {
    setBusyId(invoice.id)
    try {
      await downloadMyInvoice(invoice)
    } catch (error) {
      handleServerError(error, t('Failed to download the invoice'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('My applications')}</CardTitle>
        <CardAction>
          <NativeSelect
            size='sm'
            className='w-36'
            value={status}
            aria-label={t('Filter by status')}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
          >
            <NativeSelectOption value={ALL}>
              {t('All statuses')}
            </NativeSelectOption>
            {INVOICE_STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(INVOICE_STATUS_CONFIG[value].labelKey)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </CardAction>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {list.isPending && <Skeleton className='h-20 rounded-lg' />}
        {!list.isPending && items.length === 0 && (
          <EmptyState
            icon={FileText}
            title={t('No applications yet')}
            description={t('Applications you submit appear here.')}
            className='min-h-40'
          />
        )}
        {items.length > 0 && (
          <ul className='flex flex-col gap-2' aria-label={t('My applications')}>
            {items.map((invoice) => {
              const config = INVOICE_STATUS_CONFIG[invoice.status]
              const busy = busyId === invoice.id
              return (
                <li
                  key={invoice.id}
                  className='flex flex-col gap-2 rounded-lg border px-3 py-2.5'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-sm font-medium'>#{invoice.id}</span>
                    <StatusBadge
                      label={t(config?.labelKey ?? invoice.status)}
                      variant={config?.variant ?? 'neutral'}
                      size='sm'
                      copyable={false}
                    />
                    <span className='min-w-0 flex-1 truncate text-sm'>
                      {invoice.title}
                    </span>
                    <span className='shrink-0 font-semibold tabular-nums'>
                      {formatInvoiceAmount(invoice.order_cents, locale)}
                    </span>
                  </div>
                  <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
                    <span className='tabular-nums'>
                      {formatTimestampToDate(invoice.created_time)}
                    </span>
                    <span className='tabular-nums'>
                      {t('Tax: {{amount}}', {
                        amount: formatInvoiceAmount(invoice.tax_cents, locale),
                      })}
                    </span>
                  </div>
                  {invoice.status === 'rejected' && invoice.reject_reason && (
                    <p className='text-destructive text-xs break-words'>
                      {t('Rejection reason: {{reason}}', {
                        reason: invoice.reject_reason,
                      })}
                    </p>
                  )}
                  <div className='flex flex-wrap justify-end gap-2'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setOpenId(invoice.id)}
                    >
                      {t('Details')}
                    </Button>
                    {invoice.status === 'pending_payment' && (
                      <>
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={busy}
                          onClick={() => setCancelling(invoice)}
                        >
                          {t('Cancel application')}
                        </Button>
                        {(
                          ['balance', ...props.payMethods] as InvoiceTaxMethod[]
                        ).map((method) => (
                          <Button
                            key={method}
                            variant={
                              method === 'balance' ? 'outline' : 'default'
                            }
                            size='sm'
                            disabled={busy}
                            onClick={() => void pay(invoice, method)}
                          >
                            {t('Pay with {{method}}', {
                              method: t(INVOICE_TAX_METHOD_LABEL[method]),
                            })}
                          </Button>
                        ))}
                      </>
                    )}
                    {invoice.status === 'issued' && (
                      <Button
                        size='sm'
                        disabled={busy}
                        onClick={() => void download(invoice)}
                      >
                        {t('Download invoice')}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {pages > 1 && (
          <div className='flex items-center justify-end gap-2 text-sm'>
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('Previous page')}
            </Button>
            <span className='tabular-nums'>
              {page} / {pages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t('Next page')}
            </Button>
          </div>
        )}
      </CardContent>
      {openId !== null && (
        <InvoiceDetailDialog id={openId} onClose={() => setOpenId(null)} />
      )}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={t('Cancel application')}
        desc={t(
          'The selected orders become invoiceable again. Tax that has not been paid is not charged.'
        )}
        confirmText={t('Cancel application')}
        destructive
        isLoading={cancelling !== null && busyId === cancelling.id}
        handleConfirm={() => void confirmCancel()}
      />
    </Card>
  )
}
