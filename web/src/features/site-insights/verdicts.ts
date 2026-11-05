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

import type { Tone } from './components/shared'
import {
  failureTone,
  joinSentences,
  useChargeFormat,
  useInsightsFormat,
  useSharedAddresses,
  vendorMargins,
} from './lib'
import type {
  ActivityInsights,
  CapacityInsights,
  FinanceInsights,
  GrowthInsights,
  QualityInsights,
  RiskInsights,
} from './types'

/** A tab's answer: one sentence and how it reads. */
export type TabVerdict = { tone: Tone; text: string }

/** The worse of two tones. */
function worse(a: Tone, b: Tone): Tone {
  const order: Tone[] = ['good', 'default', 'warning', 'danger']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

/**
 * How a figure moved against the previous period, as a short phrase, or
 * null without one to compare with.
 */
function useChange() {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  return (current: number, previous: number | undefined) => {
    if (previous == null || previous <= 0) return null
    const change = current / previous - 1
    if (Math.abs(change) < 0.005) return t('flat')
    // Past doubling, a multiple reads more easily than a percentage.
    if (change >= 1) {
      return t('to {{times}}×', {
        times: fmt.num(Math.round((change + 1) * 10) / 10),
      })
    }
    return change > 0
      ? t('up {{change}}', { change: fmt.pct(change) })
      : t('down {{change}}', { change: fmt.pct(-change) })
  }
}

const join = joinSentences

/**
 * The capacity tab's verdict over the slots in view: every pool slot, or one
 * provider's. The per-user limit is not split by provider, so a provider's
 * verdict leaves it out.
 */
export function useCapacityVerdict(
  data: CapacityInsights | undefined,
  previous: CapacityInsights | undefined,
  scope?: { slots: number; userLimits: boolean }
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const change = useChange()
  if (!data) return undefined
  const slots =
    scope?.slots ?? (data.pool?.configured ? data.pool.effective_slots : 0)
  const pool =
    data.error_categories.find((item) => item.name === 'engine_concurrency')
      ?.count ?? 0
  const limited = scope?.userLimits === false ? 0 : data.limit_rejection_total
  let tone: Tone = 'good'
  if (slots && data.peak_concurrency > slots) tone = 'danger'
  else if (pool > 0) tone = 'danger'
  else if (limited > 0) tone = 'warning'
  return {
    tone,
    text: join(
      (() => {
        const moved = change(data.requests, previous?.requests)
        const requests = fmt.num(data.requests)
        return moved
          ? t('{{requests}} requests ({{change}}).', {
              requests,
              change: moved,
            })
          : t('{{requests}} requests.', { requests })
      })(),
      slots > 0 &&
        t('Peak concurrency {{peak}} of {{slots}} slots ({{share}}).', {
          peak: fmt.num(data.peak_concurrency),
          slots: fmt.num(slots),
          share: fmt.pct(data.peak_concurrency / slots),
        }),
      pool > 0 &&
        t('{{count}} turned away with the pool full.', {
          count: fmt.num(pool),
        }),
      limited > 0 &&
        t('{{count}} turned away by per-user limits.', {
          count: fmt.num(limited),
        }),
      pool === 0 && limited === 0 && t('Nothing turned away.')
    ),
  }
}

export function useQualityVerdict(
  data: QualityInsights | undefined,
  previous: QualityInsights | undefined
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  if (!data) return undefined
  const vendors = (data.vendors ?? []).filter(
    (vendor) => vendor.ttft_p50_ms > 0
  )
  const claude = vendors.find((vendor) => vendor.vendor === 'claude')
  const failing = (data.models ?? [])
    .filter((row) => row.requests >= 100 && row.error_rate > 0.05)
    .sort((a, b) => b.error_rate - a.error_rate)
  // A vendor failing past 5% is named, even when the site's rate is low.
  const names: Record<string, string> = {
    claude: 'Claude',
    codex: 'GPT',
    grok: 'Grok',
    gemini: 'Gemini',
  }
  const failingVendors = (data.vendors ?? []).filter(
    (vendor) =>
      names[vendor.vendor] && vendor.requests >= 100 && vendor.error_rate > 0.05
  )
  const failure = failureTone(data.error_rate)
  let tone: Tone = failure === 'default' ? 'good' : failure
  if (failingVendors.length > 0) tone = worse(tone, 'warning')
  if (claude && claude.ttft_p95_ms > 10000) tone = worse(tone, 'warning')
  const points =
    previous && previous.requests > 0
      ? (data.error_rate - previous.error_rate) * 100
      : null
  return {
    tone,
    text: join(
      points != null && Math.abs(points) >= 0.1
        ? t('Failure rate {{rate}} ({{sign}}{{points}} points).', {
            rate: fmt.pct(data.error_rate),
            sign: points > 0 ? '+' : '−',
            points: fmt.num(Math.round(Math.abs(points) * 10) / 10),
          })
        : t('Failure rate {{rate}}.', { rate: fmt.pct(data.error_rate) }),
      ...failingVendors.map((vendor) =>
        t('{{vendor}} fails {{rate}} of requests.', {
          vendor: names[vendor.vendor],
          rate: fmt.pct(vendor.error_rate),
        })
      ),
      claude &&
        t('Claude first token {{p50}} at p50, {{p95}} at p95.', {
          p50: fmt.measuredMs(claude.ttft_p50_ms),
          p95: fmt.measuredMs(claude.ttft_p95_ms),
        }),
      failing.length > 0 &&
        t('Failing most: {{model}} at {{rate}}.', {
          model: failing[0].model,
          rate: fmt.pct(failing[0].error_rate),
        })
    ),
  }
}

export function useFinanceVerdict(
  data: FinanceInsights | undefined,
  previous: FinanceInsights | undefined
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const change = useChange()
  const charge = useChargeFormat(data)
  if (!data) return undefined
  const rows = vendorMargins(data, charge.rate)
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const margin = revenue - rows.reduce((sum, row) => sum + row.cost, 0)
  const rate = revenue > 0 ? margin / revenue : 0
  let tone: Tone = 'good'
  if (margin < 0) tone = 'danger'
  else if (rate < 0.2) tone = 'warning'
  if (data.debt_usd < -1) tone = worse(tone, 'warning')
  return {
    tone,
    text: join(
      (() => {
        const moved = change(data.revenue, previous?.revenue)
        const vars = {
          revenue: fmt.cny(data.revenue),
          earned: fmt.cny(data.recognized_revenue ?? 0),
        }
        return moved
          ? t('Paid {{revenue}} ({{change}}), earned {{earned}}.', {
              ...vars,
              change: moved,
            })
          : t('Paid {{revenue}}, earned {{earned}}.', vars)
      })(),
      revenue > 0 &&
        t('Gross margin {{margin}} ({{rate}}).', {
          margin: fmt.cny(margin),
          rate: fmt.pct(rate),
        }),
      data.debt_usd < -1 &&
        t('Customers owe {{debt}}.', { debt: fmt.usd(-data.debt_usd) })
    ),
  }
}

export function useGrowthVerdict(
  data: GrowthInsights | undefined,
  previous: GrowthInsights | undefined
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const change = useChange()
  if (!data) return undefined
  const { registered, activated, paid } = data.funnel
  const activation = registered ? activated / registered : 0
  const conversion = registered ? paid / registered : 0
  return {
    tone: registered > 0 && activation < 0.3 ? 'warning' : 'good',
    text: join(
      (() => {
        const moved = change(registered, previous?.funnel.registered)
        const count = fmt.num(registered)
        return moved
          ? t('{{count}} sign-ups ({{change}}).', { count, change: moved })
          : t('{{count}} sign-ups.', { count })
      })(),
      registered > 0 &&
        t('{{activation}} sent a request and {{conversion}} paid.', {
          activation: fmt.pct(activation),
          conversion: fmt.pct(conversion),
        })
    ),
  }
}

export function useActivityVerdict(
  data: ActivityInsights | undefined,
  previous: ActivityInsights | undefined
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const change = useChange()
  if (!data) return undefined
  const top = data.top_users[0]
  return {
    tone: data.top1_share > 0.3 ? 'warning' : 'good',
    text: join(
      (() => {
        const moved = change(data.active_users, previous?.active_users)
        const count = fmt.num(data.active_users)
        return moved
          ? t('{{count}} active users ({{change}}).', { count, change: moved })
          : t('{{count}} active users.', { count })
      })(),
      top &&
        t(
          'The largest customer, {{user}}, used {{share}}; the top 10, {{top10}}.',
          {
            user: top.username || `#${top.user_id}`,
            share: fmt.pct(data.top1_share),
            top10: fmt.pct(data.top10_share),
          }
        )
    ),
  }
}

export function useRiskVerdict(
  data: RiskInsights | undefined
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const clusters = useSharedAddresses(data)
  if (!data) return undefined
  const debtors = data.debtors.length
  const findings = [
    clusters.length > 0 &&
      t('{{count}} addresses shared by several accounts', {
        count: clusters.length,
      }),
    data.alias_emails > 0 &&
      t('{{count}} alias emails', { count: data.alias_emails }),
    data.off_whitelist > 0 &&
      t('{{count}} sign-ups off the email whitelist', {
        count: data.off_whitelist,
      }),
    debtors > 0 && t('{{count}} accounts in debt', { count: debtors }),
  ].filter((item): item is string => !!item)
  return {
    tone: findings.length > 0 ? 'warning' : 'good',
    text: join(
      t('{{count}} sign-ups.', { count: fmt.num(data.signups) }),
      findings.length > 0
        ? t('To check: {{items}}.', { items: findings.join(t(', ')) })
        : t('Nothing to check.')
    ),
  }
}
