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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
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

import { setRivalGroupKind } from '../api'
import {
  boardStats,
  buildBoardRows,
  effectiveMetric,
  formatCNY,
  formatShare,
  type BoardRow,
  type Metric,
} from '../lib'
import type {
  RivalBoard,
  RivalBoardPrice,
  RivalKind,
  RivalTrust,
} from '../types'

const KIND_LABEL: Record<RivalKind, string> = {
  official: 'Official API',
  cloud: 'Cloud (AWS/Vertex)',
  pool: 'Subscription pool',
  kiro: 'Kiro',
  reverse: 'Reverse-engineered',
  default: 'Default group',
  other: 'Other',
}

const TRUST_LABEL: Record<RivalTrust, string> = {
  ok: '',
  unknown: 'No top-up price',
  default: 'Default top-up price',
  abnormal: 'Unusual top-up price',
}

export function BoardTab({
  board,
  onModelChange,
}: {
  board: RivalBoard
  onModelChange: (model: string) => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<RivalKind | 'all'>(board.our_kind)
  const [metricChoice, setMetric] = useState<Metric>('blended')
  const [includeUntrusted, setIncludeUntrusted] = useState(false)
  const metric = effectiveMetric(board, metricChoice)
  const rows = useMemo(
    () => buildBoardRows(board, { kind, metric, includeUntrusted }),
    [board, kind, metric, includeUntrusted]
  )
  const stats = boardStats(rows, board, metric)
  const official = board.models.find((m) => m.model === board.model)
  const officialFigure =
    metric === 'blended' ? official?.blended_cny : official?.input_cny
  const mix = official?.mix
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'>
        <NativeSelect
          className='w-52'
          value={board.model}
          onChange={(e) => onModelChange(e.target.value)}
        >
          {board.models.map((m) => (
            <NativeSelectOption key={m.model} value={m.model}>
              {m.model}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          className='w-48'
          value={kind}
          onChange={(e) => setKind(e.target.value as RivalKind | 'all')}
        >
          <NativeSelectOption value='all'>
            {t('Every channel kind')}
          </NativeSelectOption>
          {board.kinds.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {t(KIND_LABEL[k])}
              {k === board.our_kind ? ` (${t('ours')})` : ''}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          className='w-40'
          value={metricChoice}
          onChange={(e) => setMetric(e.target.value as Metric)}
        >
          <NativeSelectOption value='blended'>
            {t('Blended price')}
          </NativeSelectOption>
          <NativeSelectOption value='input'>
            {t('Input price')}
          </NativeSelectOption>
        </NativeSelect>
        <label className='flex items-center gap-2'>
          <Switch
            checked={includeUntrusted}
            onCheckedChange={setIncludeUntrusted}
            size='sm'
          />
          <span>{t('Include sites with an untrusted top-up price')}</span>
        </label>
      </div>

      <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
        <Stat
          label={t('Official price')}
          value={formatCNY(officialFigure)}
          note={
            metric === 'blended'
              ? t('Blended over our traffic')
              : t('Input, per 1M tokens')
          }
        />
        <Stat
          label={t('Ours, cheapest group')}
          value={formatCNY(stats.ours)}
          note={`${formatShare(stats.ours != null && officialFigure ? stats.ours / officialFigure : null)} ${t('of official')}`}
          highlight
        />
        <Stat
          label={t('Rivals, median')}
          value={formatCNY(stats.median)}
          note={t('{{p10}} to {{p90}} across the middle 80%', {
            p10: formatCNY(stats.p10),
            p90: formatCNY(stats.p90),
          })}
        />
        <Stat
          label={t('Cheaper than us')}
          value={`${stats.cheaper} / ${stats.sites}`}
          note={
            stats.cheapest != null
              ? t('Cheapest {{price}}', { price: formatCNY(stats.cheapest) })
              : ''
          }
        />
      </div>

      {metric === 'blended' && mix ? (
        <p className='text-muted-foreground text-xs'>
          {t(
            "Blended price: a million tokens in our customers' mix of {{model}} over 7 days, {{read}} cache reads, {{uncached}} uncached input, {{write}} cache writes and {{output}} output.",
            {
              model: mix.model,
              read: formatShare(mix.cache_read),
              uncached: formatShare(mix.uncached),
              write: formatShare(mix.cache_write),
              output: formatShare(mix.output),
            }
          )}
        </p>
      ) : (
        metricChoice === 'blended' && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'No traffic mix yet: the rollup starts counting output with this release. Ranked by input price meanwhile.'
            )}
          </p>
        )
      )}

      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-12'>#</TableHead>
              <TableHead>{t('Site')}</TableHead>
              <TableHead>{t('Cheapest group')}</TableHead>
              <TableHead className='text-right'>{t('Of official')}</TableHead>
              <TableHead className='text-right'>{t('Blended')}</TableHead>
              <TableHead className='text-right'>{t('Input')}</TableHead>
              <TableHead className='text-right'>{t('Cache read')}</TableHead>
              <TableHead className='text-right'>{t('¥ per $1')}</TableHead>
              <TableHead>{t('Checked')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
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
                  row.site &&
                  row.groups.map((g) => (
                    <GroupLine
                      key={`${row.key}:${g.group}`}
                      siteId={row.site?.id ?? 0}
                      price={g}
                      kinds={board.kinds}
                      officialFigure={officialFigure ?? null}
                      metric={metric}
                    />
                  ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Prices are CNY per million tokens: model ratio × $2 × group ratio × the CNY a site charges for $1 of credit. Top-up bonuses and per-request groups are not counted. Sites priced only by subscription do not appear.'
        )}{' '}
        {t(
          'A site that states no cache ratio bills cache reads as input. Channel kinds are guessed from group names; open a site to correct one.'
        )}
      </p>
    </div>
  )
}

function Stat({
  label,
  value,
  note,
  highlight,
}: {
  label: string
  value: string
  note?: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        highlight && 'bg-primary/10'
      )}
    >
      <div className='text-muted-foreground text-xs'>{label}</div>
      <div className='mt-1 text-xl font-semibold tabular-nums'>{value}</div>
      {note && (
        <div className='text-muted-foreground mt-0.5 text-xs'>{note}</div>
      )}
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
        <span>{row.group}</span>
        <Badge variant='outline' className='ml-2'>
          {t(KIND_LABEL[row.kind])}
        </Badge>
        {!row.ours && (
          <button
            type='button'
            className='text-muted-foreground ml-2 text-xs hover:underline'
            onClick={onToggle}
          >
            {expanded ? t('Hide') : t('Groups')}
          </button>
        )}
      </TableCell>
      <TableCell className='text-right font-semibold tabular-nums'>
        {formatShare(row.share)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatCNY(row.blended)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatCNY(row.input)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {row.cacheRatio == null ? (
          <span className='text-destructive text-xs'>
            {t('No cache discount')}
          </span>
        ) : (
          formatCNY(row.cacheRead)
        )}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {row.topUpPrice > 0 ? row.topUpPrice : '-'}
        {row.trust !== 'ok' && (
          <div className='text-destructive text-xs'>
            {t(TRUST_LABEL[row.trust])}
          </div>
        )}
      </TableCell>
      <TableCell className='text-muted-foreground text-xs whitespace-nowrap'>
        {row.site ? formatTimestampToDate(row.site.priced_at) : t('Live')}
      </TableCell>
    </TableRow>
  )
}

function GroupLine({
  siteId,
  price,
  kinds,
  officialFigure,
  metric,
}: {
  siteId: number
  price: RivalBoardPrice
  kinds: RivalKind[]
  officialFigure: number | null
  metric: Metric
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (kind: string) => setRivalGroupKind(siteId, price.group, kind),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['rival-prices'] }),
    onError: (error: Error) => toast.error(error.message),
  })
  const figure = metric === 'blended' ? price.blended_cny : price.input_cny
  return (
    <TableRow className='bg-muted/30'>
      <TableCell />
      <TableCell className='text-muted-foreground text-xs'>
        {price.raw_model}
      </TableCell>
      <TableCell>
        <span>{price.group}</span>
        <NativeSelect
          className='ml-2 inline-flex h-7 w-40 text-xs'
          value={price.kind}
          disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.value)}
        >
          {kinds.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {t(KIND_LABEL[k])}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {price.kind_overridden && (
          <button
            type='button'
            className='text-muted-foreground ml-2 text-xs hover:underline'
            onClick={() => save.mutate('')}
          >
            {t('Reset')}
          </button>
        )}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatShare(
          figure != null && officialFigure ? figure / officialFigure : null
        )}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatCNY(price.blended_cny)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatCNY(price.input_cny)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {price.cache_ratio == null ? (
          <span className='text-destructive text-xs'>
            {t('No cache discount')}
          </span>
        ) : (
          formatCNY(price.cache_read_cny)
        )}
      </TableCell>
      <TableCell
        colSpan={2}
        className='text-muted-foreground text-right text-xs tabular-nums'
      >
        {t('Group ratio')} {price.group_ratio}
      </TableCell>
    </TableRow>
  )
}
