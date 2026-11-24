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

import { gateMistakeRate, gatedRequests } from '../campaign-analysis'
import {
  useInsightsFormat,
  type InsightsRangeInfo,
  type SourceState,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type { GateInsights } from '../types'
import {
  BarSeries,
  MetricGrid,
  Panel,
  type BarPoint,
  type MetricItem,
} from './shared'

/** The one line a reader takes away: caught, saved, mistaken, and the mistake rate. */
function gateConclusion(
  data: GateInsights,
  fmt: ReturnType<typeof useInsightsFormat>,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const rate = gateMistakeRate(data)
  return t(
    'The gate acted on {{users}} accounts in {{requests}} requests, the studio accounts could not spend {{saved}} of the plans they bought, and {{mistaken}} accounts it acted on were exempted by hand as mistakes ({{rate}}).',
    {
      users: fmt.num(data.users),
      requests: fmt.num(gatedRequests(data)),
      saved: fmt.cny(data.crowd.unused_usd),
      mistaken: fmt.num(data.exemptions.gated),
      rate: rate == null ? '-' : fmt.pct(rate),
    }
  )
}

/**
 * What the newcomer-plan address gate did: the requests it moved to the wallet
 * or turned away by day, the shared exits it let through, the studio's quota it
 * left unspent, and the accounts an administrator exempted as its mistakes.
 */
export function GateEffectPanel(props: {
  data: GateInsights | undefined
  range?: InsightsRangeInfo
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('gate')
  const data = props.data
  const failed = !data && props.source?.status === 'error'
  const end = props.range?.end ?? Number.POSITIVE_INFINITY
  const rate = data ? gateMistakeRate(data) : null
  const exitLabels: Record<string, string> = {
    listed: t('A network on the shared-exit list'),
    crowd: t('Used by many accounts without the plan'),
    traffic: t('Paying traffic from accounts without the plan'),
    unread: t('Address could not be read'),
  }
  const help = t(
    'What the newcomer-plan address gate did in this range, read from the marker on each request’s log; the view reads at most 14 days. A request is moved to the wallet, turned away when the wallet could not pay, or paid by another plan; a shared exit is let through. The studio figures are as of now: the accounts whose remark starts with 新人包多号, the quota of the newcomer plans they bought, how much they had used when the gate stopped them, and how much they could not spend, which is what the plan did not lose. A mistake is an account an administrator exempted by hand after the gate acted on it; that list is not dated by request, so an exemption made for another reason also counts.'
  )
  const items: MetricItem[] = [
    {
      label: t('Requests the gate acted on'),
      value: data ? fmt.num(gatedRequests(data)) : '-',
      hint: data
        ? t(
            '{{wallet}} to the wallet, {{refused}} turned away, {{other}} to another plan',
            {
              wallet: fmt.num(data.wallet),
              refused: fmt.num(data.refused),
              other: fmt.num(data.other_plan),
            }
          )
        : undefined,
      featured: true,
      missing: !data,
    },
    {
      label: t('Accounts acted on'),
      value: data ? fmt.num(data.users) : '-',
      missing: !data,
    },
    {
      label: t('Charged to wallets instead'),
      value: data ? fmt.cny(data.wallet_usd) : '-',
      hint: t('what the plans would have paid'),
      missing: !data,
    },
    {
      label: t('Unspent by studio accounts'),
      value: data ? fmt.cny(data.crowd.unused_usd) : '-',
      hint: data
        ? t('{{used}} of {{granted}} used before they were stopped', {
            used: fmt.cny(data.crowd.used_usd),
            granted: fmt.cny(data.crowd.granted_usd),
          })
        : undefined,
      tone: 'good',
      missing: !data,
    },
    {
      label: t('Exempted as mistakes'),
      value: data ? fmt.num(data.exemptions.gated) : '-',
      hint:
        rate == null
          ? undefined
          : t('{{rate}} of the accounts acted on', { rate: fmt.pct(rate) }),
      tone: data && data.exemptions.gated > 0 ? 'warning' : 'default',
      missing: !data,
    },
  ]
  const points: BarPoint[] = (data?.days ?? []).map((day) => {
    const values = [day.wallet, day.other_plan, day.refused]
    return {
      key: day.day,
      title: fmt.day(day.day),
      values,
      faded: day.day + 86400 > end,
      partial: partialDay(day.day, values),
      extra: [
        { label: t('Accounts'), value: fmt.num(day.users) },
        { label: t('Shared exits let through'), value: fmt.num(day.exits) },
      ],
    }
  })
  return (
    <Panel
      id='gate-effect'
      title={t('Newcomer plan gate')}
      help={help}
      error={failed ? t('Could not be read') : undefined}
      description={data ? gateConclusion(data, fmt, t) : undefined}
    >
      {failed ? null : (
        <div className='grid gap-4'>
          <MetricGrid
            loading={!data}
            items={items}
            className='grid-cols-2 lg:grid-cols-6'
          />
          {data && points.length > 0 && (
            <BarSeries
              ariaLabel={t('Gate actions by day')}
              series={[
                { label: t('Moved to the wallet') },
                { label: t('Paid by another plan') },
                { label: t('Turned away') },
              ]}
              points={points}
            />
          )}
          {data && (
            <div className='text-muted-foreground grid gap-1 text-xs'>
              {data.exits.length > 0 ? (
                <p>
                  {t('Let through as a shared exit: {{list}}.', {
                    list: data.exits
                      .map(
                        (exit) =>
                          `${exitLabels[exit.kind] ?? exit.kind} ${fmt.num(exit.requests)} (${t('{{count}} accounts', { count: fmt.num(exit.users) })})`
                      )
                      .join(' · '),
                  })}
                </p>
              ) : (
                <p>{t('No shared exit was let through in this range.')}</p>
              )}
              <p>
                {t(
                  '{{accounts}} studio accounts, {{gated}} of them acted on in this range; {{exempt}} accounts are exempted, {{inRange}} of them in this range. Before they were exempted {{before}} was charged to their wallets; {{refunded}} was added back by hand afterwards.',
                  {
                    accounts: fmt.num(data.crowd.accounts),
                    gated: fmt.num(data.crowd.gated),
                    exempt: fmt.num(data.exemptions.accounts),
                    inRange: fmt.num(data.exemptions.in_range),
                    before: fmt.cny(data.exemptions.wallet_before_usd),
                    refunded: fmt.cny(data.exemptions.refunded_usd),
                  }
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
