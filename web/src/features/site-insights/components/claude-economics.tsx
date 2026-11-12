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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { claudeEarned, poolUse } from '../finance-analysis'
import {
  accountPrice,
  PRICE_MONTH_DAYS,
  TONES,
  useChargeFormat,
  useInsightsFormat,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type { FinanceInsights } from '../types'
import { BarSeries, HelpLabel, Panel, SimpleTable } from './shared'

// One color per amount, the same in the figures, the formulas and the chart.
const CHARGE = 'bg-primary'
const OFFICIAL = 'bg-sky-500'
const COST = 'bg-amber-500'

/**
 * Claude's economics over the range: what new-api charged, what gpt-load
 * spent at official prices, what the pool's accounts cost, and the ratios
 * between them; then each day, the pool's cost by plan, and what one
 * account is worth.
 */
export function ClaudeEconomics(props: { data: FinanceInsights | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('finance')
  const data = props.data
  const charge = useChargeFormat(data)
  const engine = data?.engine_cost
  const engineReady = !!engine?.configured && !engine.error
  // Both sides cover only the days the engine reported. new-api's charge is
  // in yuan; every figure and ratio below uses it in dollars.
  const chargedYuan = data?.matched_claude_usd ?? 0
  const charged = charge.toUSD(chargedYuan)
  const official = engineReady ? (data?.matched_official_usd ?? 0) : 0
  const multiple = official > 0 ? charged / official : 0

  // Only a Claude account carries a rate-limit tier; Codex, Gemini and Grok
  // accounts, and any the engine could not read, report none.
  const pool = data?.plan_accounts ?? []
  const otherAccounts = pool.reduce(
    (sum, row) => sum + (row.tier ? 0 : row.accounts),
    0
  )
  // Priced plans first, dearest first; the rest are listed, not counted.
  const accounts = pool
    .filter((row) => row.tier)
    .map((row) => ({ ...row, price: accountPrice(row.plan, row.tier) }))
    .sort((a, b) => (b.price?.monthlyUSD ?? -1) - (a.price?.monthlyUSD ?? -1))
  const monthlyUSD = accounts.reduce(
    (sum, row) => sum + (row.price?.monthlyUSD ?? 0) * row.accounts,
    0
  )
  const pricedAccounts = accounts.reduce(
    (sum, row) => sum + (row.price ? row.accounts : 0),
    0
  )
  const unpricedAccounts = accounts.reduce(
    (sum, row) => sum + (row.price ? 0 : row.accounts),
    0
  )
  const perDayUSD = monthlyUSD / PRICE_MONTH_DAYS
  const end = data?.end_time ?? 0
  const rangeDays = Math.max(0, (end - (data?.start_time ?? end)) / 86400)
  const coveredDays = engineReady
    ? Math.max(0, (end - (data?.matched_since ?? end)) / 86400)
    : 0
  const rangeCost = perDayUSD * rangeDays
  // The ratios set the cost over the same days as the amounts beside it.
  const coveredCost = perDayUSD * coveredDays
  const officialPerCost = coveredCost > 0 ? official / coveredCost : 0
  const chargedPerCost = coveredCost > 0 ? charged / coveredCost : 0
  const earned = claudeEarned(data, coveredDays, rangeDays)
  const earnedPerCost =
    earned && coveredCost > 0
      ? charge.toUSD(earned.earnedYuan) / coveredCost
      : 0
  const earnedPerCharge = earned?.perCharge ?? null
  const hasCost = monthlyUSD > 0
  const dayCount = (value: number) => fmt.num(Math.round(value * 10) / 10)
  const ratio = (value: number) => (value > 0 ? fmt.multiple(value) : '-')
  const engineByDay = new Map(
    (engine?.daily ?? []).map((day) => [day.day, day])
  )

  let chargedHint: string | undefined
  if (data && Math.abs((data.claude_usd ?? 0) - chargedYuan) >= 0.01) {
    chargedHint = t('{{total}} over the whole range', {
      total: charge.usd(charge.toUSD(data.claude_usd ?? 0)),
    })
  }
  const poolFit = engineReady
    ? poolUse({
        plans: data?.plans,
        officialUSD: official,
        chargedUSD: charged,
        coveredDays,
        costPerDayUSD: perDayUSD,
      })
    : null
  let advice: string | undefined
  if (poolFit) {
    const vars = {
      share: fmt.pct(poolFit.utilisation),
      used: fmt.usd(poolFit.usedPerDay),
      capacity: fmt.usd(poolFit.capacityPerDay),
    }
    if (poolFit.advice === 'fewer') {
      advice = t(
        'The pool used {{share}} of its measured capacity, {{used}} a day at official prices of {{capacity}}: fewer accounts would serve this use.',
        vars
      )
    } else if (poolFit.advice === 'more') {
      advice = t(
        'The pool used {{share}} of its measured capacity, {{used}} a day at official prices of {{capacity}}: add accounts before it fills.',
        vars
      )
    } else {
      advice = t(
        'The pool used {{share}} of its measured capacity, {{used}} a day at official prices of {{capacity}}: the account count fits the use.',
        vars
      )
    }
  }
  let breakEven: string | undefined
  const earnedPerDay =
    earned && coveredDays > 0
      ? charge.toUSD(earned.earnedYuan) / coveredDays
      : null
  if (poolFit && hasCost && earnedPerDay != null) {
    breakEven = t(
      'The accounts break even at {{breakEven}} of Claude revenue earned a day; it earned {{earned}} a day.',
      {
        breakEven: charge.usd(poolFit.breakEven),
        earned: charge.usd(earnedPerDay),
      }
    )
  } else if (poolFit && hasCost) {
    breakEven = t(
      'The accounts break even at {{breakEven}} of new-api Claude charge a day; it charged {{charged}} a day.',
      {
        breakEven: charge.usd(poolFit.breakEven),
        charged: charge.usd(poolFit.chargedPerDay),
      }
    )
  }
  let coverage: string | undefined
  if (engineReady && rangeDays > 0 && rangeDays - coveredDays >= 1 / 24) {
    coverage = t(
      'gpt-load reported {{covered}} of {{days}} days; every ratio uses those days.',
      { covered: dayCount(coveredDays), days: dayCount(rangeDays) }
    )
  }

  return (
    <>
      <Panel
        title={t('Claude: usage, official cost and account cost')}
        help={t(
          'new-api charge is what new-api deducted for Claude models at its own ratios. new-api counts it in dollars, but customers pay ¥1 for each, so it is in yuan; it is shown and compared in dollars at the site’s USD exchange rate, with the yuan beside it. Official cost is what gpt-load (corecode-engine) priced the same requests at Anthropic’s official prices. Both cover the days gpt-load reported, and gifted and paid balance count alike. Account cost is what the pool’s accounts cost a month, spread over 30 days: a 24-hour range costs a thirtieth of a month.'
        )}
        description={coverage}
      >
        {engine && !engine.configured && (
          <p className='text-muted-foreground mb-3 text-sm'>
            {t(
              'Set EngineControlURL and EngineControlKey to read official-price cost from corecode-engine.'
            )}
          </p>
        )}
        {engine?.error && (
          <p className='text-destructive mb-3 text-sm'>{engine.error}</p>
        )}
        <div className='grid gap-3 sm:grid-cols-3'>
          <Figure
            loading={!data}
            dot={CHARGE}
            label={t('new-api Claude charge')}
            help={t(
              'What new-api deducted for Claude models at its own ratios, over the days gpt-load reported, root included. In dollars at the site’s exchange rate; the yuan new-api counted is in brackets.'
            )}
            value={
              <ChargeValue usd={fmt.usd(charged)} yuan={fmt.cny(chargedYuan)} />
            }
            hint={chargedHint}
          />
          <Figure
            loading={!data}
            dot={OFFICIAL}
            label={t('gpt-load official cost')}
            help={t(
              'What gpt-load (corecode-engine) priced the same Claude requests at, at Anthropic’s official prices, in dollars.'
            )}
            value={engineReady ? fmt.usd(official) : '-'}
            hint={
              engineReady
                ? t('{{count}} Claude requests', {
                    count: engine?.requests ?? 0,
                  })
                : undefined
            }
          />
          <Figure
            loading={!data}
            dot={COST}
            label={t('Account cost in this range')}
            help={t(
              'The monthly price of every Claude account in the pool now, divided by 30 and multiplied by the range’s days. Accounts bought or dropped during the range are not reflected.'
            )}
            value={hasCost ? fmt.usd(rangeCost) : '-'}
            hint={
              hasCost
                ? t(
                    '{{monthly}} a month ÷ 30 × {{days}} days · {{count}} accounts',
                    {
                      monthly: fmt.usdWhole(monthlyUSD),
                      days: dayCount(rangeDays),
                      count: pricedAccounts,
                    }
                  )
                : undefined
            }
          />
          <Figure
            result
            loading={!data}
            formula={[CHARGE, OFFICIAL]}
            label={t('new-api ÷ official')}
            help={t(
              'new-api’s charge in dollars divided by the official cost: below 1× new-api sells Claude for less than Anthropic’s prices.'
            )}
            value={ratio(multiple)}
            hint={
              multiple > 0
                ? t('Each $1 at official prices is charged {{amount}}.', {
                    amount: charge.usd(multiple),
                  })
                : undefined
            }
          />
          <Figure
            result
            loading={!data}
            formula={[OFFICIAL, COST]}
            label={t('Official ÷ account cost')}
            help={t(
              'The official cost divided by the account cost of the same days: how much official-price usage each dollar of accounts served. It reads how fully the accounts are used.'
            )}
            value={ratio(officialPerCost)}
            hint={
              officialPerCost > 0
                ? t(
                    'Each $1 of account cost serves {{amount}} at official prices.',
                    { amount: fmt.usd(officialPerCost) }
                  )
                : undefined
            }
          />
          {earned ? (
            <Figure
              result
              loading={!data}
              formula={[CHARGE, COST]}
              label={t('Earned ÷ account cost')}
              help={t(
                'Claude’s revenue earned over the days gpt-load reported, root’s use and given credit left out, divided by the account cost of the same days: whether the accounts pay for themselves. Below 1×, red. The usage multiple beside it divides new-api’s Claude charge instead, root, gifted balance and plan use included: how much use the accounts carry, not what they earn.'
              )}
              value={ratio(earnedPerCost)}
              tone={
                earnedPerCost > 0 && earnedPerCost < 1 ? 'danger' : undefined
              }
              hint={
                chargedPerCost > 0
                  ? t(
                      'Usage multiple {{multiple}} (new-api charge ÷ account cost)',
                      {
                        multiple: ratio(chargedPerCost),
                      }
                    )
                  : undefined
              }
            />
          ) : (
            <Figure
              result
              loading={!data}
              formula={[CHARGE, COST]}
              label={t('new-api ÷ account cost')}
              help={t(
                'A usage multiple: new-api’s Claude charge in dollars, root, gifted balance and plan use included, divided by the account cost of the same days. It reads how much use the accounts carry, not what they earn; Gross margin by vendor sets revenue earned against the same cost.'
              )}
              value={ratio(chargedPerCost)}
              hint={
                chargedPerCost > 0
                  ? t(
                      'Each $1 of account cost carries {{amount}} of new-api charge.',
                      { amount: charge.usd(chargedPerCost) }
                    )
                  : undefined
              }
            />
          )}
        </div>

        {advice && (
          <p className='mt-3 text-sm'>
            <span
              className={TONES[poolFit?.advice === 'fits' ? 'good' : 'warning']}
            >
              {advice}
            </span>{' '}
            {breakEven && (
              <span
                className={cn(
                  poolFit &&
                    (earnedPerDay ?? poolFit.chargedPerDay) < poolFit.breakEven
                    ? TONES.danger
                    : 'text-muted-foreground'
                )}
              >
                {breakEven}
              </span>
            )}
          </p>
        )}

        {!engine?.error && (
          <div className='mt-4 border-t pt-4'>
            <BarSeries
              grouped
              ariaLabel={t('Daily Claude usage: new-api against gpt-load')}
              series={[
                {
                  label: t('new-api Claude charge'),
                  format: charge.usd,
                  compact: fmt.usdCompact,
                },
                { label: t('gpt-load official cost'), format: fmt.usd },
              ]}
              points={(data?.daily ?? []).map((day) => {
                const reported = engineByDay.get(day.day)
                const dayCharged = charge.toUSD(day.claude_usd ?? 0)
                const dayOfficial = reported?.cost_usd ?? 0
                return {
                  key: day.day,
                  title: fmt.day(day.day),
                  values: [dayCharged, dayOfficial],
                  partial: partialDay(day.day, [dayCharged, dayOfficial]),
                  extra: [
                    {
                      label: t('new-api ÷ official'),
                      value: ratio(
                        dayOfficial > 0 ? dayCharged / dayOfficial : 0
                      ),
                    },
                    // A day's account cost is too small beside its usage to
                    // read as a bar, so it is a figure here.
                    ...(hasCost
                      ? [
                          {
                            label: t('Account cost per day'),
                            value: fmt.usd(perDayUSD),
                          },
                          {
                            label: t('Official ÷ account cost'),
                            value: ratio(dayOfficial / perDayUSD),
                          },
                        ]
                      : []),
                    {
                      label: t('Claude requests'),
                      value: fmt.num(reported?.requests ?? 0),
                    },
                  ],
                }
              })}
            />
          </div>
        )}
      </Panel>

      <div className='grid gap-4'>
        <Panel
          title={t('Account cost')}
          help={t(
            'Every account in gpt-load’s pool, whatever its status, at its plan’s monthly price: Pro $20, Max 5x $100, Team Standard $25, Team Tier 1 $125. A plan with no known price is listed but not counted. The range’s cost spreads the month over 30 days. The count is the pool now, not as it was over the range.'
          )}
          description={
            hasCost
              ? t(
                  '{{count}} accounts cost {{monthly}} a month, {{daily}} a day.',
                  {
                    count: pricedAccounts,
                    monthly: fmt.usd(monthlyUSD),
                    daily: fmt.usd(perDayUSD),
                  }
                )
              : undefined
          }
        >
          {data?.plans_error && (
            <p className='text-destructive mb-2 text-sm'>{data.plans_error}</p>
          )}
          <SimpleTable
            rows={accounts}
            rowKey={(row) => `${row.plan}/${row.tier}`}
            empty={t('No accounts in the pool')}
            faded={(row) => !row.price}
            columns={[
              {
                key: 'plan',
                label: t('Plan'),
                render: (row) => (
                  <PlanName
                    name={row.price?.label ?? row.plan}
                    tier={row.tier}
                  />
                ),
              },
              {
                key: 'accounts',
                label: t('Accounts'),
                hint: t(
                  'Every account of this plan in the pool, whatever its status.'
                ),
                align: 'right',
                render: (row) => row.accounts,
              },
              {
                key: 'eligible',
                label: t('Usable now'),
                hint: t('Accounts the scheduler may send requests to now.'),
                align: 'right',
                render: (row) => row.eligible,
              },
              {
                key: 'price',
                label: t('Price per month'),
                hint: t('What one account of this plan costs a month.'),
                align: 'right',
                render: (row) =>
                  row.price
                    ? fmt.usdWhole(row.price.monthlyUSD)
                    : t('No price'),
              },
              {
                key: 'month',
                label: t('Per month'),
                hint: t('Price per month times the accounts.'),
                align: 'right',
                render: (row) =>
                  row.price
                    ? fmt.usd(row.price.monthlyUSD * row.accounts)
                    : '-',
              },
              {
                key: 'range',
                label: t('This range'),
                hint: t(
                  'The month’s cost divided by 30 and multiplied by the range’s days.'
                ),
                align: 'right',
                render: (row) =>
                  row.price
                    ? fmt.usd(
                        (row.price.monthlyUSD * row.accounts * rangeDays) /
                          PRICE_MONTH_DAYS
                      )
                    : '-',
              },
            ]}
          />
          {accounts.length > 0 && (
            <dl className='mt-3 grid max-w-xl grid-cols-3 gap-2 border-t pt-3 text-sm'>
              {[
                [t('Total per month'), fmt.usd(monthlyUSD)],
                [t('Per day'), fmt.usd(perDayUSD)],
                [t('This range'), fmt.usd(rangeCost)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className='text-muted-foreground text-xs'>{label}</dt>
                  <dd className='font-semibold tabular-nums'>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {unpricedAccounts > 0 && (
            <p className='text-muted-foreground mt-2 text-xs'>
              {t(
                '{{count}} accounts have no known price and are not counted.',
                {
                  count: unpricedAccounts,
                }
              )}
            </p>
          )}
          {otherAccounts > 0 && (
            <p className='text-muted-foreground mt-1 text-xs'>
              {t(
                '{{count}} accounts of other vendors, or whose plan the engine has not read, are left out.',
                { count: otherAccounts }
              )}
            </p>
          )}
        </Panel>

        <Panel
          title={t('What one account is worth')}
          help={t(
            'A full week of one account at official prices, as corecode-engine calibrated it from the account’s own requests: the median of the plan’s measured accounts, with the smallest and largest. The new-api columns multiply it by this range’s multiple; a month is 30/7 weeks. Value ÷ price divides the new-api value per month by the plan’s monthly price.'
          )}
        >
          <SimpleTable
            rows={data?.plans}
            rowKey={(row) => `${row.plan}/${row.tier}`}
            empty={t('No account has a measured weekly capacity')}
            columns={[
              {
                key: 'plan',
                label: t('Plan'),
                render: (row) => (
                  <PlanName
                    name={accountPrice(row.plan, row.tier)?.label ?? row.plan}
                    tier={row.tier}
                  />
                ),
              },
              {
                key: 'accounts',
                label: t('Measured accounts'),
                hint: t(
                  'Accounts whose weekly capacity the engine calibrated from their own requests, out of all the plan’s accounts.'
                ),
                align: 'right',
                render: (row) => `${row.measured} / ${row.accounts}`,
              },
              {
                key: 'week',
                label: t('Official value per week'),
                hint: t(
                  'What one account serves in a full week at official prices: the median of the measured accounts, the smallest and largest in brackets.'
                ),
                align: 'right',
                render: (row) => {
                  const low = fmt.usdWhole(row.week_low_usd)
                  const high = fmt.usdWhole(row.week_high_usd)
                  return low === high
                    ? fmt.usd(row.week_usd)
                    : `${fmt.usd(row.week_usd)} (${low}–${high})`
                },
              },
              {
                key: 'charged-week',
                label: t('new-api value per week'),
                hint: t(
                  'The official value per week times this range’s new-api ÷ official multiple: what that usage brings in on new-api.'
                ),
                align: 'right',
                render: (row) =>
                  multiple > 0 ? charge.usd(row.week_usd * multiple) : '-',
              },
              {
                key: 'charged-month',
                label: t('new-api value per month'),
                hint: t('The new-api value per week times 30/7.'),
                align: 'right',
                render: (row) =>
                  multiple > 0
                    ? charge.usd(((row.week_usd * 30) / 7) * multiple)
                    : '-',
              },
              {
                key: 'payback',
                label: t('Value ÷ price'),
                hint:
                  earnedPerCharge != null
                    ? t(
                        'What a month of one account earns, the new-api value per month times Claude’s revenue earned per yuan charged, divided by the plan’s monthly price: how many times one account earns back its price.'
                      )
                    : t(
                        'The new-api value per month divided by the plan’s monthly price: charge, not revenue, so root, gifted and plan use count as if paid.'
                      ),
                align: 'right',
                render: (row) => {
                  const price = accountPrice(row.plan, row.tier)
                  if (!price || multiple <= 0) return '-'
                  return fmt.multiple(
                    (((row.week_usd * 30) / 7) *
                      multiple *
                      (earnedPerCharge ?? 1)) /
                      price.monthlyUSD
                  )
                },
              },
            ]}
          />
        </Panel>
      </div>
    </>
  )
}

/** A dollar figure with the yuan new-api counted beside it, smaller. */
export function ChargeValue(props: { usd: string; yuan: string }) {
  return (
    <span className='flex flex-wrap items-baseline gap-x-1.5'>
      <span>{props.usd}</span>
      <span className='text-muted-foreground text-sm font-normal'>
        ({props.yuan})
      </span>
    </span>
  )
}

function PlanName(props: { name: string; tier: string }) {
  return (
    <span className='flex flex-col leading-tight'>
      <span>{props.name || '-'}</span>
      {props.tier && (
        <span className='text-muted-foreground text-[11px]'>{props.tier}</span>
      )}
    </span>
  )
}

/**
 * One amount, marked with its color, or a ratio between two, marked with
 * both colors and set on a tinted card as a result of the amounts above.
 */
export function Figure(props: {
  label: string
  /** What the figure means, opened from its label. */
  help?: string
  value: ReactNode
  hint?: ReactNode
  loading: boolean
  dot?: string
  formula?: [string, string]
  result?: boolean
  tone?: 'danger'
}) {
  return (
    <Card
      data-card-hover='false'
      className={cn(
        'gap-1 px-4 py-3',
        props.result ? 'bg-primary/5 border-primary/20' : 'bg-muted/20'
      )}
    >
      <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        {props.dot && (
          <span
            aria-hidden
            className={cn('size-2 shrink-0 rounded-full', props.dot)}
          />
        )}
        {props.formula && (
          <span aria-hidden className='flex shrink-0 items-center gap-0.5'>
            <span className={cn('size-2 rounded-full', props.formula[0])} />
            <span className='text-[10px] leading-none'>÷</span>
            <span className={cn('size-2 rounded-full', props.formula[1])} />
          </span>
        )}
        <span className='truncate'>
          <HelpLabel label={props.label} help={props.help} />
        </span>
      </div>
      <div
        className={cn(
          'text-2xl font-semibold tabular-nums',
          props.tone === 'danger' && 'text-destructive'
        )}
      >
        {props.loading ? <Skeleton className='h-8 w-24' /> : props.value}
      </div>
      {props.hint != null && (
        <div className='text-muted-foreground text-xs'>{props.hint}</div>
      )}
    </Card>
  )
}
