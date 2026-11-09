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

import {
  ActivityTimeCell,
  TimestampCell,
} from '@/components/activity-time-cell'
import { StatusBadge } from '@/components/status-badge'
import dayjs from '@/lib/dayjs'

import { useNow } from '../lib/use-now'
import type { ApiKey } from '../types'

export { TimestampCell as ApiKeyTimestampCell } from '@/components/activity-time-cell'

/** The expiry column: "Never", or a relative time that follows the clock. */
export function ApiKeyExpiryCell(props: {
  expiredTime: number
  locale?: string
  justNowLabel: string
  now?: number
}) {
  const { t } = useTranslation()
  const now = useNow(props.now)
  if (props.expiredTime === -1) {
    return (
      <StatusBadge
        label={t('Never')}
        variant='neutral'
        copyable={false}
        className='-ml-1.5'
      />
    )
  }
  return (
    <TimestampCell
      timestamp={props.expiredTime}
      now={now}
      locale={props.locale}
      justNowLabel={props.justNowLabel}
      className={
        props.expiredTime * 1000 <= now
          ? 'text-destructive'
          : 'text-muted-foreground'
      }
    />
  )
}

export function ApiKeyActivityCell(props: {
  apiKey: ApiKey
  /** Fixed clock for tests; the cell follows the shared clock without it. */
  now?: number
  layout?: 'rows' | 'columns'
}) {
  const { t } = useTranslation()
  const now = useNow(props.now)
  const accessedTime = props.apiKey.accessed_time
  const isStale =
    accessedTime > 0 &&
    accessedTime * 1000 < dayjs(now).subtract(3, 'month').valueOf()

  return (
    <ActivityTimeCell
      createdAt={props.apiKey.created_time}
      lastAt={accessedTime}
      lastLabel={t('Last Used')}
      lastClassName={isStale ? 'text-warning' : 'text-muted-foreground'}
      now={now}
      layout={props.layout}
    />
  )
}
