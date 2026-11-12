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
import { Skeleton } from '@/components/ui/skeleton'

import {
  DEBT_ALERT_USD,
  joinSentences,
  useInsightsFormat,
  useSignupMethodLabel,
  useTabLabel,
} from '../lib'
import type { BalanceUser, RiskInsights, UnpaidSpender } from '../types'
import { useClusterReasons } from '../verdicts/risk'
import { TabLink } from './insight-kit'
import {
  giftOutcomes,
  isHandFunded,
  rankClusters,
  sharedCounts,
  splitExits,
  unpaidSpend,
  usesGiftPart,
  withRisk,
  type RankedCluster,
  type RiskCluster,
} from './risk-analysis'
import {
  Breakdown,
  Panel,
  SimpleTable,
  UserLabel,
  type TableState,
} from './shared'

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

/**
 * What a list with no entries says: a skeleton while its source loads, that
 * it could not be read when the source failed, and only then the empty
 * sentence.
 */
function ListState(props: { state?: TableState; empty: string }) {
  const { t } = useTranslation()
  if (props.state === 'loading') {
    return (
      <div role='status' aria-label={t('Loading...')} className='grid gap-2'>
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-full' />
      </div>
    )
  }
  return (
    <p className='text-muted-foreground text-xs'>
      {props.state === 'error' ? t('Could not be read') : props.empty}
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
                render: (row) => {
                  let plan: string | false = row.subscription && t('Plan')
                  if (row.limited_plan) plan = t('One-per-user plan')
                  return (
                    [row.paid && t('Topped up'), plan]
                      .filter(Boolean)
                      .join(' · ') || '-'
                  )
                },
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

/** The shared exits as a table, in the server's order, each with the reasons its row shows. */
function ExitTable(props: { exits: RiskCluster[]; start: number | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const reasonsOf = useClusterReasons()
  return (
    <SimpleTable
      rows={withRisk(props.exits, props.start)}
      rowKey={(row) => row.ip}
      empty=''
      columns={[
        {
          key: 'ip',
          label: t('Address'),
          render: (row) => <span className='font-mono'>{row.ip}</span>,
        },
        {
          key: 'accounts',
          label: t('Accounts'),
          align: 'right',
          render: (row) => fmt.num(row.users.length),
        },
        {
          key: 'reasons',
          label: t('Reasons'),
          render: (row) =>
            reasonsOf(row.risk)
              .map((reason) => reason.text)
              .join(t(', ')) || '-',
        },
        {
          key: 'req',
          label: t('Requests'),
          align: 'right',
          render: (row) => fmt.num(row.requests),
        },
      ]}
    />
  )
}

/**
 * Addresses several accounts used, riskiest first, with the shared exits
 * folded away under their own heading: they are many customers behind one
 * proxy or network, not one person, and count nowhere else. The exits come
 * ranked from the server and are listed as sent.
 */
export function SharedAddressPanel(props: {
  data: RiskInsights | undefined
  clusters: RiskCluster[]
  exits: RiskCluster[]
  start: number | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const ranked = rankClusters(splitExits(props.clusters).review, props.start)
  const counts = sharedCounts(props.data, props.clusters, props.exits)
  const marksExits = props.data?.shared_ip_total != null
  let description: string | undefined
  if (props.data && counts.total > 0) {
    description =
      counts.listed < counts.total
        ? t(
            '{{total}} addresses are shared by several accounts; the {{listed}} riskiest are listed, the riskiest first.',
            { total: counts.total, listed: counts.listed }
          )
        : t(
            '{{count}} addresses are shared by several accounts, the riskiest first.',
            { count: counts.total }
          )
  }
  const help = marksExits
    ? joinSentences(
        t(
          'Addresses several accounts sent requests, signed in, opened a session or placed a plan order from in the range: one person with several accounts, a shared machine, or a reseller. Sign-ins, sessions and orders add no requests.'
        ),
        t(
          'Plan buyers are members who bought a one-per-user plan within 30 days of the range’s end; Topped up means a real top-up, not a plan order.'
        ),
        t(
          'Shared exits (20 or more requesters in 7 days, or 5 or more members in 30 days without a one-per-user plan, the rule the purchase check uses) are listed apart and left out of the count.'
        ),
        t(
          'Ranked by accounts created in the range, registrations within 10 minutes of each other, several plan buyers, and unpaid accounts with nothing left; an address where every account paid ranks low.'
        )
      )
    : t(
        'Addresses several accounts sent requests or signed in from: one person with several accounts, a shared machine, or a reseller. Ranked by accounts created in the range, registrations within 10 minutes of each other, several plan buyers, and unpaid accounts with nothing left; an address where every account paid ranks low.'
      )
  let exitTitle: string | undefined
  if (counts.exits > 0) {
    exitTitle =
      counts.exitsListed < counts.exits
        ? t('{{count}} shared exits, {{listed}} listed: not counted above', {
            count: counts.exits,
            listed: counts.exitsListed,
          })
        : t('{{count}} shared exits: not counted above', {
            count: counts.exits,
          })
  }
  return (
    <Panel
      title={t('Accounts sharing an address')}
      description={description}
      help={help}
    >
      <div className='grid gap-3'>
        {ranked.length === 0 ? (
          <ListState
            state={props.state}
            empty={t('No address is shared in this range')}
          />
        ) : (
          <ClusterList clusters={ranked} />
        )}
        {exitTitle && (
          <details>
            <summary className='text-muted-foreground cursor-pointer text-xs'>
              {exitTitle}
            </summary>
            {props.exits.length > 0 && (
              <div className='mt-3'>
                <ExitTable exits={props.exits} start={props.start} />
              </div>
            )}
          </details>
        )}
      </div>
    </Panel>
  )
}

/** The invite sign-up gift's outcomes, by name. */
function useGiftStatusLabel(): (name: string) => string {
  const { t } = useTranslation()
  return (name) => {
    switch (name) {
      case 'gifted':
        return t('Gifted')
      case 'ip_used':
        return t('Blocked: address already claimed')
      case 'cap_reached':
        return t('Blocked: inviter’s cap reached')
      case 'email_blocked':
        return t('Blocked: email refused')
      case 'email_signup':
        return t('Not gifted: email sign-up')
      default:
        return name
    }
  }
}

/**
 * Sign-ups of the range that consumed and never paid, the largest first,
 * and the inviters who brought most of them: gift farming that needs no
 * shared address. Where the server splits the spend by source, each account
 * shows its parts, and one funded mostly by an administrator is marked, so it
 * does not read as farming.
 */
export function UnpaidSpendersPanel(props: {
  data: RiskInsights | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const methodLabel = useSignupMethodLabel()
  const tabLabel = useTabLabel()
  const spend = unpaidSpend(props.data)
  const split = spend?.split != null
  const giftPart = usesGiftPart(props.data)
  const part = (value: number | undefined) =>
    value == null ? '-' : fmt.cny(value)
  let description: string | undefined
  if (spend && spend.spenders > 0) {
    description = joinSentences(
      t(
        '{{unpaid}} of the {{spenders}} new accounts that used credit have never paid; they used {{amount}} in the range.',
        {
          unpaid: fmt.num(spend.unpaid),
          spenders: fmt.num(spend.spenders),
          amount: fmt.cny(spend.spend),
        }
      ),
      spend.split &&
        t(
          'Of that, {{granted}} was granted by hand, {{redeemed}} came from redemption codes, {{gift}} from gift plans and {{signup}} from sign-up and invite gifts.',
          {
            granted: fmt.cny(spend.split.granted),
            redeemed: fmt.cny(spend.split.redeemed),
            gift: fmt.cny(spend.split.gift),
            signup: fmt.cny(spend.split.signupGift),
          }
        )
    )
  } else if (spend) {
    description = t('No account created in the range used credit.')
  }
  return (
    <Panel
      title={t('Spent without paying')}
      description={description}
      help={
        split
          ? t(
              'Accounts created in the range that consumed in it and have never paid: no successful top-up with money and no plan bought with money, at any time. Consumption is in the range, from the hourly rollup. It splits into credit an administrator granted by hand (audit log, up to the range’s end), redemption codes, gift plans, and sign-up and invite gifts. An account whose hand grant covers over half its consumption is marked as credited by an administrator. Only the gift part judges an inviter. Trial users and buyers of resold redemption codes look the same, so read an inviter with several such accounts as the signal, not one account.'
            )
          : t(
              'Accounts created in the range that consumed in it and have never paid: no successful top-up with money, at any time. Consumption is in the range, from the hourly rollup; the gift plan part is what given plans covered, the rest came from sign-up or invite credit. Trial users and buyers of resold redemption codes look the same, so read an inviter with several such accounts as the signal, not one account.'
            )
      }
    >
      <div className='grid gap-4'>
        <SimpleTable
          rows={props.data?.unpaid_spender_top}
          rowKey={(row) => row.user_id}
          state={props.state}
          empty={t('No new account used credit without paying')}
          columns={[
            {
              key: 'user',
              label: t('User'),
              render: (row) => (
                <span className='flex flex-wrap items-center gap-2'>
                  <UserLabel {...row} />
                  {isHandFunded(row) && (
                    <Badge variant='secondary'>
                      {t('Credited by an administrator')}
                    </Badge>
                  )}
                </span>
              ),
            },
            {
              key: 'signup',
              label: t('Registered'),
              render: (row) =>
                `${fmt.time(row.created_at)} · ${methodLabel(row.signup_method)}`,
            },
            {
              key: 'inviter',
              label: t('Inviter'),
              render: (row) =>
                row.inviter.user_id > 0 ? <UserLabel {...row.inviter} /> : '-',
            },
            {
              key: 'used',
              label: t('Consumption'),
              align: 'right',
              render: (row) => fmt.cny(row.consumption_usd),
            },
            ...(split
              ? [
                  {
                    key: 'granted',
                    label: t('Granted by hand'),
                    align: 'right' as const,
                    render: (row: UnpaidSpender) => part(row.granted_usd),
                  },
                  {
                    key: 'redeemed',
                    label: t('Redeemed codes'),
                    align: 'right' as const,
                    render: (row: UnpaidSpender) => part(row.redeemed_usd),
                  },
                ]
              : []),
            {
              key: 'gift',
              label: t('Gift plans'),
              align: 'right',
              render: (row) => fmt.cny(row.gift_plan_usd),
            },
            ...(split
              ? [
                  {
                    key: 'signup-gift',
                    label: t('Sign-up and invite gifts'),
                    align: 'right' as const,
                    render: (row: UnpaidSpender) => part(row.signup_gift_usd),
                  },
                ]
              : []),
            {
              key: 'act',
              label: t('Actions'),
              render: (row) => <UserActions {...row} />,
            },
          ]}
        />
        {(props.data?.unpaid_inviters?.length ?? 0) > 0 && (
          <SimpleTable
            rows={props.data?.unpaid_inviters}
            rowKey={(row) => row.user_id}
            empty=''
            columns={[
              {
                key: 'inviter',
                label: t('Inviter'),
                render: (row) =>
                  row.user_id > 0 ? <UserLabel {...row} /> : t('No inviter'),
              },
              {
                key: 'accounts',
                label: t('Unpaid accounts'),
                align: 'right',
                render: (row) => fmt.num(row.accounts),
              },
              {
                key: 'used',
                label: t('Consumption'),
                align: 'right',
                render: (row) => fmt.cny(row.consumption_usd),
              },
              ...(giftPart
                ? [
                    {
                      key: 'gift-part',
                      label: t('Gift part'),
                      align: 'right' as const,
                      render: (row: { gift_usd?: number }) =>
                        part(row.gift_usd),
                    },
                  ]
                : []),
              {
                key: 'act',
                label: t('Actions'),
                render: (row) =>
                  row.user_id > 0 ? <UserActions {...row} /> : null,
              },
            ]}
          />
        )}
        <p className='text-xs'>
          <TabLink tab='channels'>
            {t('Gift spend by channel in {{tab}}', {
              tab: tabLabel('channels'),
            })}
          </TabLink>
        </p>
      </div>
    </Panel>
  )
}

/** What the invite sign-up gift's guard decided in the range, and for whom it blocked most. */
export function GiftGuardPanel(props: {
  data: RiskInsights | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useGiftStatusLabel()
  const outcomes = giftOutcomes(props.data)
  return (
    <Panel
      title={t('Invite sign-up gifts')}
      description={
        outcomes &&
        outcomes.total > 0 &&
        t('{{blocked}} of {{total}} gift claims were blocked.', {
          blocked: fmt.num(outcomes.blocked),
          total: fmt.num(outcomes.total),
        })
      }
      help={t(
        'Each invited sign-up in the range and what the gift guard decided. Blocked means the address had already claimed one, the inviter’s cap was reached, or the email was refused; an email sign-up gets no gift by policy and is not a block.'
      )}
    >
      <div className='grid gap-4'>
        <Breakdown
          items={props.data?.signup_gifts}
          label={label}
          state={props.state}
          empty={t('No invited sign-up in this range')}
        />
        {(props.data?.gift_block_inviters?.length ?? 0) > 0 && (
          <SimpleTable
            rows={props.data?.gift_block_inviters}
            rowKey={(row) => row.user_id}
            empty=''
            columns={[
              {
                key: 'inviter',
                label: t('Inviter'),
                render: (row) => <UserLabel {...row} />,
              },
              {
                key: 'blocked',
                label: t('Blocked'),
                align: 'right',
                render: (row) => fmt.num(row.blocked),
              },
              {
                key: 'gifted',
                label: t('Gifted'),
                align: 'right',
                render: (row) => fmt.num(row.gifted),
              },
              {
                key: 'act',
                label: t('Actions'),
                render: (row) => <UserActions {...row} />,
              },
            ]}
          />
        )}
      </div>
    </Panel>
  )
}

/** Accounts that share one inbox once the +tag and Gmail dots are dropped. */
export function AliasClusterPanel(props: { data: RiskInsights | undefined }) {
  const { t } = useTranslation()
  return (
    <Panel
      title={t('Accounts sharing an inbox')}
      help={t(
        'Accounts whose email reaches the same inbox once case, the +tag and, on Gmail, the dots are ignored, at least one of them created in the range. The 20 largest are listed.'
      )}
    >
      <SimpleTable
        rows={props.data?.alias_clusters}
        rowKey={(row) => row.canonical}
        empty={t('No inbox is shared')}
        columns={[
          {
            key: 'inbox',
            label: t('Inbox'),
            render: (row) => (
              <span className='font-mono text-xs'>{row.canonical}</span>
            ),
          },
          {
            key: 'users',
            label: t('Accounts'),
            render: (row) => (
              <span className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                {row.users.map((user) => (
                  <Link
                    key={user.user_id}
                    to='/users'
                    search={{ filter: user.username }}
                    className={LINK}
                  >
                    <UserLabel {...user} />
                  </Link>
                ))}
              </span>
            ),
          },
        ]}
      />
    </Panel>
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
  state?: TableState
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
          rows={props.state ? undefined : props.debtors}
          rowKey={(row) => row.user_id}
          state={props.state}
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
