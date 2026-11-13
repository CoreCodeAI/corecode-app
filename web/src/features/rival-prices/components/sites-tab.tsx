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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

import {
  addRivalSite,
  checkRivalSite,
  getRivalSites,
  updateRivalSite,
} from '../api'
import type { RivalSite } from '../types'

const STATUS_LABEL: Record<string, string> = {
  ok: 'Priced',
  unsupported: 'No price list',
  error: 'Unreachable',
  pending: 'Waiting',
  '': 'Waiting',
}

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'warning' | 'destructive' | 'outline'
> = {
  ok: 'default',
  unsupported: 'secondary',
  error: 'warning',
  pending: 'outline',
  '': 'outline',
}

const SHOWN = 300

export function SitesTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const sites = useQuery({
    queryKey: ['rival-prices', 'sites'],
    queryFn: getRivalSites,
  })
  const [status, setStatus] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['rival-prices'] })
  const onError = (error: Error) => toast.error(error.message)
  const add = useMutation({
    mutationFn: () => addRivalSite(name.trim(), url.trim()),
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      setName('')
      setUrl('')
      void refresh()
    },
    onError,
  })
  const update = useMutation({
    mutationFn: (v: { id: number; enabled?: boolean; api_base?: string }) =>
      updateRivalSite(v.id, { enabled: v.enabled, api_base: v.api_base }),
    onSuccess: () => void refresh(),
    onError,
  })
  const check = useMutation({
    mutationFn: (id: number) => checkRivalSite(id),
    onSuccess: () => toast.success(t('Queued; it is checked within a minute.')),
    onError,
  })

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return (sites.data ?? []).filter((s) => {
      if (status === 'disabled' && s.enabled) return false
      if (
        status !== 'all' &&
        status !== 'disabled' &&
        (!s.enabled || (s.status || 'pending') !== status)
      ) {
        return false
      }
      if (!k) return true
      return [s.name, s.slug, s.site_url, s.api_base, s.system_name].some((v) =>
        v.toLowerCase().includes(k)
      )
    })
  }, [sites.data, status, keyword])

  const editBase = (site: RivalSite) => {
    const value = window.prompt(
      t('API origin to read prices from (empty: search automatically)'),
      site.api_base_locked ? site.api_base : ''
    )
    if (value === null) return
    update.mutate({ id: site.id, api_base: value.trim() })
  }

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <NativeSelect
          className='w-40'
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <NativeSelectOption value='all'>{t('All')}</NativeSelectOption>
          <NativeSelectOption value='ok'>{t('Priced')}</NativeSelectOption>
          <NativeSelectOption value='unsupported'>
            {t('No price list')}
          </NativeSelectOption>
          <NativeSelectOption value='error'>
            {t('Unreachable')}
          </NativeSelectOption>
          <NativeSelectOption value='pending'>
            {t('Waiting')}
          </NativeSelectOption>
          <NativeSelectOption value='disabled'>
            {t('Disabled')}
          </NativeSelectOption>
        </NativeSelect>
        <Input
          className='h-9 w-56'
          placeholder={t('Search')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <span className='text-muted-foreground text-sm'>
          {filtered.length} / {sites.data?.length ?? 0}
        </span>
        <div className='ml-auto flex items-center gap-2'>
          <Input
            className='h-9 w-36'
            placeholder={t('Name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            className='h-9 w-56'
            placeholder='https://api.example.com'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            size='sm'
            disabled={add.isPending || !name.trim() || !url.trim()}
            onClick={() => add.mutate()}
          >
            {t('Add site')}
          </Button>
        </div>
      </div>

      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Site')}</TableHead>
              <TableHead>{t('Price list from')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead className='text-right'>{t('Claude models')}</TableHead>
              <TableHead className='text-right'>{t('¥ per $1')}</TableHead>
              <TableHead>{t('Checked')}</TableHead>
              <TableHead>{t('Enabled')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, SHOWN).map((site) => (
              <TableRow key={site.id}>
                <TableCell>
                  <div className='font-medium'>{site.name || site.slug}</div>
                  <div className='text-muted-foreground text-xs'>
                    {site.site_url || '-'}
                    {site.source === 'manual' && ` · ${t('Added by hand')}`}
                  </div>
                </TableCell>
                <TableCell className='text-xs'>
                  <button
                    type='button'
                    className='hover:underline'
                    onClick={() => editBase(site)}
                  >
                    {site.api_base || t('Search automatically')}
                  </button>
                  {site.api_base_locked && (
                    <span className='text-muted-foreground'>
                      {' '}
                      · {t('fixed')}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[site.status] ?? 'outline'}>
                    {t(STATUS_LABEL[site.status] ?? 'Waiting')}
                  </Badge>
                  {site.error && (
                    <div
                      className='text-muted-foreground mt-1 max-w-72 truncate text-xs'
                      title={site.error}
                    >
                      {site.error}
                    </div>
                  )}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {site.claude_models || '-'}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {site.top_up_price || '-'}
                </TableCell>
                <TableCell className='text-muted-foreground text-xs whitespace-nowrap'>
                  {formatTimestampToDate(site.checked_at)}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={site.enabled}
                    onCheckedChange={(enabled) =>
                      update.mutate({ id: site.id, enabled })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={!site.enabled}
                    onClick={() => check.mutate(site.id)}
                  >
                    {t('Check now')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {filtered.length > SHOWN && (
        <p className='text-muted-foreground text-xs'>
          {t('Showing the first {{count}}; search to narrow the list.', {
            count: SHOWN,
          })}
        </p>
      )}
    </div>
  )
}
