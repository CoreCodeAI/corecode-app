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
import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  buildBoardRows,
  formatCNY,
  formatShare,
  ourRank,
  type BoardRow,
} from '../lib'
import type { RivalBoard } from '../types'

export function BoardTab({
  board,
  onModelChange,
}: {
  board: RivalBoard
  onModelChange: (model: string) => void
}) {
  const { t } = useTranslation()
  const rows = useMemo(() => buildBoardRows(board), [board])
  const rank = ourRank(rows)
  const official = board.models.find((m) => m.model === board.model)
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-x-6 gap-y-2 text-sm'>
        <NativeSelect
          className='w-56'
          value={board.model}
          onChange={(e) => onModelChange(e.target.value)}
        >
          {board.models.map((m) => (
            <NativeSelectOption key={m.model} value={m.model}>
              {m.model}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {official && (
          <span className='text-muted-foreground'>
            {t('Official price')}: {t('input')}{' '}
            <b className='text-foreground'>{formatCNY(official.input_cny)}</b> /{' '}
            {t('output')}{' '}
            <b className='text-foreground'>{formatCNY(official.output_cny)}</b>{' '}
            {t('per 1M tokens, at ¥{{rate}} per $1', {
              rate: board.exchange_rate,
            })}
          </span>
        )}
        {rank && (
          <span>{t('Our cheapest group ranks {{rank}} of {{of}}', rank)}</span>
        )}
      </div>

      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-12'>#</TableHead>
              <TableHead>{t('Site')}</TableHead>
              <TableHead>{t('Cheapest group')}</TableHead>
              <TableHead className='text-right'>{t('Of official')}</TableHead>
              <TableHead className='text-right'>{t('Input')}</TableHead>
              <TableHead className='text-right'>{t('Output')}</TableHead>
              <TableHead className='text-right'>{t('Cache read')}</TableHead>
              <TableHead className='text-right'>{t('Group ratio')}</TableHead>
              <TableHead className='text-right'>{t('¥ per $1')}</TableHead>
              <TableHead>{t('Checked')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className='text-muted-foreground py-8 text-center'
                >
                  {t('No site lists this model yet.')}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row, i) => (
              <Fragment key={row.key}>
                <BoardLine
                  row={row}
                  index={i + 1}
                  expanded={open === row.key}
                  onToggle={() => setOpen(open === row.key ? null : row.key)}
                />
                {open === row.key &&
                  row.groups.slice(1).map((g) => (
                    <TableRow
                      key={`${row.key}:${g.group}`}
                      className='bg-muted/30'
                    >
                      <TableCell />
                      <TableCell className='text-muted-foreground text-xs'>
                        {g.raw_model}
                      </TableCell>
                      <TableCell>{g.group}</TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatShare(
                          g.input_cny != null && official
                            ? g.input_cny / official.input_cny
                            : null
                        )}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatCNY(g.input_cny)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatCNY(g.output_cny)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatCNY(g.cache_read_cny)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {g.group_ratio}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Prices are CNY per million tokens: model ratio × $2 × group ratio × the CNY a site charges for $1 of credit. Top-up bonuses and per-request groups are not counted. Sites priced only by subscription do not appear.'
        )}
      </p>
    </div>
  )
}

function BoardLine({
  row,
  index,
  expanded,
  onToggle,
}: {
  row: BoardRow
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const more = row.groups.length - 1
  return (
    <TableRow className={cn(row.ours && 'bg-primary/10 font-medium')}>
      <TableCell className='tabular-nums'>{index}</TableCell>
      <TableCell>
        {row.url ? (
          <a
            href={row.url}
            target='_blank'
            rel='noopener noreferrer nofollow'
            className='hover:underline'
          >
            {row.name}
          </a>
        ) : (
          row.name
        )}
        {row.site?.system_name && row.site.system_name !== row.name && (
          <span className='text-muted-foreground ml-1 text-xs'>
            {row.site.system_name}
          </span>
        )}
      </TableCell>
      <TableCell>
        {row.group}
        {more > 0 && (
          <button
            type='button'
            className='text-muted-foreground ml-2 text-xs hover:underline'
            onClick={onToggle}
          >
            {expanded ? t('Hide') : t('+{{count}} groups', { count: more })}
          </button>
        )}
      </TableCell>
      <TableCell className='text-right font-semibold tabular-nums'>
        {formatShare(row.share)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatCNY(row.input)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatCNY(row.output)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatCNY(row.cacheRead)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {row.groupRatio}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {row.topUpPrice > 0 ? row.topUpPrice : '-'}
      </TableCell>
      <TableCell className='text-muted-foreground text-xs whitespace-nowrap'>
        {row.site ? formatTimestampToDate(row.site.priced_at) : t('Live')}
      </TableCell>
    </TableRow>
  )
}
