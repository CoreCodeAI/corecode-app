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
import { KeySquare, Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { API_KEY_STATUSES } from '@/features/keys/constants'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { countKeysByGroup } from '../../lib/user-api-keys'
import { getUserApiKeys } from '../../user-api-keys-api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: number; username: string }
}

export function UserApiKeysDialog(props: Props) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['admin-user-api-keys', props.user.id],
    queryFn: () => getUserApiKeys(props.user.id),
    enabled: props.open,
    staleTime: 0,
  })
  const keys = useMemo(() => query.data?.items ?? [], [query.data])
  const total = query.data?.total ?? 0
  const groups = useMemo(() => countKeysByGroup(keys), [keys])

  let body: React.ReactNode
  if (query.isPending) {
    body = (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
      </div>
    )
  } else if (query.isError) {
    body = (
      <p className='text-destructive py-4 text-center text-sm'>
        {getServerErrorMessage(query.error, t('Failed to load API keys'))}
      </p>
    )
  } else if (keys.length === 0) {
    body = (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        {t('This user has no API keys')}
      </p>
    )
  } else {
    body = (
      <div className='space-y-3'>
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <span className='font-medium'>
            {t('{{count}} API keys in total', { count: total })}
          </span>
          {groups.map(({ group, count }) => (
            <span key={group} className='inline-flex items-center gap-1'>
              <GroupBadge group={group} />
              <span className='text-muted-foreground tabular-nums'>
                ×{count}
              </span>
            </span>
          ))}
        </div>
        {keys.length < total && (
          <p className='text-muted-foreground text-xs'>
            {t('Showing the newest {{shown}} of {{total}} keys', {
              shown: keys.length,
              total,
            })}
          </p>
        )}
        <ScrollArea className='max-h-[55vh]'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Name')}</TableHead>
                <TableHead>{t('API Key')}</TableHead>
                <TableHead>{t('Group')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead className='text-right'>{t('Used Quota')}</TableHead>
                <TableHead>{t('Last used')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => {
                const status = API_KEY_STATUSES[key.status]
                return (
                  <TableRow key={key.id}>
                    <TableCell className='max-w-40 truncate font-medium'>
                      {key.name || '-'}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      sk-{key.key}
                    </TableCell>
                    <TableCell>
                      <GroupBadge group={key.group} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={status ? t(status.label) : String(key.status)}
                        variant={status?.variant ?? 'neutral'}
                        copyable={false}
                      />
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatQuota(key.used_quota)}
                    </TableCell>
                    <TableCell className='text-muted-foreground text-xs whitespace-nowrap'>
                      {formatTimestampToDate(key.accessed_time)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <KeySquare className='h-5 w-5' />
          {t('API keys of {{username}}', { username: props.user.username })}
        </>
      }
      description={`ID: ${props.user.id}`}
      contentClassName='sm:max-w-4xl'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
    >
      {body}
    </Dialog>
  )
}
