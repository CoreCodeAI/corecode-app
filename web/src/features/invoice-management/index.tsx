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
import { getRouteApi } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAllInvoices } from '@/features/invoice/api'
import {
  INVOICE_ADMIN_KEY,
  INVOICE_STATUS_CONFIG,
  INVOICE_STATUSES,
} from '@/features/invoice/constants'
import { formatInvoiceAmount } from '@/features/invoice/lib/amount'
import type { Invoice, InvoiceFilters } from '@/features/invoice/types'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'

import { InvoiceReviewDialog } from './components/invoice-review-dialog'

const route = getRouteApi('/_authenticated/invoice-management/')
const EMPTY: Invoice[] = []
const ALL = '__all__'

function useInvoiceColumns(
  onOpen: (invoice: Invoice) => void
): ColumnDef<Invoice>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return useMemo(
    () => [
      {
        accessorKey: 'id',
        header: t('ID'),
        size: 70,
        cell: ({ row }) => (
          <span className='font-mono'>#{row.original.id}</span>
        ),
        meta: { label: t('ID') },
      },
      {
        accessorKey: 'created_time',
        header: t('Submitted at'),
        size: 170,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {formatTimestampToDate(row.original.created_time)}
          </span>
        ),
        meta: { label: t('Submitted at') },
      },
      {
        accessorKey: 'title',
        header: t('Invoice title'),
        size: 240,
        cell: ({ row }) => (
          <span className='truncate font-medium'>{row.original.title}</span>
        ),
        meta: { label: t('Invoice title'), mobileTitle: true },
      },
      {
        accessorKey: 'user_id',
        header: t('User ID'),
        size: 90,
        cell: ({ row }) => (
          <span className='font-mono'>#{row.original.user_id}</span>
        ),
        meta: { label: t('User ID') },
      },
      {
        accessorKey: 'order_cents',
        header: t('Invoice amount'),
        size: 120,
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatInvoiceAmount(row.original.order_cents, locale)}
          </span>
        ),
        meta: { label: t('Invoice amount') },
      },
      {
        accessorKey: 'tax_cents',
        header: t('Tax'),
        size: 100,
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatInvoiceAmount(row.original.tax_cents, locale)}
          </span>
        ),
        meta: { label: t('Tax') },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        size: 130,
        cell: ({ row }) => {
          const config = INVOICE_STATUS_CONFIG[row.original.status]
          return (
            <StatusBadge
              label={t(config?.labelKey ?? row.original.status)}
              variant={config?.variant ?? 'neutral'}
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
        size: 90,
        cell: ({ row }) => (
          <Button
            size='sm'
            variant='outline'
            onClick={() => onOpen(row.original)}
          >
            {t('Process')}
          </Button>
        ),
      },
    ],
    [t, locale, onOpen]
  )
}

/** Every account's invoice applications, for administrators to process. */
export function InvoiceManagement() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const filters: InvoiceFilters = {
    status: search.status,
    keyword: search.keyword,
  }
  const [draft, setDraft] = useState(filters)
  const pagination = {
    pageIndex: (search.page ?? 1) - 1,
    pageSize: search.pageSize ?? 20,
  }

  const invoices = useQuery({
    queryKey: [...INVOICE_ADMIN_KEY, 'list', filters, pagination],
    queryFn: () =>
      getAllInvoices(filters, {
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: (previous) => previous,
  })

  const [openId, setOpenId] = useState<number | null>(null)
  const columns = useInvoiceColumns((invoice) => setOpenId(invoice.id))
  const { table } = useDataTable<Invoice>({
    columns,
    data: invoices.data?.items ?? EMPTY,
    getRowId: (row) => String(row.id),
    totalCount: invoices.data?.total ?? 0,
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

  const applyFilters = (next: InvoiceFilters) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        page: 1,
        status: next.status || undefined,
        keyword: next.keyword?.trim() || undefined,
      }),
    })
  }

  const statusItems = [
    { value: ALL, label: t('All statuses') },
    ...INVOICE_STATUSES.map((value) => ({
      value,
      label: t(INVOICE_STATUS_CONFIG[value].labelKey),
    })),
  ]

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Invoice management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={invoices.isPending}
            isFetching={invoices.isFetching}
            emptyTitle={t('No applications found')}
            emptyDescription={t(
              'Invoice applications submitted by users appear here.'
            )}
            toolbar={
              <LogsFilterToolbar
                table={table}
                hasActiveFilters={Boolean(draft.status || draft.keyword)}
                searchLoading={invoices.isFetching}
                onSearch={() => applyFilters(draft)}
                onReset={() => {
                  setDraft({})
                  applyFilters({})
                }}
                primaryFilters={
                  <>
                    <LogsFilterField>
                      <LogsFilterInput
                        value={draft.keyword ?? ''}
                        onChange={(event) =>
                          setDraft({ ...draft, keyword: event.target.value })
                        }
                        onKeyDown={(event) =>
                          event.key === 'Enter' && applyFilters(draft)
                        }
                        placeholder={t(
                          'Search by ID, user ID, title, tax number or tax order number'
                        )}
                        aria-label={t(
                          'Search by ID, user ID, title, tax number or tax order number'
                        )}
                      />
                    </LogsFilterField>
                    <LogsFilterField>
                      <Select
                        items={statusItems}
                        value={draft.status || ALL}
                        onValueChange={(value) =>
                          setDraft({
                            ...draft,
                            status:
                              value === ALL || value === null ? '' : value,
                          })
                        }
                      >
                        <SelectTrigger className='h-8' aria-label={t('Status')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {statusItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </LogsFilterField>
                  </>
                }
              />
            }
            className='h-auto min-h-0'
            applyHeaderSize
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {openId !== null && (
        <InvoiceReviewDialog id={openId} onClose={() => setOpenId(null)} />
      )}
    </>
  )
}
