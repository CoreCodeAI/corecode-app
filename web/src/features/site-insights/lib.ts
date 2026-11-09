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
import type {
  ChannelRow,
  FinanceInsights,
  NamedCount,
  PoolProvider,
  RiskInsights,
} from './types'

/** A tab of the page: one view, or the overview that reads several. */
export type InsightsTab = 'overview' | Exclude<InsightsView, 'business'>

/** Tabs in the order shown, grouped by what they answer. */
export const INSIGHTS_TAB_GROUPS: { key: string; tabs: InsightsTab[] }[] = [
  { key: 'overview', tabs: ['overview'] },
  { key: 'operations', tabs: ['capacity', 'pool', 'quality', 'upstream'] },
  { key: 'business', tabs: ['finance', 'growth', 'channels', 'activity'] },
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
/**
 * Sentences as one paragraph: a space after each, except after the
 * full-width punctuation that ends a Chinese or Japanese sentence.
 */
export function joinSentences(...parts: (string | false | null | undefined)[]) {
  return parts
    .filter(Boolean)
    .join(' ')
    .replaceAll(/([。！？；：）])\s+/g, '$1')
}

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

/**
 * What one account of a vendor other than Claude costs a month, in US
 * dollars: Codex runs on ChatGPT Pro. A vendor missing here has no recorded
 * price, and its accounts count as free.
 */
const VENDOR_ACCOUNT_MONTHLY_USD: Record<string, number> = {
  codex: 200,
}

/**
 * What one pool account costs a month, in US dollars: a Claude account by
 * its plan and tier, another vendor's by the vendor. Undefined without a
 * recorded price.
 */
export function accountMonthlyUSD(
  vendor: string,
  plan: string,
  tier: string
): number | undefined {
  if (vendor === 'claude') return accountPrice(plan, tier)?.monthlyUSD
  return VENDOR_ACCOUNT_MONTHLY_USD[vendor]
}

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

/** The color a series wears, as a CSS color for a fill or a stroke. */
export type SeriesColor = string

// Categorical slots in their fixed order. Each is stepped for the light and
// the dark surface in corecode-brand.css and checked for color-blind
// separation between neighbours.
export const SERIES_COLORS: SeriesColor[] = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
]

/** Whatever is folded together reads as gray, never as a series. */
export const OTHER_COLOR: SeriesColor =
  'color-mix(in oklab, var(--muted-foreground) 45%, transparent)'

/** Each vendor keeps its color whatever else is on the chart. */
export const VENDOR_ORDER = ['claude', 'codex', 'grok', 'gemini', 'other']

export function vendorColor(vendor: string): SeriesColor {
  const index = VENDOR_ORDER.indexOf(vendor)
  return index >= 0 && index < SERIES_COLORS.length
    ? SERIES_COLORS[index]
    : OTHER_COLOR
}

export type WeekCell = {
  /** Monday is 0, in the viewer's time zone. */
  weekday: number
  hour: number
  /** The highest value the slot reached on any day. */
  max: number
  /** The slot's mean over the days that had it. */
  mean: number
  days: number
}

/**
 * Folds an hourly series into the week: one cell per weekday and hour, so a
 * daily or weekly rhythm shows as a band across the grid.
 */
export function foldIntoWeek(
  points: { hour: number; value: number }[]
): WeekCell[] {
  const cells = new Map<string, WeekCell & { sum: number }>()
  for (const point of points) {
    const date = new Date(point.hour * 1000)
    const weekday = (date.getDay() + 6) % 7
    const hour = date.getHours()
    const key = `${weekday}-${hour}`
    const cell = cells.get(key) ?? {
      weekday,
      hour,
      max: 0,
      mean: 0,
      days: 0,
      sum: 0,
    }
    cell.max = Math.max(cell.max, point.value)
    cell.sum += point.value
    cell.days += 1
    cell.mean = cell.sum / cell.days
    cells.set(key, cell)
  }
  return [...cells.values()].map(({ sum: _sum, ...cell }) => cell)
}

/**
 * Revenue by payment method as share slices. A method takes its slot in name
 * order, so its color holds while the same methods are paid with.
 */
export function paymentSlices(
  methods: { payment_method: string; money: number }[] | null | undefined,
  name: (method: string) => string
) {
  return [...(methods ?? [])]
    .sort((a, b) => a.payment_method.localeCompare(b.payment_method))
    .map((row, index) => ({
      key: row.payment_method,
      label: name(row.payment_method),
      value: row.money,
      color: SERIES_COLORS[index] ?? OTHER_COLOR,
    }))
}

