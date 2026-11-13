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
import { useTranslation } from 'react-i18next'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimestampToDate } from '@/lib/format'

import { getRivalChanges, getRivalSites } from '../api'
import { formatCNY } from '../lib'

const KIND_LABEL = {
  changed: 'Changed',
  added: 'New group',
  removed: 'Removed',
} as const

export function ChangesTab({ model }: { model: string }) {
  const { t } = useTranslation()
  const changes = useQuery({
    queryKey: ['rival-prices', 'changes', model],
    queryFn: () => getRivalChanges(model),
  })
  const sites = useQuery({
    queryKey: ['rival-prices', 'sites'],
    queryFn: getRivalSites,
  })
  const names = new Map((sites.data ?? []).map((s) => [s.id, s.name || s.slug]))

  return (
    <div className='overflow-x-auto rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Time')}</TableHead>
            <TableHead>{t('Site')}</TableHead>
            <TableHead>{t('Group')}</TableHead>
            <TableHead>{t('Change')}</TableHead>
            <TableHead className='text-right'>{t('Group ratio')}</TableHead>
            <TableHead className='text-right'>{t('Input')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(changes.data ?? []).length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className='text-muted-foreground py-8 text-center'
              >
                {changes.isPending
                  ? t('Loading...')
                  : t('No price has moved since monitoring began.')}
              </TableCell>
            </TableRow>
          )}
          {(changes.data ?? []).map((c) => (
            <TableRow key={c.id}>
              <TableCell className='text-xs whitespace-nowrap'>
                {formatTimestampToDate(c.created_at)}
              </TableCell>
              <TableCell>{names.get(c.site_id) ?? `#${c.site_id}`}</TableCell>
              <TableCell>{c.group}</TableCell>
              <TableCell>{t(KIND_LABEL[c.kind])}</TableCell>
              <TableCell className='text-right tabular-nums'>
                {c.kind === 'added' ? '' : `${c.old_group_ratio} → `}
                {c.kind === 'removed' ? '' : c.new_group_ratio}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {c.kind === 'added' ? '' : `${formatCNY(c.old_input_cny)} → `}
                {c.kind === 'removed' ? '' : formatCNY(c.new_input_cny)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
