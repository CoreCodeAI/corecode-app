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

import { Badge } from '@/components/ui/badge'

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
        'Seats of one team share a subscription and are one row. Claude does not report its billing date, so an estimated renewal is the next monthly anniversary of the subscription start; a cancelled subscription still shows one.'
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
                <span>{row.name}</span>
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
        ]}
      />
    </Panel>
  )
}
