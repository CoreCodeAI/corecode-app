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
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { formatPaymentMoney } from '@/features/wallet/lib'
import { getPaymentMethodName } from '@/features/wallet/lib/billing'
import { toIntlLocale } from '@/i18n/languages'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { hourBars, type HourAxis, type HourBar } from './analysis'
import type { InsightsView } from './api'
import type { BarPoint, Tone } from './components/shared'
import type {
  ChannelRow,
  ErrorCategory,
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
  'upstream',
  'activity',
] as const satisfies readonly InsightsView[]

/** A range of this many days or fewer reads by the hour. */
export const HOURLY_MAX_DAYS = 3

const HOUR_SECONDS = 3600
const DAY_SECONDS = 86400

/**
 * The range a tab reads, in unix seconds. Its first hour counts whole, so
 * start is the top of an hour; its last hour is still filling when end is
 * now.
 */
export type InsightsRangeInfo = {
  start: number
  end: number
  days: number
  /** days <= HOURLY_MAX_DAYS: series are drawn per hour. */
  hourly: boolean
}

/** The top of the UTC hour a unix time falls in. */
export function hourStart(unix: number): number {
  return Math.floor(unix / HOUR_SECONDS) * HOUR_SECONDS
}

/**
 * Where a range of days ending at now starts: the top of the hour it starts
 * in, so "24 hours" is the same span on every tab. That hour counts whole,
 * and the range's hours run from it to the hour now is in.
 */
export function rangeStart(now: number, days: number): number {
  return hourStart(now - days * DAY_SECONDS)
}

/**
 * A range's length in seconds, whole days. The previous period has the same
 * length, so it is not range.end - range.start, which runs past the days by
 * the part of the hour the range starts in.
 */
export function rangeSpan(range: Pick<InsightsRangeInfo, 'days'>): number {
  return range.days * DAY_SECONDS
}

/** The hours a range's series hold: its first hour through the one now is in. */
export function rangeHours(range: Pick<InsightsRangeInfo, 'days'>): number {
  return range.days * 24 + 1
}

/**
 * The previous period of a range, as query bounds: the same span, ending
 * where the range starts, so the two share no hour.
 */
export function previousRange(
  range: Pick<InsightsRangeInfo, 'start' | 'days'>
): {
  start_time: number
  end_time: number
} {
  return { start_time: range.start - rangeSpan(range), end_time: range.start }
}

/**
 * Whether the range reaches before the logs begin, so part of it has no
 * data. Zero means the log table is empty: its zeros are true zeros, so
 * nothing is before the logs then.
 */
export function rangeReachesBeforeLogs(
  range: Pick<InsightsRangeInfo, 'start'>,
  logsSince: number | null | undefined
): boolean {
  return logsSince != null && logsSince > 0 && range.start < logsSince
}

/**
 * Whether the previous period of a range has no data to compare with: the
 * logs begin inside it or after its start, so part or all of it is before
 * them. A partly logged period would read as a false change, so it is
 * "no data to compare" too.
 */
export function previousBeforeLogs(
  range: Pick<InsightsRangeInfo, 'start' | 'days'>,
  logsSince: number | null | undefined
): boolean {
  return (
    logsSince != null &&
    logsSince > 0 &&
    logsSince > range.start - rangeSpan(range)
  )
}

/**
 * The days of a range that have logs, for a per-day average: a day the logs
 * begin in counts whole. Without logs_since, every day of the range does.
 */
export function loggedDays(
  range: InsightsRangeInfo,
  logsSince: number | null | undefined
): number {
  if (logsSince == null || logsSince <= 0) return range.days
  const covered = Math.ceil(
    (range.end - Math.max(range.start, logsSince)) / DAY_SECONDS
  )
  return Math.min(range.days, Math.max(0, covered))
}

// Thresholds the tabs color by and the overview raises signals at, so a
// signal there always matches a colored figure in its tab.

/** Below this many requests, a model's rates and percentiles are noise. */
export const SMALL_SAMPLE = 100

/** Below this many requests in one hour, the hour has no rate. */
export const HOUR_SAMPLE = 20

/** An hourly count at this multiple of its baseline is a spike. */
export const SPIKE_FACTOR = 3

/** The fewest events an hour needs to count as a spike. */
export const SPIKE_FLOOR = 20

/** The fewest sign-ups an hour needs to count as a spike. */
export const SIGNUP_SPIKE_FLOOR = 5

/** The last closed hour under this share of its baseline may be an outage. */
export const DROP_SHARE = 0.5

/** Under this many orders in either period, revenue moves by amount, not percent. */
export const MIN_ORDERS = 5

/** Under this many sign-ups, a funnel or conversion rate is not colored. */
export const MIN_COHORT = 20

/** One customer past this share of consumption is a concentration risk. */
export const CONCENTRATION_SHARE = 0.3

/** Gifted credit past this share of consumption needs a look. */
export const GIFT_SHARE_WARN = 0.3

