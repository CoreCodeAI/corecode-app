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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  ATTENTION,
  groupProvider,
  PROVIDER_LABELS,
  useInsightsFormat,
} from '../lib'
import {
  POOL_PROVIDERS,
  type EngineAccount,
  type EngineGroup,
  type EngineOutlook,
  type EnginePool,
  type PoolProvider,
  type PoolUsage,
} from '../types'
import { pickModel, windowOf } from './outlook'
import { ForecastPanel } from './pool-forecast'
import { RemainingPanel } from './pool-remaining'
import { PoolUsagePanel } from './pool-usage'
import { ResetCreditsCell } from './reset-credits-cell'
import {
  MetricGrid,
  Meter,
  Panel,
  ProviderSwitch,
  SimpleTable,
  type MetricItem,
  type Tone,
} from './shared'
import { SubscriptionRenewalsPanel } from './subscription-renewals-panel'
import { poolRunsShort } from './unused-quota'
import { UnusedQuotaPanel } from './unused-quota-panel'

function statusVariant(account: EngineAccount) {
  if (account.eligible) return 'outline'
  return ATTENTION.has(account.status) ? 'destructive' : 'secondary'
}

function useStatusLabel() {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    available: t('Available'),
    quota_budget_exceeded: t('Quota budget reached'),
    quota_observation_unavailable: t('No quota reading'),
    cooldown: t('Cooling down'),
    model_cooldown: t('Model cooling down'),
    reauthorization_required: t('Needs reauthorization'),
    suspended: t('Suspended'),
    disabled: t('Disabled'),
    blacklisted: t('Blacklisted'),
  }
  return (status: string) => labels[status] ?? status
}

/**
 * corecode-engine's account pool, live, for one provider at a time, Claude by
 * default: its groups and accounts as the engine's own capacity page shows
 * them, and its use on new-api and gpt-load. For Claude, whose dollar
 * capacity the engine estimates, two panels come first: the quota left over
 * the next 5 hours, 24 hours and 7 days, and whether it meets the demand a
 * forecast expects. Read-only; limits and budgets are still set in the engine.
 */
