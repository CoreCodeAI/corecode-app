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

import { formatPaymentMoney } from '@/features/wallet/lib'
import { toIntlLocale } from '@/i18n/languages'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { InsightsView } from './api'
import type { Tone } from './components/shared'
import type { FinanceInsights, PoolProvider, RiskInsights } from './types'

/** A tab of the page: one view, or the overview that reads several. */
export type InsightsTab = 'overview' | InsightsView

/** Tabs in the order shown, grouped by what they answer. */
export const INSIGHTS_TAB_GROUPS: { key: string; tabs: InsightsTab[] }[] = [
  { key: 'overview', tabs: ['overview'] },
  { key: 'operations', tabs: ['capacity', 'pool', 'quality'] },
  { key: 'business', tabs: ['finance', 'growth', 'activity', 'business'] },
  { key: 'risk', tabs: ['risk'] },
]

/** The views the overview reads its signals from. */
export const OVERVIEW_VIEWS = [
  'capacity',
  'pool',
  'quality',
  'finance',
  'risk',
] as const satisfies readonly InsightsView[]

// Thresholds the tabs color by and the overview raises signals at, so a
// signal there always matches a colored figure in its tab.

/** Below this many requests, a model's rates and percentiles are noise. */
export const SMALL_SAMPLE = 100

/** Debt within a dollar is rounding and test traffic; past it, someone owes. */
export const DEBT_ALERT_USD = -1

/** Pool statuses that need an operator, as the engine's own console groups them. */
export const ATTENTION = new Set([
  'reauthorization_required',
  'suspended',
  'blacklisted',
  'quota_observation_unavailable',
])

/** A failure rate above 5% needs action; above 2%, a look. */
export function failureTone(rate: number): Tone {
  if (rate > 0.05) return 'danger'
  if (rate > 0.02) return 'warning'
  return 'default'
}

/**
 * Address clusters without the viewer's own account: the operator's tests
 * from their own machine are not a risk signal. A cluster left with one
 * account is no longer shared.
 */
export function useSharedAddresses(insights: RiskInsights | undefined) {
  const viewer = useAuthStore((state) => state.auth.user?.id)
  return (insights?.shared_ips ?? [])
    .map((cluster) => ({
      ...cluster,
      users: cluster.users.filter((user) => user.user_id !== viewer),
    }))
    .filter((cluster) => cluster.users.length > 1)
}

/**
 * What one Claude account costs a month, in USD, by the plan and tier the
 * engine reports. Other plans, such as Gemini's Pro with no tier, have no
 * price here and are not counted.
 */
const ACCOUNT_PRICES: {
  plan: string
  tier: string
  label: string
  monthlyUSD: number
}[] = [
  { plan: 'Pro', tier: 'default_claude_ai', label: 'Pro', monthlyUSD: 20 },
  { plan: 'Pro', tier: 'default_claude_pro', label: 'Pro', monthlyUSD: 20 },
  {
    plan: 'Max',
    tier: 'default_claude_max_5x',
    label: 'Max 5x',
    monthlyUSD: 100,
  },
  {
    plan: 'Team',
    tier: 'team_standard',
    label: 'Team Standard',
    monthlyUSD: 25,
  },
  { plan: 'Team', tier: 'team_tier_1', label: 'Team Tier 1', monthlyUSD: 125 },
]

/** Days a monthly account price covers. */
export const PRICE_MONTH_DAYS = 30

export function accountPrice(plan: string, tier: string) {
  return ACCOUNT_PRICES.find(
    (price) => price.plan === plan && price.tier === tier
  )
}

/**
 * new-api prices its quota in dollars, but customers pay ¥1 for each quota
 * dollar, so what it charged is in yuan. In dollars, the unit the engine's
 * official cost and the account prices use, it is that over the site's USD
 * exchange rate. The finance response carries the rate; the status's rate
 * serves until the server sends it.
 */
export function useChargeFormat(
  data: Pick<FinanceInsights, 'usd_exchange_rate'> | undefined
) {
  const fmt = useInsightsFormat()
  const statusRate = useSystemConfigStore(
    (state) => state.config.currency.usdExchangeRate
  )
  const rate = data?.usd_exchange_rate || statusRate || 1
  return {
    rate,
    /** A charge in yuan, in dollars. */
    toUSD: (yuan: number) => yuan / rate,
    /** A charge given in dollars, as $x (¥y). */
    usd: (usd: number) => `${fmt.usd(usd)} (${fmt.cny(usd * rate)})`,
    /** As usd, with four places below a dollar. */
    usdFine: (usd: number) => `${fmt.usdFine(usd)} (${fmt.cny(usd * rate)})`,
  }
}

export const INSIGHTS_PRESETS = [1, 7, 30, 90, 365] as const

export function useInsightsFormat() {
  const { i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const number = new Intl.NumberFormat(locale)
  const usdFormat = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
  // Below a dollar, such as a charge per request, four places.
  const usdFineFormat = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  })
  const usdWholeFormat = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const usdCompactFormat = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const compactFormat = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const multipleFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const percent = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const day = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
  })
  const hour = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return {
    num: (value: number) => number.format(value),
    usd: (value: number) => usdFormat.format(value),
    usdFine: (value: number) =>
      Math.abs(value) >= 1
        ? usdFormat.format(value)
        : usdFineFormat.format(value),
    usdWhole: (value: number) => usdWholeFormat.format(Math.round(value)),
    // A debt reads -¥3.93, not ¥-3.93.
    cny: (value: number) =>
      value < 0 ? `-${formatPaymentMoney(-value)}` : formatPaymentMoney(value),
    /** Short forms for chart axes and bar labels. */
    usdCompact: (value: number) => usdCompactFormat.format(value),
    cnyCompact: (value: number) => `¥${compactFormat.format(value)}`,
    pct: (value: number) => percent.format(value),
    /** A price multiple, such as 1.95×. */
    multiple: (value: number) => `${multipleFormat.format(value)}×`,
    day: (unix: number) => day.format(new Date(unix * 1000)),
    time: (unix: number) => (unix ? hour.format(new Date(unix * 1000)) : '-'),
    ms: (value: number) =>
      value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`,
    /** A duration that is 0 only when nothing was measured. */
    measuredMs: (value: number) => {
      if (value <= 0) return '—'
      return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`
    },
  }
}

export function useErrorCategoryLabel() {
  const { t } = useTranslation()
  return (name: string) =>
    ({
      engine_concurrency: t('Engine account concurrency full'),
      upstream_rate_limit: t('Claude upstream rate limit'),
      upstream_overloaded: t('Claude upstream overloaded'),
      upstream_error: t('Upstream error'),
      client_error: t('Client error'),
      other: t('Other'),
    })[name] ?? name
}

export function useSignupMethodLabel() {
  const { t } = useTranslation()
  return (name: string) =>
    ({
      oidc: t('Google'),
      linuxdo: 'LinuxDO',
      github: 'GitHub',
      discord: 'Discord',
      telegram: 'Telegram',
      wechat: t('WeChat'),
      email: t('Email link'),
      password: t('Password'),
      all: t('All'),
      organic: t('Organic'),
      invited: t('Invited'),
    })[name] ?? name
}

export const PROVIDER_LABELS: Record<PoolProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  gemini: 'Gemini',
}

// Engine channels whose vendor differs from their name, for a server that
// does not yet send each group's provider.
const CHANNEL_PROVIDERS: Record<string, string> = { antigravity: 'gemini' }

/** The vendor a pool group's channel serves. */
export function groupProvider(group: { channel: string; provider?: string }) {
  return group.provider ?? CHANNEL_PROVIDERS[group.channel] ?? group.channel
}
