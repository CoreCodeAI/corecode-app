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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import i18next from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { completeOrder, isApiSuccess } from '@/features/wallet/api'
import { formatPaymentMoney } from '@/features/wallet/lib'
import {
  getPaymentMethodName,
  getStatusConfig,
} from '@/features/wallet/lib/billing'
import { formatCurrencyFromUSD } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { getTopupRecords, getTopupStats } from './api'
import { TopupFilterBar } from './components/topup-filter-bar'
import { TopupSummary } from './components/topup-summary'
import type { TopupReportFilters, TopupReportRecord } from './types'

const route = getRouteApi('/_authenticated/topups/')
const EMPTY: TopupReportRecord[] = []
const RECORDS_KEY = ['topup-records'] as const

// Marking orders refunded has no control here: `POST /api/user/topup/refund`
// (see `refundTopups`) is called by a script.
function useTopupColumns(
  onComplete: (record: TopupReportRecord) => void
): ColumnDef<TopupReportRecord>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'create_time',
        header: t('Time'),
        size: 170,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {formatTimestampToDate(row.original.create_time)}
          </span>
        ),
        meta: { label: t('Time'), mobileTitle: true },
      },
      {
        accessorKey: 'username',
        header: t('User'),
        size: 150,
        cell: ({ row }) => (
          <span className='truncate'>
            {row.original.username || '-'}{' '}
            <span className='text-muted-foreground font-mono text-xs'>
              #{row.original.user_id}
            </span>
          </span>
        ),
        meta: { label: t('User') },
      },
      {
        accessorKey: 'trade_no',
        header: t('Order number'),
        size: 200,
        cell: ({ row }) => (
          <StatusBadge
            label={row.original.trade_no}
            variant='neutral'
            size='sm'
            copyText={row.original.trade_no}
            className='max-w-full font-mono'
          />
        ),
        meta: { label: t('Order number') },
      },
      {
        accessorKey: 'payment_method',
        header: t('Payment Method'),
        size: 120,
        cell: ({ row }) =>
          getPaymentMethodName(row.original.payment_method, t) || '-',
        meta: { label: t('Payment Method') },
      },
      {
        accessorKey: 'amount',
        header: t('Amount'),
        size: 110,
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatCurrencyFromUSD(row.original.amount, {
              digitsLarge: 2,
              digitsSmall: 2,
              abbreviate: false,
            })}
          </span>
        ),
        meta: { label: t('Amount') },
      },
      {
        accessorKey: 'money',
        header: t('Payment'),
        size: 110,
        cell: ({ row }) => (
          <span className='font-medium tabular-nums'>
            {formatPaymentMoney(row.original.money)}
          </span>
        ),
        meta: { label: t('Payment') },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        size: 100,
        cell: ({ row }) => {
          const config = getStatusConfig(row.original.status)
          return (
            <StatusBadge
              label={t(config.label)}
              variant={config.variant}
              showDot
              copyable={false}
            />
          )
        },
        meta: { label: t('Status') },
      },
      {
        id: 'actions',
        header: '',
        size: 130,
        cell: ({ row }) => {
          if (row.original.status === 'pending') {
            return (
              <Button
                size='sm'
                variant='outline'
                onClick={() => onComplete(row.original)}
              >
                {t('Complete Order')}
              </Button>
            )
          }
          return null
        },
      },
    ],
    [t, onComplete]
  )
}

export function TopupRecords() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  // Fixed for the page's lifetime so the default range does not move while
  // the queries that use it are cached.
  const [defaultRange] = useState(() => ({
    start_time: dayjs().subtract(29, 'day').startOf('day').unix(),
    end_time: dayjs().add(1, 'day').startOf('day').unix(),
  }))
  const filters: TopupReportFilters = {
    start_time: search.start ?? defaultRange.start_time,
    end_time: search.end ?? defaultRange.end_time,
    user: search.user,
    trade_no: search.trade_no,
    status: search.status,
    payment_method: search.method,
  }
  const pagination = {
    pageIndex: (search.page ?? 1) - 1,
    pageSize: search.pageSize ?? 20,
  }

  const records = useQuery({
    queryKey: [...RECORDS_KEY, 'list', filters, pagination],
    queryFn: () =>
      getTopupRecords(filters, {
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: (previous) => previous,
  })
  const stats = useQuery({
    queryKey: [...RECORDS_KEY, 'stats', filters],
    queryFn: () => getTopupStats(filters),
    placeholderData: (previous) => previous,
  })

  const [completing, setCompleting] = useState<TopupReportRecord | null>(null)
  const complete = useMutation({
    mutationFn: async (tradeNo: string) => {
      const response = await completeOrder({ trade_no: tradeNo })
      if (!isApiSuccess(response)) {
        throw createServerError(response, 'Failed to complete order')
      }
    },
    onSuccess: async () => {
      toast.success(i18next.t('Order completed successfully'))
      setCompleting(null)
      await queryClient.invalidateQueries({ queryKey: RECORDS_KEY })
    },
    onError: (error) =>
      handleServerError(error, i18next.t('Failed to complete order')),
  })

  const columns = useTopupColumns(setCompleting)
  const { table } = useDataTable<TopupReportRecord>({
    columns,
    data: records.data?.items ?? EMPTY,
    getRowId: (row) => String(row.id),
    totalCount: records.data?.total ?? 0,
    pagination,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater
      void navigate({
        search: (previous) => ({
          ...previous,
          page: next.pageSize === pagination.pageSize ? next.pageIndex + 1 : 1,
          pageSize: next.pageSize,
        }),
      })
    },
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })

  const applyFilters = (next: TopupReportFilters) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        page: 1,
        start:
          next.start_time === defaultRange.start_time
            ? undefined
            : next.start_time,
        end:
          next.end_time === defaultRange.end_time ? undefined : next.end_time,
        user: next.user?.trim() || undefined,
        trade_no: next.trade_no?.trim() || undefined,
        status: next.status || undefined,
        method: next.payment_method || undefined,
      }),
    })
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Top-up Records')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='flex flex-col gap-3 sm:gap-4'>
            <TopupSummary stats={stats.data} loading={stats.isPending} />
            <DataTablePage
              table={table}
              columns={columns}
              isLoading={records.isPending}
              isFetching={records.isFetching}
              emptyTitle={t('No top-up records')}
              emptyDescription={t('Try adjusting the filters or date range.')}
              toolbar={
                <TopupFilterBar
                  key={JSON.stringify(filters)}
                  table={table}
                  filters={filters}
                  defaultRange={defaultRange}
                  paymentMethods={stats.data?.payment_methods ?? []}
                  loading={records.isFetching}
                  onApply={applyFilters}
                />
              }
              className='h-auto min-h-0'
              applyHeaderSize
            />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <ConfirmDialog
        open={completing !== null}
        onOpenChange={(open) => !open && setCompleting(null)}
        title={t('Confirm Complete Order')}
        desc={t(
          'Are you sure you want to manually complete order {{tradeNo}}? This action cannot be undone.',
          { tradeNo: completing?.trade_no ?? '' }
        )}
        confirmText={t('Complete Order')}
        isLoading={complete.isPending}
        handleConfirm={() => completing && complete.mutate(completing.trade_no)}
      />
    </>
  )
}
