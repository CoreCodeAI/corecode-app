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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { setRivalOption } from '../api'
import type { RivalBoard } from '../types'

/** The monitor's switch and egress proxy. */
export function SettingsBar({ board }: { board: RivalBoard }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [proxy, setProxy] = useState('')
  const save = useMutation({
    mutationFn: (v: {
      key: 'rival_price_setting.enabled' | 'rival_price_setting.proxy'
      value: boolean | string
    }) => setRivalOption(v.key, v.value),
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      setProxy('')
      void queryClient.invalidateQueries({ queryKey: ['rival-prices'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className='bg-muted/40 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border px-4 py-3 text-sm'>
      <label className='flex items-center gap-2'>
        <Switch
          checked={board.enabled}
          disabled={save.isPending}
          onCheckedChange={(value) =>
            save.mutate({ key: 'rival_price_setting.enabled', value })
          }
        />
        <span className='font-medium'>
          {board.enabled ? t('Monitoring on') : t('Monitoring off')}
        </span>
      </label>
      <div className='flex min-w-0 flex-1 items-center gap-2'>
        <span className='text-muted-foreground shrink-0'>
          {board.proxy_set ? t('Egress proxy set') : t('No egress proxy')}
        </span>
        <Input
          className='h-8 max-w-sm'
          placeholder='socks5://user:pass@host:port'
          value={proxy}
          onChange={(e) => setProxy(e.target.value)}
        />
        <Button
          size='sm'
          variant='outline'
          disabled={save.isPending || proxy.trim() === ''}
          onClick={() =>
            save.mutate({
              key: 'rival_price_setting.proxy',
              value: proxy.trim(),
            })
          }
        >
          {t('Save')}
        </Button>
        {board.proxy_set && (
          <Button
            size='sm'
            variant='ghost'
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ key: 'rival_price_setting.proxy', value: '' })
            }
          >
            {t('Clear')}
          </Button>
        )}
      </div>
      {!board.proxy_set && (
        <p className='text-muted-foreground basis-full text-xs'>
          {t(
            'Without a proxy, every probe comes from this server and shows its address to the other relays. Some relays also show different prices to different regions.'
          )}
        </p>
      )}
    </div>
  )
}
