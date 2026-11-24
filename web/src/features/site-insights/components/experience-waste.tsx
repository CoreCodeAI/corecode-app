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
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

import { useInsightsFormat } from '../lib'
import type {
  ExperienceGroup,
  ExperienceInsights,
  ExperienceKind,
  ExperienceRefusal,
  ExperienceUser,
  WasteKind,
} from '../types'
import { useWasteKindLabel } from '../verdicts/experience'
import { KIND_DOTS, WASTE_KINDS } from './experience-analysis'
import { UserActions } from './risk-insights'
import { Panel, SimpleTable, UserLabel, type TableState } from './shared'

/** Money wasted per kind, with the requests and customers behind each and its share of the whole. */
export function WasteKinds(props: {
  data: ExperienceInsights | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useWasteKindLabel()
  const waste = props.data?.waste
  const rows = waste
    ? WASTE_KINDS.map(
        (kind) =>
          waste.kinds.find((item) => item.kind === kind) ?? {
            kind,
            requests: 0,
            users: 0,
            usd: 0,
          }
      )
    : []
  return (
    <Panel
      title={t('Waste by kind')}
      help={t(
        'Money charged to customers for requests that gave them nothing: refused by the model, failed mid-stream, charged to the wallet by the plan gate, or a one-hour cache write nothing read.'
      )}
    >
      <SimpleTable<ExperienceKind>
        rows={rows}
        rowKey={(row) => row.kind}
        state={props.state}
        empty={t('No wasted money in this range')}
        columns={[
          {
            key: 'kind',
            label: t('Kind'),
            render: (row) => (
              <span className='inline-flex items-center gap-2'>
                <span
                  aria-hidden
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    KIND_DOTS[row.kind as WasteKind]
                  )}
                />
                {label(row.kind)}
              </span>
            ),
          },
          {
            key: 'usd',
            label: t('Amount'),
            align: 'right',
            render: (row) => fmt.usd(row.usd),
          },
          {
            key: 'share',
            label: t('Share'),
            align: 'right',
            hint: t('Of the money wasted in all four kinds.'),
            render: (row) =>
              waste && waste.total_usd > 0
                ? fmt.pct(row.usd / waste.total_usd)
                : '-',
          },
          {
            key: 'requests',
            label: t('Requests'),
            align: 'right',
            hint: t('For the cache, one-hour writes.'),
            render: (row) => fmt.num(row.requests),
          },
          {
            key: 'users',
            label: t('Customers'),
            align: 'right',
            render: (row) => fmt.num(row.users),
          },
        ]}
      />
    </Panel>
  )
}

