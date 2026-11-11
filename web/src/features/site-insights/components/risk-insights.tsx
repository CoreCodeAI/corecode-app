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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

import { DEBT_ALERT_USD, useInsightsFormat, useTabLabel } from '../lib'
import type { BalanceUser } from '../types'
import { useClusterReasons } from '../verdicts/risk'
import { TabLink } from './insight-kit'
import type { RankedCluster } from './risk-analysis'
import { Panel, SimpleTable, UserLabel } from './shared'

const LINK = 'text-primary font-medium hover:underline'

/** Where the operator acts on one account: its request logs and its row in Users. */
export function UserActions(props: { user_id: number; username: string }) {
  const { t } = useTranslation()
  return (
    <span className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
      <Link
        to='/usage-logs/$section'
        params={{ section: 'common' }}
        search={{ userId: String(props.user_id) }}
        className={LINK}
      >
        {t('Logs')}
      </Link>
      {props.username && (
        <Link to='/users' search={{ filter: props.username }} className={LINK}>
          {t('Users')}
        </Link>
      )}
    </span>
  )
}

/** The Risk Control page's audit and violation records, where intercepts are handled. */
export function RiskControlLinks() {
  const { t } = useTranslation()
  return (
    <p className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
      <span>{t('Risk Control')}:</span>
      <Link to='/risk-control' hash='audit' className={LINK}>
        {t('Risk audit')}
      </Link>
      <Link to='/risk-control' hash='violations' className={LINK}>
        {t('Violation records')}
      </Link>
    </p>
  )
}

/** Shared addresses as a review queue: the riskiest first, each with its reasons. */
export function ClusterList(props: { clusters: RankedCluster[] }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const reasonsOf = useClusterReasons()
  return (
    <ul className='grid gap-3'>
      {props.clusters.map((cluster) => (
        <li key={cluster.ip} className='min-w-0 rounded-md border px-4 py-3'>
          <div className='mb-2 flex flex-wrap items-center gap-2 text-sm'>
            <span className='font-mono'>{cluster.ip}</span>
            <Badge variant='outline'>
              {t('{{count}} accounts', { count: cluster.users.length })}
            </Badge>
            {reasonsOf(cluster.risk).map((reason) => {
              let variant: 'destructive' | 'warning' | 'secondary' = 'secondary'
              if (reason.tone === 'danger') variant = 'destructive'
              if (reason.tone === 'warning') variant = 'warning'
              return (
                <Badge key={reason.key} variant={variant}>
                  {reason.text}
                </Badge>
              )
            })}
            <span className='text-muted-foreground text-xs'>
              {t('{{count}} requests', { count: cluster.requests })}
            </span>
          </div>
          <SimpleTable
            rows={cluster.users}
            rowKey={(row) => row.user_id}
            empty=''
            columns={[
              {
                key: 'user',
                label: t('User'),
                render: (row) => <UserLabel {...row} />,
              },
              {
                key: 'created',
                label: t('Registered'),
                render: (row) => fmt.time(row.created_at),
              },
              {
                key: 'flags',
                label: t('Has paid'),
                render: (row) =>
                  [row.paid && t('Topped up'), row.subscription && t('Plan')]
                    .filter(Boolean)
                    .join(' · ') || '-',
              },
              {
                key: 'req',
                label: t('Requests'),
                align: 'right',
                render: (row) => fmt.num(row.requests),
              },
              {
                key: 'bal',
                label: t('Balance'),
                align: 'right',
                render: (row) => fmt.usd(row.balance_usd),
              },
              {
                key: 'act',
                label: t('Actions'),
                render: (row) => <UserActions {...row} />,
              },
            ]}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * Balances below DEBT_ALERT_USD now, whatever the range, with each debtor
 * that also shares an address marked.
 */
export function DebtPanel(props: {
  debtors: BalanceUser[]
  clustered: Set<number>
  loading: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const tabLabel = useTabLabel()
  return (
    <Panel
      title={t('Negative balances')}
      description={
        props.loading
          ? undefined
          : t(
              'Owing more than {{amount}}, as of now: not limited to the range.',
              {
                amount: fmt.usd(-DEBT_ALERT_USD),
              }
            )
      }
    >
      <div className='grid gap-3'>
        <SimpleTable
          rows={props.debtors}
          rowKey={(row) => row.user_id}
          empty={t('No customer owes money')}
          columns={[
            {
              key: 'user',
              label: t('User'),
              render: (row) => (
                <span className='flex flex-wrap items-center gap-2'>
                  <UserLabel {...row} />
                  {props.clustered.has(row.user_id) && (
                    <Badge variant='warning'>{t('Shares an address')}</Badge>
                  )}
                </span>
              ),
            },
            {
              key: 'b',
              label: t('Balance'),
              align: 'right',
              render: (row) => (
                <span className='text-destructive'>
                  {fmt.usd(row.balance_usd)}
                </span>
              ),
            },
            {
              key: 'act',
              label: t('Actions'),
              render: (row) => <UserActions {...row} />,
            },
          ]}
        />
        <p className='text-xs'>
          <TabLink tab='finance'>
            {t('Debt and balances in {{tab}}', { tab: tabLabel('finance') })}
          </TabLink>
        </p>
      </div>
    </Panel>
  )
}
