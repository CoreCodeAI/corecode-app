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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatTimestampToDate } from '@/lib/format'

import type { ViolationAction, ViolationRecord } from './api'

const ACTION_VARIANTS: Record<ViolationAction, StatusVariant> = {
  merged: 'neutral',
  warn: 'cyan',
  client_check: 'neutral',
  model_refusal: 'neutral',
  strike: 'warning',
  suspend: 'orange',
  ban: 'danger',
}

type ViolationColumnsOptions = {
  nowSeconds: number
  onLift: (record: ViolationRecord) => void
  onViewExcerpt: (record: ViolationRecord) => void
}

export function useViolationColumns(
  options: ViolationColumnsOptions
): ColumnDef<ViolationRecord>[] {
  const { t } = useTranslation()
  const { nowSeconds, onLift, onViewExcerpt } = options

  return useMemo(() => {
    const actionLabels: Record<ViolationAction, string> = {
      merged: t('Merged into earlier strike'),
      warn: t('Warning (not counted)'),
      client_check: t('Client check (not counted)'),
      model_refusal: t('Model refusal (not counted)'),
      strike: t('Strike'),
      suspend: t('Suspend'),
      ban: t('Disable account'),
    }

    return [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        size: 170,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {formatTimestampToDate(row.original.created_at)}
          </span>
        ),
        meta: { label: t('Time'), mobileTitle: true },
      },
      {
        id: 'user',
        header: t('User'),
        size: 150,
        cell: ({ row }) => (
          <span>
            {row.original.username}{' '}
            <span className='text-muted-foreground'>
              #{row.original.user_id}
            </span>
          </span>
        ),
        meta: { label: t('User') },
      },
      {
        accessorKey: 'model_name',
        header: t('Model'),
        size: 160,
        cell: ({ row }) => (
          <TruncatedCell>{row.original.model_name}</TruncatedCell>
        ),
        meta: { label: t('Model') },
      },
      {
        accessorKey: 'category',
        header: t('Category'),
        size: 100,
        cell: ({ row }) => row.original.category || '-',
        meta: { label: t('Category') },
      },
      {
        accessorKey: 'excerpt',
        header: t('Refused message'),
        size: 240,
        // One fixed-width line: the table lays out by content, so a long
        // message would otherwise push the Lift button off screen.
        cell: ({ row }) =>
          row.original.excerpt ? (
            <button
              type='button'
              aria-haspopup='dialog'
              aria-label={t('View refused message')}
              onClick={() => onViewExcerpt(row.original)}
              className='hover:text-foreground focus-visible:ring-ring decoration-muted-foreground/60 block w-60 max-w-60 cursor-pointer truncate rounded-sm text-left underline decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:outline-none'
            >
              {row.original.excerpt.replaceAll(/\s+/g, ' ')}
            </button>
          ) : (
            '-'
          ),
        meta: { label: t('Refused message') },
      },
      {
        id: 'action',
        header: t('Action'),
        size: 220,
        cell: ({ row }) => (
          <span className='flex flex-wrap items-center gap-1'>
            <StatusBadge
              label={actionLabels[row.original.action]}
              variant={ACTION_VARIANTS[row.original.action]}
              copyable={false}
            />
            {row.original.mode === 'observe' && (
              <StatusBadge
                label={t('Observe (not enforced)')}
                variant='info'
                copyable={false}
              />
            )}
            {row.original.mode === 'exempt' && (
              <StatusBadge
                label={t('Administrator (not restricted)')}
                variant='neutral'
                copyable={false}
              />
            )}
          </span>
        ),
        meta: { label: t('Action') },
      },
      {
        id: 'suspended_until',
        header: t('Suspended until'),
        size: 170,
        cell: ({ row }) =>
          row.original.suspended_until > nowSeconds ? (
            <span className='font-mono tabular-nums'>
              {formatTimestampToDate(row.original.suspended_until)}
            </span>
          ) : (
            '-'
          ),
        meta: { label: t('Suspended until') },
      },
      {
        accessorKey: 'request_id',
        header: t('Request ID'),
        size: 200,
        cell: ({ row }) => (
          <TruncatedCell>
            <span className='font-mono'>{row.original.request_id}</span>
          </TruncatedCell>
        ),
        meta: { label: t('Request ID') },
      },
      {
        id: 'lift',
        header: '',
        size: 90,
        cell: ({ row }) => (
          <Button
            size='sm'
            variant='outline'
            disabled={row.original.mode === 'exempt'}
            onClick={() => onLift(row.original)}
          >
            {t('Lift')}
          </Button>
        ),
        // Pinned so Lift stays in reach when the table scrolls sideways.
        meta: { label: t('Lift'), pinned: 'right' as const },
      },
    ]
  }, [t, nowSeconds, onLift, onViewExcerpt])
}