/** An upstream bill read longer ago than this leaves recent revenue uncosted. */
export const COST_STALE_SECONDS = 1800

/** A channel's ROI over a shorter range than this is not judged. */
export const SHORT_ROI_DAYS = 7

/** An hour whose peak passed this share of the pool's slots was near full. */
export const HEADROOM_SHARE = 0.8

/** Debt within a dollar is rounding and test traffic; past it, someone owes. */
export const DEBT_ALERT_USD = -1

/** Below this many finished tasks, a task failure rate is not colored or ranked. */
export const MIN_TASKS = 20

/** A task still running this long after submission is stalled, as the server counts it. */
export const STALLED_TASK_SECONDS = 1800

/** Below this many checkouts opened, an order completion rate is not colored. */
export const MIN_CHECKOUTS = 10

/** A checkout still pending this long after it opened is stale, as the server counts it. */
export const PENDING_STALE_SECONDS = 3600

/** Plans ending within this many days are expiring, as the server counts them. */
export const EXPIRING_PLAN_DAYS = 7

/** A page open this long past its range's end says its figures are from then. */
export const STALE_VIEW_SECONDS = 300

/** The engine's own refusals: its slots, caps and budgets, not an upstream's. */
export const ENGINE_CATEGORIES: readonly ErrorCategory[] = [
  'engine_concurrency',
  'engine_limit',
  'engine_budget',
]

/**
 * Failures the customer caused: their request, not the site or a channel,
 * is at fault. no_channel is not one: it is the site's routing.
 */
export const CLIENT_CATEGORIES: readonly ErrorCategory[] = ['client_error']

/** Where one query of a tab stands, and its error message once it failed. */
export type SourceState = {
  status: 'pending' | 'error' | 'success'
  error?: string
}

/**
 * The queries a tab reads, so it can tell a figure still loading from one
 * that failed and from one that is truly empty. business and
 * businessPrevious are set on the tabs that read the business view.
 */
export type InsightsSources = {
  view: SourceState
  previous: SourceState
  business?: SourceState
  businessPrevious?: SourceState
}

/** A query's state as a SourceState; a disabled query reads as pending. */
export function sourceState(query: {
  status: 'pending' | 'error' | 'success'
  error: unknown
}): SourceState {
  if (query.status !== 'error') return { status: query.status }
  return {
    status: 'error',
    error: query.error instanceof Error ? query.error.message : undefined,
  }
}

/**
 * The state a table or breakdown fed by this source shows instead of its
 * rows: loading while pending with no rows, failed when it errored with no
 * rows. Undefined once there are rows to show (an earlier read's rows stay
 * on screen through a failed refetch) or the source has loaded.
 */
export function tableState(
  source: SourceState | undefined,
  rows: unknown
): 'loading' | 'error' | undefined {
  if (rows != null || !source) return undefined
  if (source.status === 'error') return 'error'
  if (source.status === 'pending') return 'loading'
  return undefined
}

/** Pool statuses that need an operator, as the engine's own console groups them. */
export const ATTENTION = new Set([
  'reauthorization_required',
  'suspended',
  'blacklisted',
  'quota_observation_unavailable',
])

/** The text color of each tone. */
export const TONES: Record<Tone, string> = {
  default: '',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
  good: 'text-emerald-600 dark:text-emerald-400',
}

/** Each tab's name, as the tab row prints it. */
export function useTabLabel(): (tab: InsightsTab) => string {
  const { t } = useTranslation()
  const labels: Record<InsightsTab, string> = {
    overview: t('Overview'),
    capacity: t('Capacity'),
    pool: t('Account pool'),
    quality: t('Service quality'),
    finance: t('Funds'),
    growth: t('Growth'),
    channels: t('Promotion channels'),
    upstream: t('Upstreams'),
    activity: t('Activity & retention'),
    risk: t('Risk'),
  }
  return (tab) => labels[tab]
}

/**
 * The hour formats for a bar series: an hour's full title, and an axis
 * label only where the viewer's day starts. bars is hourBars bound to them.
 */
