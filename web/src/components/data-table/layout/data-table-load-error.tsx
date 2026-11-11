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
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

export type DataTableLoadErrorProps = {
  /** Whether the page still shows rows from an earlier successful load. */
  hasRows: boolean
  title?: string
  onRetry?: () => void
}

/**
 * What a list shows when its query failed. Without rows it replaces the empty
 * state, whose "create your first" prompt would misread a failure as no data;
 * with rows from an earlier load it is one line above them.
 */
export function DataTableLoadError(props: DataTableLoadErrorProps) {
  const { t } = useTranslation()
  const title = props.title ?? t('Failed to load')

  if (!props.hasRows) {
    return (
      <ErrorState
        title={title}
        onRetry={props.onRetry}
        className='rounded-lg border'
      />
    )
  }

  return (
    <div
      role='alert'
      className='text-destructive flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm'
    >
      <AlertTriangle className='size-4 shrink-0' aria-hidden='true' />
      <span className='min-w-0 flex-1'>
        <span className='font-medium'>{title}</span>{' '}
        <span className='text-muted-foreground'>
          {t('Showing the last results that loaded.')}
        </span>
      </span>
      {props.onRetry && (
        <Button variant='outline' size='xs' onClick={props.onRetry}>
          {t('Retry')}
        </Button>
      )}
    </div>
  )
}
