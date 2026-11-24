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

import { cn } from '@/lib/utils'

import {
  campaignConversion,
  campaignMultiple,
  campaignReturn,
  campaignScale,
  funnelSteps,
  isPromotion,
  newcomerNet,
  orderedCampaigns,
} from '../campaign-analysis'
import { useInsightsFormat, type SourceState } from '../lib'
import type { CampaignInsights, CampaignRow } from '../types'
import { MetricGrid, Panel, SimpleTable, type MetricItem } from './shared'
import { Fold } from './tab-fold'

/** The name of each kind of campaign. */
function useCampaignLabel() {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    invite_gift: t('Invite gift plans'),
    newcomer_plan: t('Newcomer plan'),
    forum_id: t('Forum ID gift ($3)'),
    raffle: t('Raffle prize ($5)'),
    admin_plan: t('Plans bound by hand'),
    redemption: t('Redemption codes'),
    channel_fee: t('Paid channel fees'),
    manual_other: t('Other hand credits (compensation)'),
  }
  return (kind: string) => labels[kind] ?? kind
}

/**
 * Each campaign's cost against what its recipients paid afterwards, as two bars
 * on one scale, with the multiple back beside the name.
 */
function CostVsPaidBars(props: { rows: CampaignRow[] }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useCampaignLabel()
  const scale = campaignScale(props.rows)
  const width = (value: number) =>
    value > 0 && scale > 0 ? `${Math.max((value / scale) * 100, 1)}%` : '0%'
  return (
    <div className='grid gap-3'>
      <ul className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
        <li className='flex items-center gap-1.5'>
          <span aria-hidden className='size-2 rounded-sm bg-amber-500/80' />
          {t('Cost')}
        </li>
        <li className='flex items-center gap-1.5'>
          <span aria-hidden className='size-2 rounded-sm bg-emerald-500/80' />
          {t('Paid by them afterwards')}
        </li>
      </ul>
      <ul className='grid gap-3'>
        {props.rows.map((row) => {
          const multiple = campaignMultiple(row)
          const back = campaignReturn(row)
          return (
            <li
              key={row.kind}
              className={cn(
                'grid gap-1',
                !isPromotion(row.kind) && 'opacity-70'
              )}
            >
              <div className='flex items-baseline justify-between gap-2 text-xs'>
                <span className='min-w-0 truncate'>{label(row.kind)}</span>
                <span className='shrink-0 font-medium tabular-nums'>
                  {multiple == null ? '-' : fmt.multiple(multiple)}
                </span>
              </div>
              <div className='bg-muted/40 h-2 overflow-hidden rounded-full'>
                <div
                  className='h-full rounded-full bg-amber-500/80'
                  style={{ width: width(row.cost_usd) }}
                />
              </div>
              <div className='bg-muted/40 h-2 overflow-hidden rounded-full'>
                <div
                  className='h-full rounded-full bg-emerald-500/80'
                  style={{ width: width(back) }}
                />
              </div>
              <p className='text-muted-foreground text-xs tabular-nums'>
                {fmt.cny(row.cost_usd)} → {fmt.cny(back)}
                {!isPromotion(row.kind) && ` · ${t('not in the total')}`}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The newcomer plan's buyers: bought, used it up, paid again; then what the plan netted. */
function NewcomerFunnelView(props: {
  funnel: NonNullable<CampaignInsights['newcomer']>
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const steps = funnelSteps(props.funnel)
  const names: Record<string, string> = {
    bought: t('Bought the plan'),
    used_up: t('Used it up'),
    repaid: t('Paid again after buying'),
  }
  const net = newcomerNet(props.funnel)
  return (
    <div className='grid content-start gap-3'>
      <h4 className='text-muted-foreground text-xs font-medium'>
        {t('Newcomer plan: from buying to paying again')}
      </h4>
      <ul className='grid gap-2' aria-label={t('Newcomer plan funnel')}>
        {steps.map((step) => (
          <li key={step.key} className='grid gap-0.5'>
            <div className='flex items-baseline justify-between gap-2 text-xs'>
              <span className='min-w-0 truncate'>{names[step.key]}</span>
              <span className='shrink-0 font-medium tabular-nums'>
                {fmt.num(step.count)} · {fmt.pct(step.share)}
              </span>
            </div>
            <div className='bg-muted/40 h-2.5 overflow-hidden rounded-full'>
              <div
                className='h-full rounded-full bg-sky-500/70'
                style={{ width: `${Math.max(step.share * 100, 1)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Buyers paid {{pack}} for the plan and {{repaid}} after it; they used {{used}} of its quota. Net {{net}}.',
          {
            pack: fmt.cny(props.funnel.pack_money),
            repaid: fmt.cny(props.funnel.repaid_money),
            used: fmt.cny(props.funnel.used_usd),
            net: fmt.cny(net),
          }
        )}
      </p>
    </div>
  )
}

/** A multiple at or above one paid for itself; below it, the campaign is still behind. */
function paybackTone(multiple: number | null): MetricItem['tone'] {
  if (multiple == null) return 'default'
  return multiple >= 1 ? 'good' : 'warning'
}

/**
 * What each way of winning customers cost and what its recipients paid
 * afterwards: four figures for all of them, the cost against the return of
 * each, the newcomer plan's funnel, and the full table folded.
 */
export function CampaignRoiPanel(props: {
  data: CampaignInsights | undefined
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useCampaignLabel()
  const data = props.data
  const failed = !data && props.source?.status === 'error'
  const rows = orderedCampaigns(data)
  const total = data?.total
  const multiple = total ? campaignMultiple(total) : null
  const conversion = total ? campaignConversion(total) : null
  const help = t(
    'What each way of winning customers cost and what the people it reached paid afterwards. Quota given counts ¥1 per dollar, as the funds tab does; a newcomer plan is sold, so its cost is the quota its buyers used, and a paid channel’s is its fee over the range. Those reached are the accounts that received in the range, followed from the moment they received to now, whatever the range’s end. Payments are top-ups and plans bought with money; a newcomer plan’s own price is counted as its return. An account in two campaigns is in both rows and once in the total. Compensation and refunds are listed but not in the total. Staff and enterprise backfills are left out.'
  )
  let description: string | undefined
  if (total && total.recipients > 0) {
    description = t(
      '{{cost}} reached {{recipients}} people in this range; {{payers}} of them paid {{paid}} afterwards.',
      {
        cost: fmt.cny(total.cost_usd),
        recipients: fmt.num(total.recipients),
        payers: fmt.num(total.payers),
        paid: fmt.cny(total.paid_money),
      }
    )
  } else if (total) {
    description = t('No campaign reached anyone in this range.')
  }
  const items: MetricItem[] = [
    {
      label: t('Campaign cost'),
      value: total ? fmt.cny(total.cost_usd) : '-',
      hint: total
        ? t('{{count}} people reached', { count: fmt.num(total.recipients) })
        : undefined,
      featured: true,
      missing: !total,
    },
    {
      label: t('Paid afterwards'),
      value: total
        ? `${fmt.num(total.payers)} / ${fmt.num(total.recipients)}`
        : '-',
      hint: conversion == null ? undefined : fmt.pct(conversion),
      missing: !total,
    },
    {
      label: t('Brought in'),
      value: total ? fmt.cny(campaignReturn(total)) : '-',
      hint:
        total && total.pack_money > 0
          ? t('{{amount}} of it the newcomer plan’s own price', {
              amount: fmt.cny(total.pack_money),
            })
          : undefined,
      missing: !total,
    },
    {
      label: t('Money back per unit of cost'),
      value: multiple == null ? '-' : fmt.multiple(multiple),
      tone: paybackTone(multiple),
      missing: !total,
    },
  ]
  return (
    <Panel
      id='campaign-roi'
      title={t('Campaign payback')}
      help={help}
      error={failed ? t('Could not be read') : undefined}
      description={description}
    >
      {failed ? null : (
        <div className='grid gap-4'>
          <MetricGrid
            loading={!data}
            items={items}
            className='grid-cols-2 sm:grid-cols-2 lg:grid-cols-5'
          />
          {rows.length > 0 && (
            <div
              className={cn(
                'grid gap-6',
                data?.newcomer && 'lg:grid-cols-[3fr_2fr]'
              )}
            >
              <CostVsPaidBars rows={rows} />
              {data?.newcomer && <NewcomerFunnelView funnel={data.newcomer} />}
            </div>
          )}
          {rows.length > 0 && (
            <Fold summary={t('Show the figures')}>
              <SimpleTable<CampaignRow>
                rows={rows}
                rowKey={(row) => row.kind}
                empty={t('No data')}
                columns={[
                  {
                    key: 'kind',
                    label: t('Campaign'),
                    render: (row) => label(row.kind),
                  },
                  {
                    key: 'recipients',
                    label: t('Reached'),
                    align: 'right',
                    render: (row) => fmt.num(row.recipients),
                  },
                  {
                    key: 'payers',
                    label: t('Paid afterwards'),
                    align: 'right',
                    render: (row) => {
                      const rate = campaignConversion(row)
                      return rate == null
                        ? fmt.num(row.payers)
                        : `${fmt.num(row.payers)} · ${fmt.pct(rate)}`
                    },
                  },
                  {
                    key: 'cost',
                    label: t('Cost'),
                    align: 'right',
                    render: (row) => fmt.cny(row.cost_usd),
                  },
                  {
                    key: 'back',
                    label: t('Brought in'),
                    align: 'right',
                    render: (row) => fmt.cny(campaignReturn(row)),
                  },
                  {
                    key: 'multiple',
                    label: t('Multiple'),
                    align: 'right',
                    render: (row) => {
                      const value = campaignMultiple(row)
                      return value == null ? '-' : fmt.multiple(value)
                    },
                  },
                  {
                    key: 'used',
                    label: t('Used'),
                    align: 'right',
                    render: (row) => fmt.cny(row.used_usd),
                  },
                  {
                    key: 'lying',
                    label: t('Still unspent'),
                    align: 'right',
                    render: (row) => fmt.cny(row.lying_usd),
                  },
                ]}
              />
              <p className='text-muted-foreground mt-2 text-xs'>
                {t(
                  'Used and unspent are quota given. For a plan, unspent is what a running plan still holds; a plan that ended with quota left is not counted in either. For a balance credit it is the smaller of the credit and what the wallet still holds, an estimate: a wallet does not remember which credit it spent.'
                )}
              </p>
            </Fold>
          )}
        </div>
      )}
    </Panel>
  )
}
