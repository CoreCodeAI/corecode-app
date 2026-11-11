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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { ReceiptText, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SELF_QUERY_KEY, useSelf } from '@/hooks/use-self'
import { useAuthStore } from '@/stores/auth-store'

import {
  getInvoiceConfig,
  getInvoiceSummary,
  getInvoiceableOrders,
} from './api'
import { InvoiceForm } from './components/invoice-form'
import { InvoiceSummary } from './components/invoice-summary'
import { InvoiceableOrders } from './components/invoiceable-orders'
import { MyInvoices } from './components/my-invoices'
import { INVOICE_KEY } from './constants'
import { orderKey } from './lib/order-key'
import { toggleSelection, visibleSelection } from './lib/selection'
import type { InvoiceableOrder } from './types'

const route = getRouteApi('/_authenticated/invoice/')
const NO_ORDERS: InvoiceableOrder[] = []

/**
 * The invoice center: pick paid orders, fill in the title, pay the tax, and
 * download the invoice once an administrator has issued it.
 */
export function InvoiceCenter() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const queryClient = useQueryClient()
  const self = useSelf()
  const email = useAuthStore((state) => state.auth.user?.email ?? '')
  const config = useQuery({
    queryKey: [...INVOICE_KEY, 'config'],
    queryFn: getInvoiceConfig,
  })
  const enabled = config.data?.enabled === true
  const summary = useQuery({
    queryKey: [...INVOICE_KEY, 'summary'],
    queryFn: getInvoiceSummary,
    enabled,
  })
  const orders = useQuery({
    queryKey: [...INVOICE_KEY, 'orders'],
    queryFn: getInvoiceableOrders,
    enabled,
  })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: INVOICE_KEY }),
      queryClient.invalidateQueries({ queryKey: SELF_QUERY_KEY }),
    ])
  }, [queryClient])

  useEffect(() => {
    if (search.pay !== 'return') return
    toast.info(
      t('Payment received. The application status updates once confirmed.')
    )
    void refresh()
    void navigate({ search: {}, replace: true })
  }, [search.pay, refresh, navigate, t])

  const orderList = orders.data ?? NO_ORDERS
  // Orders that left the list (now in an application) leave the selection.
  const chosen = useMemo(
    () => orderList.filter((order) => selected.has(orderKey(order))),
    [orderList, selected]
  )
  const chosenKeys = useMemo(
    () => visibleSelection(orderList, selected),
    [orderList, selected]
  )
  const maxOrders = config.data?.max_orders ?? 0

  function toggle(order: InvoiceableOrder, checked: boolean) {
    setSelected(toggleSelection(chosenKeys, order, checked, maxOrders))
  }

  function toggleAll(checked: boolean) {
    setSelected(
      checked ? new Set(orderList.slice(0, maxOrders).map(orderKey)) : new Set()
    )
  }

  let content
  if (config.isPending) {
    content = (
      <div className='flex flex-col gap-4'>
        <Skeleton className='h-24 rounded-xl' />
        <Skeleton className='h-80 rounded-xl' />
      </div>
    )
  } else if (!config.data?.enabled) {
    content = (
      <EmptyState
        icon={ReceiptText}
        title={t('Invoicing is not available')}
        description={t('The administrator has not enabled invoicing.')}
        className='min-h-[320px]'
      />
    )
  } else {
    content = (
      <div className='flex flex-col gap-4'>
        <InvoiceSummary
          summary={summary.data}
          loading={summary.isPending}
          error={summary.isError}
        />
        <div className='grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.46fr)] xl:items-start'>
          <div className='flex min-w-0 flex-col gap-4'>
            <InvoiceableOrders
              orders={orderList}
              loading={orders.isPending}
              selected={chosenKeys}
              maxOrders={maxOrders}
              orderDays={config.data.order_days}
              onToggle={toggle}
              onToggleAll={toggleAll}
            />
            <MyInvoices
              payMethods={config.data.pay_methods}
              onChanged={() => void refresh()}
            />
          </div>
          <div className='xl:sticky xl:top-6'>
            <InvoiceForm
              config={config.data}
              orders={chosen}
              defaultEmail={self.data?.email ?? email}
              balance={self.data?.quota ?? 0}
              onSubmitted={() => {
                setSelected(new Set())
                void refresh()
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Invoice center')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            await refresh()
            setRefreshing(false)
          }}
        >
          <RefreshCw
            className={refreshing ? 'animate-spin' : undefined}
            aria-hidden='true'
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-6xl'>{content}</div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
