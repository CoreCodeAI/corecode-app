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
import { CalendarClock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

import { saveSubscriptionRenewal } from '../api'
import { useInsightsFormat } from '../lib'
import type { EngineAccount } from '../types'
import { Panel, SimpleTable } from './shared'

const DAY_MS = 24 * 60 * 60 * 1000
// A renewal this close is shown in red, so a seat about to bill is noticed.
const RENEWAL_SOON_DAYS = 7

type Renewal = {
  key: string
  name: string
  groups: string[]
  plan: string
  seats: string[]
  periodEnd: number
  estimated: boolean
  organizationUUID: string
  status: string
}

/** The local calendar date of an instant, as a date input takes it. */
function inputDate(ms: number) {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Enters the billing date read from the provider's billing page. Claude does
 * not report it, and its subscription start misses a moved billing anchor.
 */
function RenewalDateEditor(props: { row: Renewal }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(inputDate(props.row.periodEnd))
  const save = useMutation({
    mutationFn: (renewsOn: string) =>
      saveSubscriptionRenewal({
        organizationUUID: props.row.organizationUUID,
        renewsOn,
        organizationName: props.row.name,
      }),
    onSuccess: () => {
      toast.success(t('Renewal date saved'))
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['site-insights', 'pool'] })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  })
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setDate(inputDate(props.row.periodEnd))
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('Set renewal date')}
          />
        }
      >
        <CalendarClock />
      </PopoverTrigger>
      <PopoverContent align='end' className='flex w-72 flex-col gap-3'>
        <PopoverTitle>{t('Set renewal date')}</PopoverTitle>
        <PopoverDescription>
          {t(
            'Enter the next renewal date from the billing page of {{name}}. Later renewals follow monthly from it.',
            { name: props.row.name }
          )}
        </PopoverDescription>
        <Input
          type='date'
          value={date}
          aria-label={t('Renewal date')}
          onChange={(event) => setDate(event.target.value)}
        />
        <div className='flex justify-end gap-2'>
          {!props.row.estimated && (
            <Button
              variant='outline'
              size='sm'
              disabled={save.isPending}
              onClick={() => save.mutate('')}
            >
              {t('Clear')}
            </Button>
          )}
          <Button
            size='sm'
            disabled={!date || save.isPending}
            onClick={() => save.mutate(date)}
          >
            {t('Save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * When each subscription in the pool next renews. The seats of one team share
 * a subscription, so they are one row. The engine counts a Claude renewal
 * monthly from the subscription start, because Claude does not report it.
 */
export function SubscriptionRenewalsPanel(props: {
  accounts: EngineAccount[]
  now: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const byKey = new Map<string, Renewal>()
  for (const account of props.accounts) {
    if (!account.subscription_period_end_ms) continue
    const key = account.organization || `#${account.credential_id}`
    const renewal = byKey.get(key) ?? {
      key,
      name: account.organization || account.email_mask,
      groups: [],
      plan: account.plan,
      seats: [],
      periodEnd: account.subscription_period_end_ms,
      estimated: false,
      organizationUUID: account.organization_uuid ?? '',
      status: account.subscription_status ?? '',
    }
    if (!renewal.groups.includes(account.group)) {
      renewal.groups.push(account.group)
    }
    renewal.seats.push(account.email_mask)
    renewal.periodEnd = Math.min(
      renewal.periodEnd,
      account.subscription_period_end_ms
    )
    renewal.estimated ||= account.subscription_state === 'estimated'
    byKey.set(key, renewal)
  }
  const rows = [...byKey.values()].sort((a, b) => a.periodEnd - b.periodEnd)
  if (rows.length === 0) return null

  const daysLeft = (row: Renewal) =>
    Math.ceil((row.periodEnd - props.now) / DAY_MS)
  const soon = rows.filter((row) => daysLeft(row) <= RENEWAL_SOON_DAYS)

  return (
    <Panel
      title={t('Subscription renewals')}
      description={
        soon.length
          ? t('Renewing within {{days}} days: {{names}}.', {
              days: RENEWAL_SOON_DAYS,
              names: soon.map((row) => row.name).join(', '),
            })
          : undefined
      }
      help={t(
        'Seats of one team share a subscription and are one row. Claude does not report its billing date: enter the date from its billing page with the calendar button. Until then the renewal is estimated as the next monthly anniversary of the subscription start, which misses a plan change.'
      )}
    >
      <SimpleTable<Renewal>
        rows={rows}
        rowKey={(row) => row.key}
        empty={t('No renewal dates')}
        columns={[
          {
            key: 'subscription',
            label: t('Subscription'),
            render: (row) => (
              <span className='grid gap-0.5'>
                <span className='flex items-center gap-2'>
                  {row.name}
                  {row.status && row.status !== 'active' && (
                    <Badge variant='warning'>{row.status}</Badge>
                  )}
                </span>
                {row.seats.length > 1 && (
                  <span className='text-muted-foreground text-xs'>
                    {t('{{count}} seats', { count: row.seats.length })}
                    {' · '}
                    {row.seats.join(', ')}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'group',
            label: t('Group'),
            render: (row) => row.groups.join(', '),
          },
          {
            key: 'plan',
            label: t('Plan'),
            render: (row) => row.plan || '-',
          },
          {
            key: 'renews',
            label: t('Renews'),
            align: 'right',
            render: (row) => (
              <span className='flex items-center justify-end gap-2 tabular-nums'>
                {fmt.day(Math.floor(row.periodEnd / 1000))}
                {row.estimated && (
                  <span className='text-muted-foreground text-xs'>
                    {t('estimated')}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'days',
            label: t('Days left'),
            align: 'right',
            render: (row) => {
              const days = daysLeft(row)
              return (
                <Badge
                  variant={
                    days <= RENEWAL_SOON_DAYS ? 'destructive' : 'outline'
                  }
                  className='tabular-nums'
                >
                  {days <= 0 ? t('Due') : t('{{count}} days', { count: days })}
                </Badge>
              )
            },
          },
          {
            key: 'edit',
            label: '',
            align: 'right',
            render: (row) =>
              row.organizationUUID ? <RenewalDateEditor row={row} /> : null,
          },
        ]}
      />
    </Panel>
  )
}