function GroupList(props: {
  rows: ExperienceGroup[]
  empty: string
  label: string
  state?: TableState
  name?: (name: string) => string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  return (
    <SimpleTable<ExperienceGroup>
      rows={props.rows}
      rowKey={(row) => row.name}
      state={props.state}
      empty={props.empty}
      columns={[
        {
          key: 'name',
          label: props.label,
          render: (row) => (
            <span className='block max-w-48 truncate' title={row.name}>
              {props.name ? props.name(row.name) : row.name || '-'}
            </span>
          ),
        },
        {
          key: 'usd',
          label: t('Amount'),
          align: 'right',
          render: (row) => fmt.usd(row.usd),
        },
        {
          key: 'requests',
          label: t('Requests'),
          align: 'right',
          render: (row) => fmt.num(row.requests),
        },
        {
          key: 'users',
          label: t('Customers'),
          align: 'right',
          render: (row) => fmt.num(row.users),
        },
      ]}
    />
  )
}

/** Task refunds: failed image and video tasks paid back, by model. */
export function RefundsPanel(props: {
  data: ExperienceInsights | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const waste = props.data?.waste
  return (
    <Panel
      title={t('Task refunds')}
      description={
        waste
          ? t(
              '{{amount}} paid back for {{count}} failed tasks to {{users}} customers.',
              {
                amount: fmt.usd(waste.refunds.usd),
                count: fmt.num(waste.refunds.requests),
                users: fmt.num(waste.refunds.users),
              }
            )
          : undefined
      }
      help={t(
        'Image and video tasks that failed and were paid back in full. A refund returns the money, so it is not counted as wasted; it shows how often a paid task fails. The settlement of a task that ran cheaper than reserved is not a refund.'
      )}
    >
      <GroupList
        rows={waste?.refund_models ?? []}
        state={props.state}
        label={t('Model')}
        empty={t('No refunds in this range')}
      />
    </Panel>
  )
}

function WastedCell(props: { usd: number }) {
  const fmt = useInsightsFormat()
  if (props.usd <= 0) return <span className='text-muted-foreground'>-</span>
  return <>{fmt.usd(props.usd)}</>
}

/** One customer's state, as a pair of badges: reported or not, still sending or silent. */
function UserStatus(props: { user: ExperienceUser }) {
  const { t } = useTranslation()
  const { user } = props
  return (
    <span className='flex flex-wrap items-center gap-1'>
      <Badge variant={user.filed_feedback ? 'secondary' : 'outline'}>
        {user.filed_feedback ? t('Filed a report') : t('No report')}
      </Badge>
      <Badge
        variant='outline'
        className={cn(
          user.silent
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-emerald-600 dark:text-emerald-400'
        )}
      >
        {user.silent ? t('Silent') : t('Still active')}
      </Badge>
    </span>
  )
}

/** The customers who lost the most: each kind, the total, and whether they spoke up and stayed. */
export function WasteUsers(props: {
  rows: ExperienceUser[] | undefined
  state?: TableState
  title: string
  description?: ReactNode
  help?: string
  empty: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useWasteKindLabel()
  return (
    <Panel
      title={props.title}
      description={props.description}
      help={props.help}
    >
      <SimpleTable<ExperienceUser>
        rows={props.rows}
        rowKey={(row) => row.user_id}
        state={props.state}
        empty={props.empty}
        card={(row) => (
          <div className='grid gap-1.5 text-sm'>
            <div className='flex items-baseline justify-between gap-2'>
              <UserLabel user_id={row.user_id} username={row.username} />
              <span className='font-medium'>{fmt.usd(row.total_usd)}</span>
            </div>
            <div className='text-muted-foreground flex flex-wrap gap-x-3 text-xs'>
              {WASTE_KINDS.map((kind) => {
                const usd = kindOfUser(row, kind)
                return usd > 0 ? (
                  <span key={kind}>
                    {label(kind)} {fmt.usd(usd)}
                  </span>
                ) : null
              })}
            </div>
            <UserStatus user={row} />
            <UserActions user_id={row.user_id} username={row.username} />
          </div>
        )}
        columns={[
          {
            key: 'user',
            label: t('Customer'),
            render: (row) => (
              <UserLabel user_id={row.user_id} username={row.username} />
            ),
          },
          ...WASTE_KINDS.map((kind) => ({
            key: kind,
            label: label(kind),
            align: 'right' as const,
            render: (row: ExperienceUser) => (
              <WastedCell usd={kindOfUser(row, kind)} />
            ),
          })),
          {
            key: 'total',
            label: t('Total'),
            align: 'right' as const,
            render: (row) => (
              <span className='font-medium'>{fmt.usd(row.total_usd)}</span>
            ),
          },
          {
            key: 'status',
            label: t('Status'),
            hint: t(
              'Whether the customer ever filed a report, and whether they have sent no request in the last 3 days.'
            ),
            render: (row) => <UserStatus user={row} />,
          },
          {
            key: 'actions',
            label: '',
            render: (row) => (
              <UserActions user_id={row.user_id} username={row.username} />
            ),
          },
        ]}
      />
    </Panel>
  )
}

function kindOfUser(user: ExperienceUser, kind: WasteKind): number {
  switch (kind) {
    case 'refusal':
      return user.refusal_usd
    case 'failed_billed':
      return user.failed_usd
    case 'gate_wallet':
      return user.gate_usd
    case 'cache_1h':
      return user.cache_usd
  }
}

/** The refused requests that were charged, newest first as the server keeps them, and which models and reasons they came from. */
export function RefusalDetails(props: {
  data: ExperienceInsights | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const waste = props.data?.waste
  const count = waste ? waste.refusals.length : 0
  const total = waste
    ? (waste.kinds.find((k) => k.kind === 'refusal')?.requests ?? 0)
    : 0
  return (
    <Collapsible>
      <CollapsibleTrigger className='group text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-h-8 items-center gap-1 rounded-sm text-sm outline-none focus-visible:ring-2'>
        <ChevronDown
          aria-hidden
          className='size-4 transition-transform group-data-[panel-open]:rotate-180'
        />
        {t('Refused requests that were charged ({{count}})', {
          count: fmt.num(total),
        })}
      </CollapsibleTrigger>
      <CollapsibleContent className='grid gap-4 pt-3'>
        <div className='grid gap-4 lg:grid-cols-2'>
          <Panel title={t('Refusals by model')}>
            <GroupList
              rows={waste?.refusal_models ?? []}
              state={props.state}
              label={t('Model')}
              empty={t('No refusals in this range')}
            />
          </Panel>
          <Panel title={t('Refusals by reason')}>
            <GroupList
              rows={waste?.refusal_reasons ?? []}
              state={props.state}
              label={t('Reason')}
              empty={t('No refusals in this range')}
            />
          </Panel>
        </div>
        <Panel
          title={t('Largest charged refusals')}
          description={
            total > count
              ? t('The {{count}} largest of {{total}}.', {
                  count: fmt.num(count),
                  total: fmt.num(total),
                })
              : undefined
          }
        >
          <SimpleTable<ExperienceRefusal>
            rows={waste?.refusals}
            rowKey={(row, index) => `${row.request_id}-${index}`}
            state={props.state}
            empty={t('No refusals in this range')}
            columns={[
              {
                key: 'at',
                label: t('Time'),
                render: (row) => (
                  <span className='whitespace-nowrap'>{fmt.time(row.at)}</span>
                ),
              },
              {
                key: 'user',
                label: t('Customer'),
                render: (row) => (
                  <UserLabel user_id={row.user_id} username={row.username} />
                ),
              },
              {
                key: 'model',
                label: t('Model'),
                render: (row) => (
                  <span
                    className='block max-w-40 truncate'
                    title={row.model_name}
                  >
                    {row.model_name || '-'}
                  </span>
                ),
              },
              {
                key: 'category',
                label: t('Reason'),
                render: (row) => row.category || '-',
              },
              {
                key: 'usd',
                label: t('Charged'),
                align: 'right',
                render: (row) => fmt.usdFine(row.usd),
              },
              {
                key: 'request',
                label: t('Request ID'),
                render: (row) => (
                  <span
                    className='text-muted-foreground block max-w-32 truncate font-mono text-xs'
                    title={row.request_id}
                  >
                    {row.request_id || '-'}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      </CollapsibleContent>
    </Collapsible>
  )
}
