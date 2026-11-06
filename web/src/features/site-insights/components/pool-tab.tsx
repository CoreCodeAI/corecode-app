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
import { useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { Badge } from '@/components/ui/badge'
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
  type EngineHorizon,
  type EnginePool,
  type EngineRunway,
  type PoolProvider,
  type PoolUsage,
} from '../types'
import { CapacityVerdict, PoolUsagePanel } from './pool-usage'
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
 * corecode-engine's account pool, live: every group and account the engine's
 * own capacity page shows, read from its control API. Read-only; limits and
 * budgets are still set in the engine.
 */
/**
 * The engine's pool for one provider at a time, Claude by default: its
 * accounts and groups, its use on new-api and gpt-load, and for Claude,
 * whose dollar capacity the engine estimates, whether the pool keeps up.
 */
export function PoolTab(props: {
  data: EnginePool | undefined
  provider?: PoolProvider
  onProvider?: (provider: PoolProvider) => void
  usage?: PoolUsage
  usageError?: string
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
  const five = pool?.five_hour_estimate
  const week = pool?.week_estimate
  const usd = (value: number) => fmt.usdWhole(value)
  const at = (ms: number) => (ms ? fmt.time(Math.floor(ms / 1000)) : '-')
  const share = (horizon: EngineHorizon) =>
    horizon.capacity_usd ? horizon.remaining_usd / horizon.capacity_usd : 0
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
  // The engine estimates dollar capacity for Claude subscription accounts only.
  if (claude) {
    summary.push(
      {
        label: t('5-hour left'),
        value: five ? `≈ ${usd(five.remaining_usd)}` : '-',
        help: t(
          'Dollars schedulable accounts can still spend before their 5-hour budget line, estimated from their usage and calibrated capacity.'
        ),
        meter: five
          ? {
              value: share(five),
              tone: remainingTone(share(five)),
              label: t('5-hour left'),
            }
          : undefined,
        hint: five
          ? t('{{share}} of {{capacity}}', {
              share: fmt.pct(share(five)),
              capacity: usd(five.capacity_usd),
            })
          : pool?.estimate_error,
      },
      {
        label: t('7-day left'),
        value: week ? `≈ ${usd(week.remaining_usd)}` : '-',
        help: t(
          'Dollars schedulable accounts can still spend before their 7-day budget line, estimated from their usage and calibrated capacity.'
        ),
        meter: week
          ? {
              value: share(week),
              tone: remainingTone(share(week)),
              label: t('7-day left'),
            }
          : undefined,
        hint: week
          ? t('{{share}} of {{capacity}}', {
              share: fmt.pct(share(week)),
              capacity: usd(week.capacity_usd),
            })
          : undefined,
      }
    )
    // Only an engine with the projection sends it; the tile is skipped without it.
    if (pool?.week_unused) {
      const unused = pool.week_unused.usd
      // A pool projected to run short will use it: the figure holds each
      // account at its own recent rate, and the others hit their lines first.
      const short = poolRunsShort(pool.runway)
      summary.push({
        label: t('Unused at reset'),
        value: `≈ ${usd(unused)}`,
        help: t(
          'Weekly quota the pool will not spend before the resets, at the last 24 hours’ spend rates.'
        ),
        hint: short
          ? t('Most of this will be used: the pool is projected to run short.')
          : undefined,
        tone:
          !short && week && unused >= week.capacity_usd * 0.05
            ? 'warning'
            : 'default',
      })
    }
  }

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

      <MetricGrid loading={!pool} items={summary} />

      {claude && pool?.runway?.sustainable_usd_per_hour != null && (
        <CapacityVerdict
          runway={pool.runway}
          five={pool.five_hour_estimate}
          usage={props.usage}
        />
      )}

      {claude && (
        <UnusedQuotaPanel
          accounts={accounts}
          observedAt={pool?.observed_at_ms ?? 0}
          total={pool?.week_unused}
          runway={pool?.runway}
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

      {/* A server before the supply figures sends a runway without them. */}
      {claude && pool?.runway?.sustainable_usd_per_hour != null && (
        <RunwayPanel runway={pool.runway} observedAt={pool.observed_at_ms} />
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
 * The Claude accounts' quota supply against their recent demand: whether the
 * weekly resets keep up, and over the next week whether the remainder covers
 * the difference, where it is tightest, and how high a burst can go.
 */
function RunwayPanel(props: { runway: EngineRunway; observedAt: number }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const { runway } = props
  const burn = runway.burn_usd_per_hour
  const duration = (hours: number) => {
    if (hours < 1) {
      return t('{{minutes}} minutes', { minutes: Math.round(hours * 60) })
    }
    if (hours < 48) {
      return t('{{hours}} hours', { hours: hours.toFixed(1) })
    }
    return t('{{days}} days', { days: (hours / 24).toFixed(1) })
  }
  const at = (hours: number) =>
    fmt.time(Math.floor((props.observedAt + hours * 3_600_000) / 1000))
  const gapStart = runway.week_hours
  const gapLength = runway.first_short_hours
  const lowestCovers = burn > 0 ? runway.lowest_usd / burn : null

  if (burn <= 0) {
    return (
      <Panel title={t('Claude pool supply')}>
        <p className='text-muted-foreground text-sm'>
          {t('No Claude spend logged in the last 24 hours.')}
        </p>
      </Panel>
    )
  }

  const supply =
    runway.week_load >= 1
      ? t(
          'Demand of {{demand}}/h is above the {{supply}}/h the weekly resets bring back; closing the gap takes about {{capacity}} more weekly capacity.',
          {
            demand: fmt.usd(burn),
            supply: fmt.usd(runway.sustainable_usd_per_hour),
            capacity: fmt.usdWhole(
              (burn - runway.sustainable_usd_per_hour) * 168
            ),
          }
        )
      : t(
          'Demand of {{demand}}/h is below the {{supply}}/h the weekly resets bring back.',
          {
            demand: fmt.usd(burn),
            supply: fmt.usd(runway.sustainable_usd_per_hour),
          }
        )
  let week = t(
    'Over the next 7 days the quota is tightest around {{time}}, with {{amount}} left.',
    { time: at(runway.lowest_hours), amount: fmt.usdWhole(runway.lowest_usd) }
  )
  if (gapStart != null && gapLength != null) {
    // One gap reads once; its length and the total are the same figure.
    week =
      runway.short_hours - gapLength < 0.05
        ? t(
            'Over the next 7 days the quota runs out around {{time}} for {{length}}.',
            { time: at(gapStart), length: duration(gapLength) }
          )
        : t(
            'Over the next 7 days the quota first runs out around {{time}} for {{length}}; {{total}} without quota in all.',
            {
              time: at(gapStart),
              length: duration(gapLength),
              total: duration(runway.short_hours),
            }
          )
  }

  // How the week changes if use keeps growing as it has.
  const growth = runway.growth_per_day ?? 0
  const trendStart = runway.trend?.week_hours
  let trend: string | null = null
  if (runway.trend && growth >= 0.01) {
    if (trendStart == null) {
      trend = t('Growing {{rate}} a day, it still lasts the 7 days.', {
        rate: fmt.pct(growth),
      })
    } else if (gapStart == null || trendStart < gapStart - 1) {
      trend = t(
        'If use keeps growing {{rate}} a day, it runs out around {{time}}.',
        { rate: fmt.pct(growth), time: at(trendStart) }
      )
    }
  }
  const headroom = runway.headroom_scale
  const signedPct = (value: number) =>
    `${value >= 0 ? '+' : '−'}${fmt.pct(Math.abs(value))}`
  const peakHour = runway.peak_hour_usd_per_hour
  let peakHint: string | undefined
  if (runway.peak_usd_per_hour && peakHour) {
    peakHint = t('Busiest hour {{amount}}/h · {{share}}', {
      amount: fmt.usdWhole(peakHour),
      share: fmt.pct(peakHour / runway.peak_usd_per_hour),
    })
  } else if (runway.peak_usd_per_hour) {
    peakHint = t('{{multiple}} the demand', {
      multiple: fmt.multiple(runway.peak_usd_per_hour / burn),
    })
  }

  let lowestTone: Tone = 'default'
  if (gapStart != null) {
    lowestTone = 'danger'
  } else if (lowestCovers != null && lowestCovers < 3) {
    lowestTone = 'warning'
  }

  return (
    <Panel
      title={t('Claude pool supply')}
      description={[supply, week, trend].filter(Boolean).join(' ')}
      help={t(
        'Demand is every Claude account’s spend per hour at its current level, read from the last four days with each hour counting half as much as the one 12 hours later, moved through the day by the last week’s hourly use. Supply is each counted account’s weekly capacity up to its budget line, refilled at its weekly reset; quota left at a reset is lost. Turned-away requests are not in the demand.'
      )}
    >
      <MetricGrid
        items={[
          {
            label: t('Weekly load'),
            help: t(
              'Demand over what weekly resets bring back. Above 100% the pool spends its remainder.'
            ),
            value: fmt.pct(runway.week_load),
            tone: loadShareTone(runway.week_load),
            meter: {
              value: Math.min(runway.week_load, 1),
              tone: loadShareTone(runway.week_load),
              label: t('Weekly load'),
            },
            hint: t('{{demand}}/h of {{supply}}/h', {
              demand: fmt.usd(burn),
              supply: fmt.usd(runway.sustainable_usd_per_hour),
            }),
          },
          {
            label: t('Without quota, 7 days'),
            help: t(
              'Hours in the next 7 days with no weekly quota left on any counted account.'
            ),
            value:
              runway.short_hours > 0
                ? ['≈', duration(runway.short_hours)].join(' ')
                : t('None'),
            tone: runway.short_hours > 0 ? 'danger' : 'default',
            hint:
              gapStart != null
                ? t('From {{time}} · {{share}} of demand served', {
                    time: at(gapStart),
                    share: fmt.pct(runway.served_share),
                  })
                : t('{{amount}} left now', {
                    amount: fmt.usdWhole(runway.week_remaining_usd),
                  }),
          },
          {
            label: t('Tightest point'),
            help: t(
              'The least weekly quota left in the next 7 days. A small figure means the pool nearly runs dry before a reset.'
            ),
            value: fmt.usdWhole(runway.lowest_usd),
            tone: lowestTone,
            hint:
              lowestCovers != null && runway.lowest_usd > 0
                ? t('{{time}} · {{length}} of demand', {
                    time: at(runway.lowest_hours),
                    length: duration(lowestCovers),
                  })
                : at(runway.lowest_hours),
          },
          {
            label: t('Demand headroom'),
            help: t(
              'How far demand can move before the next 7 days run short: the most the pool serves without a gap, against demand now.'
            ),
            value:
              headroom == null
                ? t('Over {{multiple}}', { multiple: fmt.multiple(4) })
                : signedPct(headroom - 1),
            tone: headroomTone(headroom),
            hint:
              headroom == null
                ? undefined
                : t(
                    headroom < 1
                      ? 'Lasts 7 days at {{amount}}/h or less'
                      : 'Runs short above {{amount}}/h',
                    { amount: fmt.usd(burn * headroom) }
                  ),
          },
          {
            label: t('Peak throughput'),
            help: t(
              '5-hour capacity up to the budget line, per hour: the most a burst can draw.'
            ),
            value: runway.peak_usd_per_hour
              ? t('{{amount}}/h', {
                  amount: fmt.usdWhole(runway.peak_usd_per_hour),
                })
              : '-',
            tone:
              peakHour && runway.peak_usd_per_hour
                ? loadShareTone(peakHour / runway.peak_usd_per_hour)
                : 'default',
            hint: peakHint,
          },
          {
            label: t('Demand per hour'),
            help: t(
              'Spend per hour at its current level, used for the projection: the last four days, each hour counting half as much as the one 12 hours later. Week to date is use since each account’s weekly reset; close figures mean demand was steady.'
            ),
            value: fmt.usd(burn),
            hint: runway.trend
              ? t('Week to date {{amount}}/h · {{growth}} a day', {
                  amount: fmt.usd(runway.week_to_date_usd_per_hour),
                  growth: signedPct(growth),
                })
              : t('Week to date {{amount}}/h · {{counted}} accounts', {
                  amount: fmt.usd(runway.week_to_date_usd_per_hour),
                  counted: runway.counted,
                }),
          },
        ]}
      />
      {runway.curve && runway.curve.length > 1 && (
        <RunwayCurve
          curve={runway.curve}
          trend={runway.trend?.curve}
          low={runway.low?.curve}
          high={runway.high?.curve}
          shaped={(runway.profile_hours ?? 0) > 0}
          observedAt={props.observedAt}
        />
      )}
      {runway.unknown > 0 && (
        <p className='text-muted-foreground mt-2 text-xs'>
          {t('{{count}} accounts without an estimate are not counted.', {
            count: runway.unknown,
          })}
        </p>
      )}
    </Panel>
  )
}

const HOUR_MS = 3_600_000

/**
 * The projected weekly quota left, hour by hour over the next 7 days, with
 * a tick at each midnight. The line is the base projection; a band spans the
 * 10th to 90th percentile demand and a dashed line follows growing use, when
 * the server sends them. Hours the base projection has nothing left are
 * shaded. Hovering, or focusing and pressing the arrow keys, reads out the
 * hour under the pointer.
 */
function RunwayCurve(props: {
  curve: number[]
  trend?: number[] | null
  low?: number[] | null
  high?: number[] | null
  shaped: boolean
  observedAt: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [active, setActive] = useState<number | null>(null)
  const { curve, observedAt } = props
  const last = curve.length - 1
  const matches = (series?: number[] | null) =>
    series && series.length === curve.length ? series : null
  const trend = matches(props.trend)
  // Low demand leaves the most quota: the band's top edge.
  const upper = matches(props.low)
  const lower = matches(props.high)
  const band = upper && lower ? { upper, lower } : null
  const top = niceTop(
    Math.max(...curve, ...(trend ?? []), ...(band?.upper ?? []))
  )
  const xOf = (hours: number) => (hours / last) * 100
  const yOf = (usd: number) => 100 - (usd / top) * 100
  const at = (hours: number) =>
    fmt.time(Math.floor((observedAt + hours * HOUR_MS) / 1000))
  const line = (series: number[]) =>
    series
      .map(
        (usd, hour) =>
          `${hour === 0 ? 'M' : 'L'}${xOf(hour).toFixed(2)},${yOf(usd).toFixed(2)}`
      )
      .join(' ')
  const path = line(curve)
  const bandPath = band
    ? `${line(band.upper)} ${band.lower
        .map((usd, hour) => `L${xOf(hour).toFixed(2)},${yOf(usd).toFixed(2)}`)
        .reverse()
        .join(' ')} Z`
    : null

  // Runs of hours with nothing left, each widened by half an hour a side:
  // a gap starts and ends between two samples.
  const gaps: { from: number; to: number }[] = []
  curve.forEach((usd, hour) => {
    if (usd > 0) return
    const previous = gaps.at(-1)
    if (previous && previous.to === hour - 1) {
      previous.to = hour
    } else {
      gaps.push({ from: hour, to: hour })
    }
  })

  // Each local midnight in the range, labelled with the day it starts.
  const days: { hours: number; label: string }[] = []
  const midnight = new Date(observedAt)
  midnight.setHours(24, 0, 0, 0)
  while (midnight.getTime() < observedAt + last * HOUR_MS) {
    days.push({
      hours: (midnight.getTime() - observedAt) / HOUR_MS,
      label: fmt.day(midnight.getTime() / 1000),
    })
    midnight.setDate(midnight.getDate() + 1)
  }

  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const share = (event.clientX - box.left) / Math.max(box.width, 1)
    return Math.min(last, Math.max(0, Math.round(share * last)))
  }
  const lowest = curve.indexOf(Math.min(...curve))
  const point = active === null ? null : curve[active]
  const x = active === null ? 0 : xOf(active)
  const amount = (usd: number) =>
    usd > 0 ? fmt.usdWhole(usd) : t('No quota left')

  return (
    <figure className='mt-4'>
      <figcaption className='mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs'>
        <span className='text-muted-foreground'>
          {props.shaped
            ? t('Weekly quota left, next 7 days, at each hour’s usual use')
            : t('Weekly quota left, next 7 days')}
        </span>
        <span className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1'>
          {(trend || band) && (
            <span className='flex items-center gap-1.5'>
              <span aria-hidden className='bg-primary h-0.5 w-3 rounded-full' />
              {t('Demand as now')}
            </span>
          )}
          {trend && (
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden
                className='border-foreground/60 w-3 border-t-2 border-dashed'
              />
              {t('Growing as this week')}
            </span>
          )}
          {band && (
            <span className='flex items-center gap-1.5'>
              <span aria-hidden className='bg-primary/20 size-2.5 rounded-sm' />
              {t('Usual range')}
            </span>
          )}
          {gaps.length > 0 && (
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden
                className='bg-destructive/20 size-2.5 rounded-sm'
              />
              {t('No quota left')}
            </span>
          )}
        </span>
      </figcaption>
      <div className='flex gap-2'>
        <div
          aria-hidden
          className='text-muted-foreground flex h-28 flex-col justify-between text-right text-[10px] leading-none tabular-nums'
        >
          <span>{fmt.usdCompact(top)}</span>
          <span>{fmt.usdCompact(top / 2)}</span>
          <span>{fmt.usdCompact(0)}</span>
        </div>
        <div className='min-w-0 flex-1'>
          <div
            tabIndex={0}
            role='img'
            aria-label={t(
              'Weekly quota left over the next 7 days: {{now}} now, least {{lowest}} around {{time}}',
              {
                now: fmt.usdWhole(curve[0]),
                lowest: fmt.usdWhole(curve[lowest]),
                time: at(lowest),
              }
            )}
            className='focus-visible:ring-ring/50 relative h-28 cursor-crosshair touch-pan-y rounded-sm outline-none focus-visible:ring-2'
            onPointerDown={(event) => setActive(nearest(event))}
            onPointerMove={(event) => setActive(nearest(event))}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'touch') setActive(null)
            }}
            onFocus={() => setActive((current) => current ?? 0)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                setActive((current) => Math.max(0, (current ?? 0) - 1))
              } else if (event.key === 'ArrowRight') {
                event.preventDefault()
                setActive((current) => Math.min(last, (current ?? 0) + 1))
              }
            }}
          >
            <svg
              aria-hidden
              viewBox='0 0 100 100'
              preserveAspectRatio='none'
              className='text-primary block size-full overflow-visible'
            >
              {[0, 50, 100].map((y) => (
                <line
                  key={y}
                  x1={0}
                  x2={100}
                  y1={y}
                  y2={y}
                  className='stroke-border'
                  vectorEffect='non-scaling-stroke'
                />
              ))}
              {days.map((day) => (
                <line
                  key={day.hours}
                  x1={xOf(day.hours)}
                  x2={xOf(day.hours)}
                  y1={0}
                  y2={100}
                  className='stroke-border'
                  strokeDasharray='2 3'
                  vectorEffect='non-scaling-stroke'
                />
              ))}
              {gaps.map((gap) => {
                const from = xOf(Math.max(0, gap.from - 0.5))
                const to = xOf(Math.min(last, gap.to + 0.5))
                return (
                  <rect
                    key={gap.from}
                    x={from}
                    width={to - from}
                    y={0}
                    height={100}
                    className='fill-destructive/20'
                  />
                )
              })}
              {bandPath ? (
                <path d={bandPath} className='fill-current opacity-20' />
              ) : (
                <path
                  d={`${path} L100,100 L0,100 Z`}
                  className='fill-current opacity-10'
                />
              )}
              {trend && (
                <path
                  d={line(trend)}
                  fill='none'
                  className='stroke-foreground/60'
                  strokeWidth={1.5}
                  strokeDasharray='4 3'
                  vectorEffect='non-scaling-stroke'
                  strokeLinejoin='round'
                />
              )}
              <path
                d={path}
                fill='none'
                stroke='currentColor'
                strokeWidth={2}
                vectorEffect='non-scaling-stroke'
                strokeLinejoin='round'
              />
            </svg>
            {active !== null && point !== null && (
              <>
                <span
                  aria-hidden
                  className='border-foreground/30 pointer-events-none absolute inset-y-0 border-l border-dashed'
                  style={{ left: `${x}%` }}
                />
                <span
                  aria-hidden
                  className='bg-primary ring-background pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2'
                  style={{ left: `${x}%`, top: `${yOf(point)}%` }}
                />
                <span
                  role='status'
                  className={cn(
                    'bg-popover text-popover-foreground pointer-events-none absolute bottom-full mb-1 flex flex-col rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-sm',
                    x < 20 && 'translate-x-0',
                    x >= 20 && x <= 80 && '-translate-x-1/2',
                    x > 80 && '-translate-x-full'
                  )}
                  style={{ left: `${x}%` }}
                >
                  <span>
                    <span className='text-muted-foreground'>{at(active)}</span>{' '}
                    <span
                      className={cn(
                        'font-medium tabular-nums',
                        point <= 0 && 'text-destructive'
                      )}
                    >
                      {amount(point)}
                    </span>
                  </span>
                  {band && (
                    <span className='text-muted-foreground tabular-nums'>
                      {t('Usual range {{low}} – {{high}}', {
                        low: fmt.usdWhole(band.lower[active]),
                        high: fmt.usdWhole(band.upper[active]),
                      })}
                    </span>
                  )}
                  {trend && (
                    <span className='text-muted-foreground tabular-nums'>
                      {t('Growing: {{amount}}', {
                        amount: amount(trend[active]),
                      })}
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
          <div
            aria-hidden
            className='text-muted-foreground relative mt-1 h-3 text-[10px] leading-none'
          >
            {days
              .filter((day) => day.hours < last - 6)
              .map((day) => (
                <span
                  key={day.hours}
                  className='absolute'
                  style={{ left: `${xOf(day.hours)}%` }}
                >
                  {day.label}
                </span>
              ))}
          </div>
        </div>
      </div>
    </figure>
  )
}

// The axis top: the least 1, 2, 2.5 or 5 step at or above the highest value.
function niceTop(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= value) ?? 10
  return step * magnitude
}

function headroomTone(scale: number | null | undefined): Tone {
  if (scale == null) return 'default'
  if (scale < 1) return 'danger'
  if (scale < 1.2) return 'warning'
  return 'default'
}

function loadShareTone(load: number): Tone {
  if (load >= 1) return 'danger'
  if (load >= 0.8) return 'warning'
  return 'default'
}

// Remaining shares below these read as running low.
function remainingTone(share: number): Tone {
  if (share < 0.1) return 'danger'
  if (share < 0.25) return 'warning'
  return 'default'
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