/** A vendor's name as the tabs print it; GPT models sell as codex. */
export function useVendorName() {
  const { t } = useTranslation()
  const names: Record<string, string> = {
    claude: 'Claude',
    codex: 'GPT',
    grok: 'Grok',
    gemini: 'Gemini',
    other: t('Other models'),
  }
  return (vendor: string) => names[vendor] ?? vendor
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

/** The vendors in the order the margin lists them; other models last. */
export const MARGIN_VENDORS = [
  'claude',
  'codex',
  'grok',
  'gemini',
  'other',
] as const

export type VendorMarginRow = {
  vendor: string
  revenue: number
  cost: number
  margin: number
  accounts: number
  unpriced: number
}

/**
 * Revenue earned against what the pool's accounts cost, by vendor, in yuan.
 * Revenue is the server's recognized revenue shared out by each vendor's
 * part of customers' consumption; cost is each listed account's monthly
 * price over the range's days, at the site's exchange rate.
 */
export function vendorMargins(
  data: FinanceInsights,
  rate: number
): VendorMarginRow[] {
  const days = Math.max(
    ((data.end_time ?? 0) - (data.start_time ?? 0)) / 86400,
    0
  )
  const rows = new Map<string, VendorMarginRow>()
  const row = (vendor: string) => {
    let found = rows.get(vendor)
    if (!found) {
      found = {
        vendor,
        revenue: 0,
        cost: 0,
        margin: 0,
        accounts: 0,
        unpriced: 0,
      }
      rows.set(vendor, found)
    }
    return found
  }
  for (const item of data.vendor_revenue ?? []) {
    row(item.vendor).revenue += item.recognized_revenue
  }
  for (const plan of data.plan_accounts ?? []) {
    if (!plan.vendor) continue
    const target = row(plan.vendor)
    target.accounts += plan.accounts
    const monthly = accountMonthlyUSD(plan.vendor, plan.plan, plan.tier)
    if (monthly == null) {
      target.unpriced += plan.accounts
      continue
    }
    target.cost += (monthly * plan.accounts * days * rate) / PRICE_MONTH_DAYS
  }
  return [...rows.values()]
    .map((item) => ({ ...item, margin: item.revenue - item.cost }))
    .filter((item) => item.revenue > 0 || item.accounts > 0)
    .sort(
      (a, b) =>
        MARGIN_VENDORS.indexOf(a.vendor as never) -
        MARGIN_VENDORS.indexOf(b.vendor as never)
    )
}

/**
 * Splits client names such as claude-cli/2.1.3 into the client and its
 * version, and counts requests by client.
 */
export function clientFamilies(items: NamedCount[] | null | undefined) {
  const families = new Map<string, number>()
  for (const item of items ?? []) {
    const family = item.name.split('/')[0] || item.name
    families.set(family, (families.get(family) ?? 0) + item.count)
  }
  return [...families.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** How often the pool tab can refresh, in seconds; 0 turns it off. */
export const POOL_REFRESH_CHOICES = [5, 10, 15, 30, 60, 300, 0] as const
export const POOL_REFRESH_DEFAULT = 15
const POOL_REFRESH_KEY = 'site-insights:pool-refresh-seconds'

/** The pool tab's refresh interval this browser last chose. */
export function readPoolRefresh(): number {
  try {
    const stored = localStorage.getItem(POOL_REFRESH_KEY)
    const seconds = stored === null ? Number.NaN : Number(stored)
    return (POOL_REFRESH_CHOICES as readonly number[]).includes(seconds)
      ? seconds
      : POOL_REFRESH_DEFAULT
  } catch {
    return POOL_REFRESH_DEFAULT
  }
}

export function writePoolRefresh(seconds: number) {
  try {
    localStorage.setItem(POOL_REFRESH_KEY, String(seconds))
  } catch {
    // Storage may be full or blocked; the choice then lasts for this visit.
  }
}

/**
 * A source's return over the range, in yuan. The fee is in US dollars and
 * converts at the site's rate; commission and given credit are quota
 * dollars, which customers buy at ¥1 each. A channel paid a fee keeps its
 * affiliate account only to attribute sign-ups, so its commission is not a
 * cost; a channel without a fee is paid by commission. ROI is net over the
 * fee, and cac the fee per account that paid for the first time in the
 * range; both are null without a fee.
 */
export function channelEconomics(row: ChannelRow, rate: number) {
  const fee = row.fee_usd * rate
  const commission = fee > 0 ? 0 : row.commission_usd
  const net = row.revenue - fee - commission - row.gift_consumption_usd
  return {
    fee,
    commission,
    net,
    roi: fee > 0 ? net / fee : null,
    cac: fee > 0 && row.new_payers > 0 ? fee / row.new_payers : null,
  }
}