export function useHourAxis(): HourAxis & {
  bars: <T extends { hour: number }>(
    rows: T[] | null | undefined,
    end: number,
    build: (row: T, index: number) => HourBar,
    logsSince?: number | null
  ) => BarPoint[]
} {
  const fmt = useInsightsFormat()
  const axis: HourAxis = {
    title: (hour) => fmt.time(hour),
    axis: (hour) =>
      new Date(hour * 1000).getHours() === 0 ? fmt.day(hour) : undefined,
  }
  return {
    ...axis,
    bars: (rows, end, build, logsSince) =>
      hourBars(rows, end, build, axis, logsSince),
  }
}

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
  const clock = new Intl.DateTimeFormat(locale, {
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
    /** The time of day alone, for an axis within one day. */
    clock: (unix: number) => clock.format(new Date(unix * 1000)),
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
  const labels: Record<ErrorCategory, string> = {
    engine_concurrency: t('Engine account concurrency full'),
    engine_limit: t('Engine concurrency or rate cap'),
    engine_budget: t('Engine account budget'),
    upstream_rate_limit: t('Claude upstream rate limit'),
    upstream_overloaded: t('Claude upstream overloaded'),
    upstream_auth: t('Upstream refused the key'),
    upstream_error: t('Upstream error'),
    client_error: t('Client error'),
    no_channel: t('No channel for the model'),
    other: t('Other'),
  }
  return (name: string) => labels[name as ErrorCategory] ?? name
}

/**
 * Whether a view counts each request once (rollup version 5) rather than
 * each try: a server of that version sends stale_hours, 0 included.
 */
export function countsRequestsOnce(
  data: { stale_hours?: number } | null | undefined
): boolean {
  return data?.stale_hours != null
}

/**
 * The definitions that recur across tabs, one sentence each, so a name
 * means one thing wherever it is printed. A figure's help joins the one it
 * rests on with its own sentences (joinSentences). now and allTime are short
 * hints for a figure that does not follow the range.
 */
export function useInsightsDefinitions() {
  const { t } = useTranslation()
  return {
    requests: t(
      'A request is counted once, however many channels it tried; it failed only when no channel served it.'
    ),
    requestsAsAttempts: t(
      'Each try on a channel counts as a request here, so a request retried on another channel counts twice, and a failover that worked still counts one failure.'
    ),
    attempts: t(
      'Attempts count every try on a channel: a request retried on another channel is one request and two attempts.'
    ),
    customers: t(
      "Customers are every account but root and staff, so the operator's tests are left out."
    ),
    everyone: t('Everyone includes root and staff.'),
    sitePeak: t(
      "The site's peak is the most requests in flight at once on every channel: the pool, paid upstreams and the media supplier."
    ),
    poolPeak: t(
      "The pool's peak counts only successful requests the pool's accounts served, so it is the one to read against the pool's slots."
    ),
    paidRevenue: t(
      'Revenue is money paid in the range, counted when the order was paid.'
    ),
    earnedRevenue: t(
      'The part of all money paid that this range earned. A plan earns its price evenly over the days it runs; a wallet earns as it is spent, each dollar at what its owner paid per dollar credited, gifts included. Given credit earns nothing.'
    ),
    estimatedRevenue: t(
      "An estimate: the range's revenue earned shared out by each part's share of consumption, not money that part paid."
    ),
    listCharge: t(
      "Consumption is credit spent at the site's list prices, given credit included: what was charged, not money received."
    ),
    upstreamBill: t(
      "An upstream's bill is in that upstream's own quota dollars, compared with revenue one for one."
    ),
    fee: t('A monthly fee is in real US dollars.'),
    live: t('Live: as it stands now, whatever the range.'),
    allTimeHelp: t('As it stands now, over all time, whatever the range.'),
    now: t('Now'),
    allTime: t('All time'),
  }
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

/**
 * Each vendor keeps its color whatever else is on the chart. media is image
 * and video models, sold apart from the pool's vendors.
 */
export const VENDOR_ORDER = [
  'claude',
  'codex',
  'grok',
  'gemini',
  'media',
  'other',
]

// Past the four categorical slots: a deeper step of the third, told from it
// by lightness, since Grok and media rarely share a chart.
const MEDIA_COLOR: SeriesColor =
  'color-mix(in oklab, var(--series-3) 60%, var(--foreground))'

export function vendorColor(vendor: string): SeriesColor {
  if (vendor === 'media') return MEDIA_COLOR
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
    media: t('Image and video'),
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

/**
 * The vendors in the order the margin lists them; other models last. media
 * has no pool accounts, so its account cost is 0; its cost is the upstream
 * bill.
 */
export const MARGIN_VENDORS = [
  'claude',
  'codex',
  'grok',
  'gemini',
  'media',
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
  // The range's whole days: its start is floored to the hour, so the raw span
  // runs past them by the part of an hour.
  const days = Math.max(
    Math.round(((data.end_time ?? 0) - (data.start_time ?? 0)) / 86400),
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

/**
 * A payment method's name as the page prints it. Stripe's own methods name
 * the gateway and the method; the rest take the wallet's names.
 */
export function paymentMethodLabel(method: string, t: TFunction): string {
  const viaStripe: Record<string, string> = {
    stripe_alipay: t('Alipay'),
    stripe_wechat_pay: t('WeChat Pay'),
    stripe_card: t('Card'),
  }
  if (viaStripe[method]) return `Stripe · ${viaStripe[method]}`
  if (method === 'nowpayments') return 'NOWPayments'
  return getPaymentMethodName(method, t) || method
}

/** A pool status that needs an operator, as the account pool tab names it. */
export function attentionLabel(status: string, t: TFunction): string {
  const labels: Record<string, string> = {
    reauthorization_required: t('Needs reauthorization'),
    suspended: t('Suspended'),
    blacklisted: t('Blacklisted'),
    quota_observation_unavailable: t('No quota reading'),
  }
  return labels[status] ?? status
}