export function PoolTab(props: {
  data: EnginePool | undefined
  provider?: PoolProvider
  onProvider?: (provider: PoolProvider) => void
  usage?: PoolUsage
  usageError?: string
  /** The Claude pool's quota ahead; absent while it loads. */
  outlook?: EngineOutlook
  outlookError?: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const statusLabel = useStatusLabel()
  const [group, setGroup] = useState('all')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const pool = props.data

  if (pool && !pool.configured) {
    return (
      <Panel title={t('Account pool')}>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Set EngineControlURL and EngineControlKey to read the pool from corecode-engine.'
          )}
        </p>
      </Panel>
    )
  }
  if (pool?.error) {
    return (
      <Panel title={t('Account pool')}>
        <p className='text-destructive text-sm'>{pool.error}</p>
      </Panel>
    )
  }

  const provider = props.provider ?? 'claude'
  const claude = provider === 'claude'
  const providerGroups = (pool?.groups ?? []).filter(
    (row) => groupProvider(row) === provider
  )
  const groupIds = new Set(providerGroups.map((row) => row.id))
  const accounts = (pool?.accounts ?? []).filter((account) =>
    groupIds.has(account.group_id)
  )
  const accountCounts = new Map<string, number>()
  for (const row of pool?.groups ?? []) {
    const key = groupProvider(row)
    accountCounts.set(key, (accountCounts.get(key) ?? 0) + row.accounts)
  }
  const eligible = providerGroups.reduce((sum, row) => sum + row.eligible, 0)
  const slots = providerGroups.reduce((sum, row) => sum + row.slots, 0)
  const inFlight = providerGroups.reduce((sum, row) => sum + row.in_flight, 0)
  const attention = accounts.filter((account) => ATTENTION.has(account.status))
  const at = (ms: number) => (ms ? fmt.time(Math.floor(ms / 1000)) : '-')
  const groups = new Map((pool?.groups ?? []).map((row) => [row.id, row]))
  // The engine pauses an account at its group's budget, or at the default
  // budget when the group is not known here.
  const budgetOf = (row: EngineAccount, window: 'five' | 'seven') => {
    const owner = groups.get(row.group_id)
    if (owner) {
      if (!owner.quota_budget) return 0
      return window === 'five' ? owner.five_hour_budget : owner.seven_day_budget
    }
    return window === 'five'
      ? (pool?.five_hour_budget ?? 0)
      : (pool?.seven_day_budget ?? 0)
  }
  const emptyGroups = providerGroups.filter(
    (row) => row.enabled && row.accounts > 0 && row.eligible === 0
  )
  // A group picked under another provider is not one of these.
  const pickedGroup = groupIds.has(Number(group)) ? group : 'all'
  const shown = accounts.filter(
    (account) =>
      (pickedGroup === 'all' || String(account.group_id) === pickedGroup) &&
      (!attentionOnly || ATTENTION.has(account.status) || !account.eligible)
  )

  const summary: MetricItem[] = [
    {
      label: t('Schedulable accounts'),
      value: `${eligible} / ${accounts.length}`,
      hint: t('{{count}} groups', { count: providerGroups.length }),
      // Only Claude carries the site's volume; a smaller pool is expected
      // to be one or two accounts.
      tone: claude && eligible <= 2 ? 'danger' : 'default',
    },
    {
      label: t('Effective concurrency'),
      value: fmt.num(slots),
      hint: t('{{count}} per account', {
        count: pool?.credential_concurrency ?? 0,
      }),
    },
    {
      label: t('In flight'),
      value: fmt.num(inFlight),
      tone: slots > 0 && inFlight >= slots * 0.8 ? 'warning' : 'default',
    },
    {
      label: t('Needs attention'),
      value: fmt.num(attention.length),
      tone: attention.length > 0 ? 'danger' : 'default',
    },
  ]
  // Whether the pool runs short over the next 7 days, as the forecast panel
  // opens: under the smart forecast. A server before the outlook leaves the
  // engine's runway to say.
  const smart = props.outlook?.configured
    ? pickModel(props.outlook, 'smart')
    : undefined
  const short = smart
    ? smart.week_load >= 1 || (windowOf(smart.windows, 168)?.short_usd ?? 0) > 0
    : poolRunsShort(pool?.runway)

  return (
    <div className='grid gap-4'>
      <ProviderSwitch
        ariaLabel={t('Provider')}
        value={provider}
        onChange={props.onProvider}
        items={POOL_PROVIDERS.map((key) => ({
          key,
          label: PROVIDER_LABELS[key],
          count: accountCounts.get(key) ?? 0,
        }))}
      />

      <MetricGrid
        loading={!pool}
        items={summary}
        className='sm:grid-cols-4 lg:grid-cols-4'
      />

      {claude && (
        <PoolOutlook outlook={props.outlook} error={props.outlookError} />
      )}

      {/* Each account is held at its own recent rate there. A pool that runs
          short spends what one account would leave, so the list would
          contradict the forecast above. */}
      {claude && !short && (
        <UnusedQuotaPanel
          accounts={accounts}
          observedAt={pool?.observed_at_ms ?? 0}
          total={pool?.week_unused}
        />
      )}

      <PoolUsagePanel
        provider={provider}
        usage={props.usage?.provider === provider ? props.usage : undefined}
        error={props.usageError}
      />
      {!claude && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Dollar capacity is estimated for Claude only. Provider-reported quota percentages appear in the account table; whether the {{provider}} pool keeps up is not judged here.',
            { provider: PROVIDER_LABELS[provider] }
          )}
        </p>
      )}

      <Panel
        title={t('Groups')}
        description={
          emptyGroups.length
            ? t('No schedulable account in {{groups}}.', {
                groups: emptyGroups.map((row) => row.name).join(', '),
              })
            : undefined
        }
        help={t(
          'Slots are schedulable accounts times the per-account limit, capped by the group limit. Limits and quota budgets are set in corecode-engine. A budget shown as default is the pool default: 5h {{five}}% · 7d {{seven}}%.',
          {
            five: pool?.five_hour_budget ?? 0,
            seven: pool?.seven_day_budget ?? 0,
          }
        )}
      >
        <SimpleTable<EngineGroup>
          rows={providerGroups}
          rowKey={(row) => row.id}
          empty={t('No groups')}
          columns={[
            {
              key: 'name',
              label: t('Group'),
              render: (row) => (
                <span className='flex items-center gap-2'>
                  {row.name}
                  {!row.enabled && (
                    <Badge variant='outline'>{t('Disabled')}</Badge>
                  )}
                </span>
              ),
            },
            {
              key: 'accounts',
              label: t('Schedulable / accounts'),
              align: 'right',
              render: (row) => (
                <span
                  className={cn(
                    row.enabled && row.eligible === 0 && 'text-destructive'
                  )}
                >
                  {row.eligible} / {row.accounts}
                </span>
              ),
            },
            {
              key: 'in_flight',
              label: t('In flight / limit'),
              align: 'right',
              render: (row) => (
                <span className='ml-auto grid w-28 justify-items-end gap-1'>
                  {row.in_flight} / {row.effective_limit || t('Unlimited')}
                  {row.effective_limit > 0 && (
                    <Meter
                      value={(row.in_flight / row.effective_limit) * 100}
                      tone={loadTone(row.in_flight, row.effective_limit)}
                      label={t('In flight / limit')}
                    />
                  )}
                </span>
              ),
            },
            {
              key: 'slots',
              label: t('Slots'),
              align: 'right',
              render: (row) => row.slots,
            },
            {
              key: 'budget',
              label: t('Quota budget'),
              align: 'right',
              render: (row) => {
                if (!row.quota_budget) return t('Off')
                if (
                  row.five_hour_budget === pool?.five_hour_budget &&
                  row.seven_day_budget === pool?.seven_day_budget
                ) {
                  return (
                    <span className='text-muted-foreground'>
                      {t('Default')}
                    </span>
                  )
                }
                return `5h ${row.five_hour_budget}% · 7d ${row.seven_day_budget}%`
              },
            },
          ]}
        />
      </Panel>

      {pool && (
        <SubscriptionRenewalsPanel
          accounts={accounts}
          now={pool.observed_at_ms}
        />
      )}

      <Panel
        title={t('All accounts')}
        help={t(
          'Usage is each account’s own share of its window; remaining dollars come from the engine’s pool estimate. Refreshes every 15 seconds.'
        )}
        actions={
          <span className='text-muted-foreground shrink-0 text-xs'>
            {pool?.observed_at_ms
              ? t('Observed {{time}}', { time: at(pool.observed_at_ms) })
              : null}
          </span>
        }
      >
        <div className='mb-3 flex flex-wrap items-center gap-2'>
          <ToggleGroup
            variant='outline'
            size='sm'
            className='max-w-full overflow-x-auto'
            value={[pickedGroup]}
            onValueChange={(value: string[]) => setGroup(value.at(-1) ?? 'all')}
          >
            <ToggleGroupItem value='all'>{t('All groups')}</ToggleGroupItem>
            {providerGroups.map((row) => (
              <ToggleGroupItem key={row.id} value={String(row.id)}>
                {row.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            variant='outline'
            size='sm'
            value={attentionOnly ? ['attention'] : []}
            onValueChange={(value: string[]) =>
              setAttentionOnly(value.includes('attention'))
            }
          >
            <ToggleGroupItem value='attention'>
              {t('Not schedulable')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <SimpleTable<EngineAccount>
          rows={shown}
          rowKey={(row) => row.credential_id}
          empty={t('No accounts match')}
          columns={[
            {
              key: 'account',
              label: t('Pool account'),
              render: (row) => (
                <span className='grid'>
                  <span className='font-mono text-xs'>
                    #{row.credential_id} {row.email_mask}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {[row.group, row.plan, row.tier]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              ),
            },
            {
              key: 'status',
              label: t('Status'),
              render: (row) => (
                <span className='flex flex-col items-start gap-0.5'>
                  <Badge variant={statusVariant(row)}>
                    {statusLabel(row.status)}
                  </Badge>
                  {row.cooldown_until_ms > 0 && (
                    <span className='text-muted-foreground text-xs'>
                      {t('Until {{time}}', { time: at(row.cooldown_until_ms) })}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'active',
              label: t('In flight'),
              hint: t('Requests in flight / sessions pinned to the account'),
              align: 'right',
              render: (row) => `${row.active} / ${row.sessions}`,
            },
            ...(claude
              ? [
                  {
                    key: 'five',
                    label: t('5-hour'),
                    hint: t(
                      'The bar is the share of the window the account has used; the tick is its budget line, where the engine stops scheduling it.'
                    ),
                    align: 'right' as const,
                    render: (row: EngineAccount) => (
                      <WindowCell
                        title={t('5-hour window')}
                        used={row.five_hour}
                        budget={budgetOf(row, 'five')}
                        remaining={row.five_hour_remaining_usd}
                        reset={at(row.five_hour_reset_ms)}
                      />
                    ),
                  },
                  {
                    key: 'seven',
                    label: t('7-day'),
                    hint: t(
                      'The bar is the share of the window the account has used; the tick is its budget line, where the engine stops scheduling it.'
                    ),
                    align: 'right' as const,
                    render: (row: EngineAccount) => (
                      <WindowCell
                        title={t('7-day window')}
                        used={row.seven_day}
                        budget={budgetOf(row, 'seven')}
                        remaining={row.seven_day_remaining_usd}
                        reset={at(row.seven_day_reset_ms)}
                      />
                    ),
                  },
                ]
              : [
                  {
                    key: 'quota',
                    label: t('Remaining quota'),
                    render: (row: EngineAccount) => (
                      <div className='grid gap-3'>
                        {row.quota_windows?.length ? (
                          row.quota_windows.map((window) => {
                            const title = [
                              window.scope === 'account' ? '' : window.scope,
                              window.label || window.id,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                            return (
                              <div
                                key={`${window.id}-${window.scope}`}
                                className='grid gap-1'
                              >
                                <span className='text-xs font-medium'>
                                  {title}
                                </span>
                                <WindowCell
                                  title={title}
                                  used={
                                    window.utilization == null
                                      ? null
                                      : window.utilization * 100
                                  }
                                  budget={0}
                                  remaining={null}
                                  showRemainingPercent
                                  reset={at(window.reset_at_ms ?? 0)}
                                />
                                {window.observed_at_ms != null && (
                                  <span className='text-muted-foreground text-xs'>
                                    {t('Observed {{time}}', {
                                      time: at(window.observed_at_ms),
                                    })}
                                  </span>
                                )}
                              </div>
                            )
                          })
                        ) : (
                          <span className='text-muted-foreground text-xs'>
                            {t('No quota reading')}
                          </span>
                        )}
                      </div>
                    ),
                  },
                ]),
            ...(accounts.some((account) => account.reset_credits?.length)
              ? [
                  {
                    key: 'reset',
                    label: t('Reset credits'),
                    hint: t(
                      'Quota reset credits the account holds. A full reset clears the 5-hour and weekly limits; a partial reset clears the 5-hour and a model weekly limit only.'
                    ),
                    align: 'right' as const,
                    render: (row: EngineAccount) => (
                      <ResetCreditsCell row={row} at={at} />
                    ),
                  },
                ]
              : []),
            {
              key: 'burn',
              label: t('Spend / hour'),
              hint: t('Logged spend over the last 24 hours, per hour'),
              align: 'right',
              render: (row) =>
                row.burn_usd_per_hour == null
                  ? '-'
                  : fmt.usd(row.burn_usd_per_hour),
            },
            {
              key: 'activity',
              label: t('Last 24 hours'),
              align: 'right',
              render: (row) => <ActivityCell row={row} at={at} />,
            },
          ]}
        />
      </Panel>
    </div>
  )
}

/**
 * The Claude pool's quota ahead: what it can spend in each window, then
 * whether that meets demand. Old figures stay up through a failed refresh;
 * without any, the failure is said where the panels would be, which is also
 * what a server before the outlook shows.
 */
function PoolOutlook(props: {
  outlook: EngineOutlook | undefined
  error: string | undefined
}) {
  const { t } = useTranslation()
  const outlook = props.outlook
  if (!outlook) {
    return (
      <Panel title={t('Quota left')}>
        {props.error ? (
          <p className='text-destructive text-sm'>
            {t('The pool’s quota ahead could not be read: {{error}}', {
              error: props.error,
            })}
          </p>
        ) : (
          <div
            aria-busy
            aria-label={t('Loading')}
            className='grid gap-3 sm:grid-cols-3'
          >
            <Skeleton className='h-28' />
            <Skeleton className='h-28' />
            <Skeleton className='h-28' />
          </div>
        )}
      </Panel>
    )
  }
  // The pool tab says so itself when the engine is not configured.
  if (!outlook.configured) return null
  if (outlook.error) {
    return (
      <Panel title={t('Quota left')}>
        <p className='text-destructive text-sm'>
          {t('The pool’s quota ahead could not be read: {{error}}', {
            error: outlook.error,
          })}
        </p>
      </Panel>
    )
  }
  return (
    <>
      <RemainingPanel outlook={outlook} />
      <ForecastPanel outlook={outlook} />
    </>
  )
}

function loadTone(inFlight: number, limit: number): Tone {
  if (inFlight >= limit) return 'danger'
  if (inFlight >= limit * 0.8) return 'warning'
  return 'default'
}

function usageTone(used: number, budget: number): Tone {
  if (budget > 0 && used >= budget) return 'danger'
  if (budget > 0 && used >= budget - 10) return 'warning'
  return 'default'
}

const TEXT_TONES: Record<Tone, string> = {
  default: '',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive font-medium',
  good: '',
}

function WindowCell(props: {
  title: string
  used: number | null
  budget: number
  remaining: number | null
  showRemainingPercent?: boolean
  reset: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  if (props.used == null) {
    return (
      <span className='text-muted-foreground grid gap-1 text-xs'>
        <span>{t('No quota reading')}</span>
        {props.reset !== '-' && (
          <span>{t('Resets {{time}}', { time: props.reset })}</span>
        )}
      </span>
    )
  }
  const tone = usageTone(props.used, props.budget)
  const used = `${Math.round(props.used)}%`
  return (
    <TapTooltip>
      <TapTooltipTrigger
        render={
          <span
            tabIndex={0}
            className='focus-visible:ring-ring/50 ml-auto grid w-40 cursor-default justify-items-end gap-1 rounded-sm outline-none focus-visible:ring-2'
          />
        }
      >
        <span className={TEXT_TONES[tone]}>
          {props.showRemainingPercent
            ? t('{{amount}} left', {
                amount: fmt.pct(Math.max(0, 1 - props.used / 100)),
              })
            : used}
          {props.remaining != null && (
            <span className='text-muted-foreground font-normal'>
              {' · '}
              {t('{{amount}} left', { amount: fmt.usdWhole(props.remaining) })}
            </span>
          )}
        </span>
        <Meter
          value={props.used}
          marker={props.budget}
          tone={tone}
          label={`${props.title} ${used}`}
        />
        <span className='text-muted-foreground text-xs'>
          {t('Resets {{time}}', { time: props.reset })}
        </span>
      </TapTooltipTrigger>
      <TooltipContent className='block min-w-52 py-2'>
        <p className='mb-1.5 font-semibold'>{props.title}</p>
        <dl className='grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums'>
          <dt className='opacity-80'>{t('Used')}</dt>
          <dd className='text-right'>{used}</dd>
          <dt className='opacity-80'>{t('Budget line')}</dt>
          <dd className='text-right'>
            {props.budget > 0 ? `${props.budget}%` : t('Off')}
          </dd>
          {props.remaining != null && (
            <>
              <dt className='opacity-80'>{t('Left before the line')}</dt>
              <dd className='text-right'>≈ {fmt.usd(props.remaining)}</dd>
            </>
          )}
          <dt className='opacity-80'>{t('Resets')}</dt>
          <dd className='text-right'>{props.reset}</dd>
        </dl>
      </TooltipContent>
    </TapTooltip>
  )
}

function ActivityCell(props: {
  row: EngineAccount
  at: (ms: number) => string
}) {
  const { t } = useTranslation()
  const { row } = props
  const counts = t('{{success}} ok · {{failure}} failed', {
    success: row.successes,
    failure: row.failures,
  })
  return (
    <TapTooltip>
      <TapTooltipTrigger
        render={
          <span
            tabIndex={0}
            className={cn(
              'cursor-help text-xs outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50',
              row.last_failure &&
                'underline decoration-dotted underline-offset-4'
            )}
          />
        }
      >
        {counts}
      </TapTooltipTrigger>
      <TooltipContent className='block max-w-sm py-2'>
        <p>
          {row.last_used_at_ms
            ? t('Last used {{time}}', { time: props.at(row.last_used_at_ms) })
            : t('No use recorded')}
        </p>
        {row.last_failure && (
          <p className='mt-1 break-words opacity-80'>
            {t('Last failure {{time}}: {{reason}}', {
              time: props.at(row.last_failure_at_ms),
              reason: row.last_failure,
            })}
          </p>
        )}
      </TooltipContent>
    </TapTooltip>
  )
}
