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

import {
  DataTablePage,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
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
import { getAllFeedback } from '@/features/feedback/api'
import {
  ALL_FEEDBACK_KEY,
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_CONFIG,
  FEEDBACK_STATUS_CONFIG,
  FEEDBACK_STATUSES,
} from '@/features/feedback/constants'
import type { Feedback, FeedbackFilters } from '@/features/feedback/types'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatTimestampToDate } from '@/lib/format'

import { FeedbackDialog } from './components/feedback-dialog'

const route = getRouteApi('/_authenticated/feedback-admin/')
const EMPTY: Feedback[] = []
const ALL = '__all__'

function useFeedbackColumns(
  onOpen: (feedback: Feedback) => void
): ColumnDef<Feedback>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'created_time',
        header: t('Submitted'),
        size: 150,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {formatTimestampToDate(row.original.created_time)}
          </span>
        ),
        meta: { label: t('Submitted') },
      },
      {
        // The one flexible column: it takes the room the others leave and
        // cuts a long title short, with the whole title in a tooltip.
        // `w-0 min-w-full` keeps the cell out of the table's content-width
        // calculation: with `max-w-full` alone an auto-layout table still
        // grows to the title's full length and runs past the page.
        accessorKey: 'title',
        header: t('Title'),
        size: 200,
        cell: ({ row }) => (
          <TruncatedCell cellClassName='w-0 min-w-full font-medium'>
            {row.original.title}
          </TruncatedCell>
        ),
        meta: { label: t('Title'), mobileTitle: true },
      },
      {
        accessorKey: 'category',
        header: t('Type'),
        size: 90,
        cell: ({ row }) => {
          const config = FEEDBACK_CATEGORY_CONFIG[row.original.category]
          return t(config?.label ?? row.original.category)
        },
        meta: { label: t('Type') },
      },
      {
        accessorKey: 'user_id',
        header: t('Account'),
        size: 80,
        cell: ({ row }) => (
          <span className='font-mono'>#{row.original.user_id}</span>
        ),
        meta: { label: t('Account') },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        size: 100,
        cell: ({ row }) => {
          const config = FEEDBACK_STATUS_CONFIG[row.original.status]
          return (
            <StatusBadge
              label={t(config?.label ?? row.original.status)}
              variant={config?.variant ?? 'neutral'}
              showDot
              copyable={false}
            />
          )
        },
        meta: { label: t('Status') },
      },
      {
        accessorKey: 'reward_quota',
        header: t('Reward'),
        size: 90,
        cell: ({ row }) =>
          row.original.reward_quota > 0
            ? formatQuotaWithCurrency(row.original.reward_quota)
            : '-',
        meta: { label: t('Reward') },
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
            {t('Review')}
          </Button>
        ),
      },
    ],
    [t, onOpen]
  )
}

export function FeedbackAdmin() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const filters: FeedbackFilters = {
    status: search.status,
    category: search.category,
    keyword: search.keyword,
  }
  const [draft, setDraft] = useState(filters)
  const pagination = {
    pageIndex: (search.page ?? 1) - 1,
    pageSize: search.pageSize ?? 20,
  }

  const feedback = useQuery({
    queryKey: [...ALL_FEEDBACK_KEY, filters, pagination],
    queryFn: () =>
      getAllFeedback(filters, {
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: (previous) => previous,
  })

  const [open, setOpen] = useState<Feedback | null>(null)
  const columns = useFeedbackColumns(setOpen)
  const { table } = useDataTable<Feedback>({
    columns,
    data: feedback.data?.items ?? EMPTY,
    getRowId: (row) => String(row.id),
    totalCount: feedback.data?.total ?? 0,
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

  const applyFilters = (next: FeedbackFilters) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        page: 1,
        status: next.status || undefined,
        category: next.category || undefined,
        keyword: next.keyword?.trim() || undefined,
      }),
    })
  }

  const statusItems = [
    { value: ALL, label: t('All statuses') },
    ...FEEDBACK_STATUSES.map((value) => ({
      value,
      label: t(FEEDBACK_STATUS_CONFIG[value].label),
    })),
  ]
  const categoryItems = [
    { value: ALL, label: t('All types') },
    ...FEEDBACK_CATEGORIES.map((value) => ({
      value,
      label: t(FEEDBACK_CATEGORY_CONFIG[value].label),
    })),
  ]
  const filterSelects = [
    { key: 'status' as const, label: t('Status'), items: statusItems },
    { key: 'category' as const, label: t('Type'), items: categoryItems },
  ]

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Feedback Review')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={feedback.isPending}
            isFetching={feedback.isFetching}
            emptyTitle={t('No feedback yet')}
            emptyDescription={t('Feedback customers submit appears here.')}
            toolbar={
              <LogsFilterToolbar
                table={table}
                hasActiveFilters={Boolean(
                  draft.status || draft.category || draft.keyword
                )}
                searchLoading={feedback.isFetching}
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
                        placeholder={t('Title or description')}
                        aria-label={t('Title or description')}
                      />
                    </LogsFilterField>
                    {filterSelects.map((filter) => (
                      <LogsFilterField key={filter.key}>
                        <Select
                          items={filter.items}
                          value={draft[filter.key] || ALL}
                          onValueChange={(value) =>
                            setDraft({
                              ...draft,
                              [filter.key]:
                                value === ALL || value === null ? '' : value,
                            })
                          }
                        >
                          <SelectTrigger
                            className='h-8'
                            aria-label={filter.label}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              {filter.items.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </LogsFilterField>
                    ))}
                  </>
                }
              />
            }
            className='h-auto min-h-0'
            applyHeaderSize
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {open && (
        <FeedbackDialog
          key={open.id}
          feedback={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
