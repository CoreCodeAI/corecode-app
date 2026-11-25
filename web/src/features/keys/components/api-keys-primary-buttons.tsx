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
import { ChevronDown, Globe, Plus } from 'lucide-react'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import { useStatus } from '@/hooks/use-status'

import {
  addressAccent,
  addressVendor,
  VENDOR_STYLES,
  type AddressVendor,
} from '../lib/address-vendor'
import { useApiKeys } from './api-keys-provider'

function tint(color: string, percent: number) {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`
}

/** The vendor's mark, or a globe, on a tile of the row's color. */
function AddressMark(props: {
  vendor: AddressVendor | null
  accent: string | undefined
}) {
  const Mark = props.vendor ? VENDOR_STYLES[props.vendor].Mark : null
  return (
    <span
      aria-hidden='true'
      className='bg-muted flex size-7 shrink-0 items-center justify-center rounded-md'
      style={
        props.accent
          ? { backgroundColor: tint(props.accent, 14), color: props.accent }
          : undefined
      }
    >
      {Mark ? (
        <Suspense fallback={null}>
          <Mark size={16} />
        </Suspense>
      ) : (
        <Globe className='size-4' />
      )}
    </span>
  )
}

export function ApiKeysPrimaryButtons() {
  const { t } = useTranslation()
  const { setOpen } = useApiKeys()
  const { status, loading } = useStatus()
  const { items } = useApiInfo()
  const serverAddress =
    (typeof status?.server_address === 'string' &&
      status.server_address.trim()) ||
    ''
  const addresses = items.length
    ? items
    : [
        {
          url: serverAddress || window.location.origin,
          route: serverAddress ? t('Default API address') : t('Current domain'),
          description: '',
          color: '',
        },
      ]

  return (
    <div className='flex flex-wrap gap-2'>
      <Popover>
        <PopoverTrigger render={<Button variant='outline' size='sm' />}>
          <Globe aria-hidden='true' />
          {t('API Addresses')}
          <ChevronDown aria-hidden='true' />
        </PopoverTrigger>
        <PopoverContent
          align='end'
          className='max-h-[min(28rem,var(--available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto'
        >
          <PopoverTitle>{t('API Addresses')}</PopoverTitle>
          {loading ? (
            <LoadingState inline size='sm' message={t('Loading...')} />
          ) : (
            <ItemGroup>
              {addresses.map((address) => {
                const vendor = addressVendor(address)
                const accent = addressAccent(vendor, address.color)
                return (
                <Item
                  key={address.url}
                  role='listitem'
                  variant='muted'
                  size='xs'
                  className='flex-nowrap items-start'
                  style={
                    accent
                      ? {
                          backgroundColor: tint(accent, 7),
                          borderLeft: `3px solid ${accent}`,
                        }
                      : undefined
                  }
                >
                  <AddressMark vendor={vendor} accent={accent} />
                  <ItemContent className='min-w-0 gap-1'>
                    <ItemTitle className='line-clamp-none break-words'>
                      {address.route}
                    </ItemTitle>
                    <code className='text-xs break-all select-text'>
                      {address.url}
                    </code>
                    {address.description && (
                      <ItemDescription className='line-clamp-none break-words'>
                        {address.description}
                      </ItemDescription>
                    )}
                  </ItemContent>
                  <ItemActions>
                    <CopyButton
                      value={address.url}
                      size='sm'
                      tooltip={t('Copy API URL')}
                      aria-label={`${t('Copy API URL')}: ${address.url}`}
                    />
                  </ItemActions>
                </Item>
                )
              })}
            </ItemGroup>
          )}
        </PopoverContent>
      </Popover>
      <Button size='sm' onClick={() => setOpen('create')}>
        <Plus className='h-4 w-4' />
        {t('Create API Key')}
      </Button>
    </div>
  )
}
