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
import type { Table } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'
import {
  getPaymentMethodName,
  STATUS_CONFIG,
} from '@/features/wallet/lib/billing'

import type { TopupReportFilters } from '../types'

const ALL = '__all__'

type TopupFilterBarProps<TData> = {
  table: Table<TData>
  filters: TopupReportFilters
  defaultRange: { start_time: number; end_time: number }
  paymentMethods: string[]
  loading: boolean
  onApply: (filters: TopupReportFilters) => void
}

export function TopupFilterBar<TData>(props: TopupFilterBarProps<TData>) {
  const { t } = useTranslation()
  // The page remounts this bar when the applied filters change, so the draft
  // starts from them again after back navigation or a reset.
  const [draft, setDraft] = useState(props.filters)

  const set = (patch: Partial<TopupReportFilters>) =>
    setDraft((previous) => ({ ...previous, ...patch }))
  const hasActiveFilters =
    Boolean(
      draft.user || draft.trade_no || draft.status || draft.payment_method
    ) ||
    draft.start_time !== props.defaultRange.start_time ||
    draft.end_time !== props.defaultRange.end_time

  const statusItems = [
    { value: ALL, label: t('All statuses') },
    ...Object.entries(STATUS_CONFIG).map(([value, config]) => ({
      value,
      label: t(config.label),
    })),
  ]
  const methodItems = [
    { value: ALL, label: t('All payment methods') },
    ...props.paymentMethods.map((method) => ({
      value: method,
      label: getPaymentMethodName(method, t),
    })),
  ]

  // On a phone the range stays in view and the rest open in a drawer.
  const dateFilter = (
    <LogsFilterField wide>
      <CompactDateTimeRangePicker
        start={new Date(draft.start_time * 1000)}
        end={new Date(draft.end_time * 1000)}
        onChange={(range) =>
          set({
            start_time: range.start
              ? Math.floor(range.start.getTime() / 1000)
              : props.defaultRange.start_time,
            end_time: range.end
              ? Math.floor(range.end.getTime() / 1000)
              : props.defaultRange.end_time,
          })
        }
      />
    </LogsFilterField>
  )
  const otherFilters = (
    <>
      <LogsFilterField>
        <LogsFilterInput
          value={draft.user ?? ''}
          onChange={(event) => set({ user: event.target.value })}
          onKeyDown={(event) => event.key === 'Enter' && props.onApply(draft)}
          placeholder={t('User ID or username')}
          aria-label={t('User ID or username')}
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          value={draft.trade_no ?? ''}
          onChange={(event) => set({ trade_no: event.target.value })}
          onKeyDown={(event) => event.key === 'Enter' && props.onApply(draft)}
          placeholder={t('Order number')}
          aria-label={t('Order number')}
        />
      </LogsFilterField>
      <LogsFilterField>
        <Select
          items={statusItems}
          value={draft.status || ALL}
          onValueChange={(value) =>
            set({ status: value === ALL || value === null ? '' : value })
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
      <LogsFilterField>
        <Select
          items={methodItems}
          value={draft.payment_method || ALL}
          onValueChange={(value) =>
            set({
              payment_method: value === ALL || value === null ? '' : value,
            })
          }
        >
          <SelectTrigger className='h-8' aria-label={t('Payment Method')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {methodItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </LogsFilterField>
    </>
  )
  const otherCount = [
    draft.user,
    draft.trade_no,
    draft.status,
    draft.payment_method,
  ].filter(Boolean).length

  return (
    <LogsFilterToolbar
      table={props.table}
      hasActiveFilters={hasActiveFilters}
      searchLoading={props.loading}
      onSearch={() => props.onApply(draft)}
      onReset={() => {
        const reset = { ...props.defaultRange }
        setDraft(reset)
        props.onApply(reset)
      }}
      primaryFilters={
        <>
          {dateFilter}
          {otherFilters}
        </>
      }
      mobilePinnedFilters={dateFilter}
      mobileFilters={otherFilters}
      mobileFilterCount={otherCount}
    />
  )
}
