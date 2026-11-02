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

import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { ATTENTION, useInsightsFormat } from '../lib'
import type {
  EngineAccount,
  EngineGroup,
  EngineHorizon,
  EnginePool,
  EngineRunway,
} from '../types'
import { MetricGrid, Meter, Panel, SimpleTable, type Tone } from './shared'

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
export function PoolTab(props: { data: EnginePool | undefined }) {
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

  const accounts = pool?.accounts ?? []
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
  const emptyGroups = (pool?.groups ?? []).filter(
    (row) => row.enabled && row.accounts > 0 && row.eligible === 0
  )
  const shown = accounts.filter(
    (account) =>
      (group === 'all' || String(account.group_id) === group) &&
      (!attentionOnly || ATTENTION.has(account.status) || !account.eligible)
  )

  return (
    <div className='grid gap-4'>
      <MetricGrid
        loading={!pool}
        items={[
          {
            label: t('Schedulable accounts'),
            value: `${pool?.eligible_accounts ?? 0} / ${accounts.length}`,
            hint: t('{{count}} groups', { count: pool?.groups.length ?? 0 }),
            tone: (pool?.eligible_accounts ?? 0) <= 2 ? 'danger' : 'default',
          },
          {
            label: t('Effective concurrency'),
            value: fmt.num(pool?.effective_slots ?? 0),
            hint: t('{{count}} per account', {
              count: pool?.credential_concurrency ?? 0,
            }),
          },
          {
            label: t('In flight'),
            value: fmt.num(pool?.in_flight ?? 0),
            tone:
              pool &&
              pool.effective_slots > 0 &&
              pool.in_flight >= pool.effective_slots * 0.8
                ? 'warning'
                : 'default',
          },
          {
            label: t('Needs attention'),
            value: fmt.num(attention.length),
            tone: attention.length > 0 ? 'danger' : 'default',
          },
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
          },
        ]}
      />

      {pool?.runway && (
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
          rows={pool?.groups}
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
            value={[group]}
            onValueChange={(value: string[]) => setGroup(value.at(-1) ?? 'all')}
          >
            <ToggleGroupItem value='all'>{t('All groups')}</ToggleGroupItem>
            {(pool?.groups ?? []).map((row) => (
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
            {
              key: 'five',
              label: t('5-hour'),
              hint: t(
                'The bar is the share of the window the account has used; the tick is its budget line, where the engine stops scheduling it.'
              ),
              align: 'right',
              render: (row) => (
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
              align: 'right',
              render: (row) => (
                <WindowCell
                  title={t('7-day window')}
                  used={row.seven_day}
                  budget={budgetOf(row, 'seven')}
                  remaining={row.seven_day_remaining_usd}
                  reset={at(row.seven_day_reset_ms)}
                />
              ),
            },
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
 * How long the Claude accounts last at the last 24 hours' spend: the weekly
 * quota, with each account refilling at its own weekly reset, and the 5-hour
 * quota left now.
 */
function RunwayPanel(props: { runway: EngineRunway; observedAt: number }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const { runway } = props
  const spending = runway.burn_usd_per_hour > 0
  const duration = (hours: number) =>
    hours < 48
      ? t('{{hours}} hours', { hours: hours.toFixed(1) })
      : t('{{days}} days', { days: (hours / 24).toFixed(1) })
  const dryAt = (hours: number) =>
    fmt.time(Math.floor((props.observedAt + hours * 3_600_000) / 1000))
  const week = runway.week_hours
  const five = runway.five_hour_hours
  let weekValue = '-'
  if (spending) {
    weekValue =
      week == null
        ? `> ${duration(runway.horizon_hours)}`
        : `≈ ${duration(week)}`
  }
  let description = t('No Claude spend logged in the last 24 hours.')
  if (spending && week != null) {
    description = t(
      'At the last 24 hours’ spend, the weekly quota runs out around {{time}}.',
      { time: dryAt(week) }
    )
  } else if (spending) {
    description = t(
      'At the last 24 hours’ spend, weekly resets keep up with demand for at least {{duration}}.',
      { duration: duration(runway.horizon_hours) }
    )
  }
  return (
    <Panel
      title={t('Claude pool runway')}
      description={description}
      help={t(
        'Demand is every Claude account’s logged spend over the last 24 hours, per hour. The projection spreads it over the counted accounts in proportion to what each has left, and refills each account to its 7-day budget line at its weekly reset; what an account has left at its reset is lost. Accounts without a weekly estimate are not counted. Spend that was turned away is not in the demand, so a saturated pool lasts less than shown.'
      )}
    >
      <MetricGrid
        items={[
          {
            label: t('7-day quota lasts'),
            value: weekValue,
            tone: runwayTone(spending ? week : null),
            hint:
              spending && week != null
                ? t('Runs out {{time}}', { time: dryAt(week) })
                : t('{{amount}} left', {
                    amount: fmt.usdWhole(runway.week_remaining_usd),
                  }),
          },
          {
            label: t('Weekly load'),
            help: t(
              'A week of demand over a week of the counted accounts’ capacity up to their budget lines. Under 100% the pool refills faster than it is spent.'
            ),
            value: fmt.pct(runway.week_load),
            tone: loadShareTone(runway.week_load),
            meter: {
              value: Math.min(runway.week_load, 1),
              tone: loadShareTone(runway.week_load),
              label: t('Weekly load'),
            },
            hint: t('{{demand}} of {{capacity}} a week', {
              demand: fmt.usdWhole(runway.burn_usd_per_hour * 168),
              capacity: fmt.usdWhole(runway.week_capacity_usd),
            }),
          },
          {
            label: t('5-hour quota lasts'),
            help: t(
              'The counted accounts’ 5-hour remainder at the 24-hour average spend. Daytime peaks spend faster, and each 5-hour window refills at its own reset.'
            ),
            value: five == null ? '-' : `≈ ${duration(five)}`,
            tone: five != null && five < 1 ? 'warning' : 'default',
            hint: t('{{amount}} left', {
              amount: fmt.usdWhole(runway.five_hour_remaining_usd),
            }),
          },
          {
            label: t('Demand per hour'),
            value: fmt.usd(runway.burn_usd_per_hour),
            hint: runway.unknown
              ? t(
                  '{{counted}} accounts counted, {{unknown}} without an estimate',
                  {
                    counted: runway.counted,
                    unknown: runway.unknown,
                  }
                )
              : t('{{counted}} accounts counted', { counted: runway.counted }),
          },
        ]}
      />
    </Panel>
  )
}

// A weekly quota that runs out within a day, or within three, needs accounts.
function runwayTone(hours: number | null): Tone {
  if (hours == null) return 'default'
  if (hours < 24) return 'danger'
  if (hours < 72) return 'warning'
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
  used: number
  budget: number
  remaining: number | null
  reset: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const tone = usageTone(props.used, props.budget)
  const used = `${Math.round(props.used)}%`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className='focus-visible:ring-ring/50 ml-auto grid w-40 cursor-default justify-items-end gap-1 rounded-sm outline-none focus-visible:ring-2'
          />
        }
      >
        <span className={TEXT_TONES[tone]}>
          {used}
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
      </TooltipTrigger>
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
    </Tooltip>
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
    <Tooltip>
      <TooltipTrigger
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
      </TooltipTrigger>
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
    </Tooltip>
  )
}
