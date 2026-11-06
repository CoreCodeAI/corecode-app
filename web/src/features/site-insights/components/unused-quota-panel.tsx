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
import {
  expiringAccounts,
  UNUSED_CAPACITY_SHARE,
  UNUSED_FLOOR_USD,
  type ExpiringAccount,
} from './unused-quota'

/**
 * Which accounts will not spend their week. The pool can be short overall and
 * still strand quota on a few accounts: the router places a new conversation
 * by headroom, and that does not know whether an account is spending its
 * week. Read-only; the engine's pace controller is what moves traffic.
 */
export function UnusedQuotaPanel(props: {
  accounts: EngineAccount[]
  observedAt: number
  total?: { usd: number; counted: number } | null
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const rows = expiringAccounts(props.accounts, props.observedAt)
  if (rows.length === 0) return null
  const amount = rows.reduce((sum, row) => sum + row.unused, 0)
  return (
    <Panel
      title={t('Quota that will expire unused')}
      description={t(
        'About {{amount}} of weekly quota resets unused if each account keeps its last 24 hours’ spend rate.',
        { amount: fmt.usdWhole(props.total?.usd ?? amount) }
      )}
      help={t(
        'Projected from the pool estimate: each account’s weekly quota left, minus its last 24 hours’ average spend over the hours until its reset. Accounts whose unused quota is under {{floor}} or {{share}} of their weekly capacity are left out as rounding noise.',
        {
          floor: fmt.usdWhole(UNUSED_FLOOR_USD),
          share: fmt.pct(UNUSED_CAPACITY_SHARE),
        }
      )}
    >
      <SimpleTable<ExpiringAccount>
        rows={rows}
        rowKey={(row) => row.account.credential_id}
        empty=''
        columns={[
          {
            key: 'account',
            label: t('Account'),
            render: (row) => (
              <span className='flex items-center gap-2'>
                {row.account.email_mask}
                <Badge variant='outline'>{row.account.group}</Badge>
              </span>
            ),
          },
          {
            key: 'unused',
            label: t('Unused at reset'),
            align: 'right',
            render: (row) => (
              <span className='font-medium text-amber-600 dark:text-amber-400'>
                {fmt.usdWhole(row.unused)}
              </span>
            ),
          },
          {
            key: 'remaining',
            label: t('7-day left'),
            align: 'right',
            render: (row) =>
              row.account.seven_day_remaining_usd != null
                ? fmt.usdWhole(row.account.seven_day_remaining_usd)
                : '-',
          },
          {
            key: 'reset',
            label: t('Resets in'),
            align: 'right',
            render: (row) =>
              row.hours > 0
                ? t('{{hours}} h', { hours: Math.round(row.hours) })
                : '-',
          },
          {
            key: 'rate',
            label: t('Spending / needed'),
            align: 'right',
            render: (row) =>
              row.account.burn_usd_per_hour != null && row.needed != null
                ? t('{{spend}}/h of {{needed}}/h', {
                    spend: fmt.usd(row.account.burn_usd_per_hour),
                    needed: fmt.usd(row.needed),
                  })
                : '-',
          },
        ]}
      />
    </Panel>
  )
}
