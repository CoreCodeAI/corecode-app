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

import { dominant, type Contribution } from '../analysis'
import type { Tone } from '../components/shared'
import {
  WEEK_SHARE_DAYS,
  customerMoves,
  judgedCohort,
  matureCohort,
  segmentChanges,
  signupBurst,
} from '../growth-analysis'
import {
  CONCENTRATION_SHARE,
  MIN_COHORT,
  useChargeFormat,
  useInsightsFormat,
  useSignupMethodLabel,
  type InsightsRangeInfo,
} from '../lib'
import type { ActivityInsights, GrowthInsights } from '../types'
import { join, useChange, type TabVerdict } from './shared'

/** Activation under this share of a judgeable cohort needs a look. */
export const ACTIVATION_WARN = 0.3

/**
 * Whether a cohort's activation and payment rates can be judged: it is old
 * enough (not a short range, where accounts are hours old) and large enough.
 */
export function cohortJudgeable(
  registered: number,
  range?: InsightsRangeInfo
): boolean {
  return !range?.hourly && registered >= MIN_COHORT
}

/**
 * The one or two segments that drove the change in sign-ups: by sign-up
 * method first, by referral when no method explains it.
 */
export function signupDrivers(
  data: GrowthInsights,
  previous: GrowthInsights | undefined
): Contribution[] {
  if (!previous) return []
  const total = data.funnel.registered - previous.funnel.registered
  const bySource = dominant(
    segmentChanges(data.by_source, previous.by_source),
    total
  )
  if (bySource.length > 0) return bySource
  return dominant(segmentChanges(data.by_invite, previous.by_invite), total)
}

export function useGrowthVerdict(
  data: GrowthInsights | undefined,
  previous: GrowthInsights | undefined,
  range?: InsightsRangeInfo
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const change = useChange()
  const label = useSignupMethodLabel()
  if (!data) return undefined
  const { registered } = data.funnel
  // Activation and payment are read over the sign-ups old enough to have
  // shown them; a range's newest hours of sign-ups have not had the time.
  const aged = matureCohort(data.daily, range)
  const { cohort } = judgedCohort(data.funnel, data.daily, range)
  const activation = cohort.registered
    ? cohort.activated / cohort.registered
    : 0
  const conversion = cohort.registered ? cohort.paid / cohort.registered : 0
  const judgeable = cohortJudgeable(cohort.registered, range)
  let tone: Tone = 'default'
  if (judgeable) tone = activation < ACTIVATION_WARN ? 'warning' : 'good'
  const signed = (value: number) =>
    value > 0 ? `+${fmt.num(value)}` : fmt.num(value)
  const drivers = signupDrivers(data, previous)
  const burst = range?.hourly ? signupBurst(data.hourly) : null
  // Payment timing and churn are judged only on a fair sample of payers.
  const timing = data.first_payment
  // A range under WEEK_SHARE_DAYS has not given its sign-ups a week to pay.
  const paceSentence =
    timing &&
    timing.payers >= MIN_COHORT &&
    (range?.days ?? WEEK_SHARE_DAYS) >= WEEK_SHARE_DAYS
      ? t(
          '{{day}} of payers paid within a day of signing up, {{week}} within a week.',
          {
            day: fmt.pct(timing.within_day),
            week: fmt.pct(timing.within_week),
          }
        )
      : false
  const quiet = data.payer_activity
  const recentPayers = (quiet?.active ?? 0) + (quiet?.lapsed ?? 0)
  const quietSentence =
    quiet && quiet.lapsed > 0 && recentPayers >= MIN_COHORT
      ? t(
          '{{count}} payers have gone quiet: {{share}} of the {{recent}} who used quota in the last 28 days.',
          {
            count: fmt.num(quiet.lapsed),
            share: fmt.pct(quiet.lapsed / recentPayers),
            recent: fmt.num(recentPayers),
          }
        )
      : false
  const rates = {
    activation: fmt.pct(activation),
    conversion: fmt.pct(conversion),
  }
  let ratesSentence: string | false = false
  if (registered > 0 && range?.hourly) {
    ratesSentence = t(
      '{{activation}} have activated and {{conversion}} paid so far; accounts hours old are too young to judge.',
      rates
    )
  } else if (registered > 0 && aged && aged.registered < MIN_COHORT) {
    ratesSentence = t(
      'Too few sign-ups at least 6 hours old to judge activation or payment.'
    )
  } else if (registered > 0 && !judgeable) {
    ratesSentence = t(
      '{{activation}} activated and {{conversion}} paid; too few sign-ups to judge.',
      rates
    )
  } else if (registered > 0 && aged && aged.registered < registered) {
    ratesSentence = t(
      '{{activation}} of sign-ups at least 6 hours old activated and {{conversion}} paid.',
      rates
    )
  } else if (registered > 0) {
    ratesSentence = t(
      '{{activation}} activated and {{conversion}} paid.',
      rates
    )
  }
  let driverSentence: string | false = false
  if (drivers.length === 1) {
    driverSentence = t('Driven by {{segment}} ({{change}}).', {
      segment: label(drivers[0].key),
      change: signed(drivers[0].change),
    })
  } else if (drivers.length === 2) {
    driverSentence = t(
      'Driven by {{segment}} ({{change}}) and {{segment2}} ({{change2}}).',
      {
        segment: label(drivers[0].key),
        change: signed(drivers[0].change),
        segment2: label(drivers[1].key),
        change2: signed(drivers[1].change),
      }
    )
  }
  return {
    tone,
    text: join(
      (() => {
        const moved = change(registered, previous?.funnel.registered)
        const count = fmt.num(registered)
        return moved
          ? t('{{count}} sign-ups ({{change}}).', { count, change: moved })
          : t('{{count}} sign-ups.', { count })
      })(),
      driverSentence,
      burst &&
        t(
          '{{share}} of them signed up in the hour from {{time}}: check the sign-up source.',
          { share: fmt.pct(burst.share), time: fmt.time(burst.hour) }
        ),
      ratesSentence,
      paceSentence,
      quietSentence
    ),
  }
}

/** The one or two listed customers that explain most of the change in consumption. */
export function consumptionDrivers(
  data: ActivityInsights,
  previous: ActivityInsights | undefined
): Contribution[] {
  if (!previous) return []
  return dominant(
    customerMoves(data.top_users, previous.top_users),
    data.quota_usd - previous.quota_usd
  )
}

export function useActivityVerdict(
  data: ActivityInsights | undefined,
  previous: ActivityInsights | undefined
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(data)
  const change = useChange()
  if (!data) return undefined
  const top = data.top_users[0]
  const name = (row: { user_id: number }) => {
    const user =
      data.top_users.find((item) => item.user_id === row.user_id) ??
      previous?.top_users.find((item) => item.user_id === row.user_id)
    return user?.username || `#${row.user_id}`
  }
  const signed = (yuan: number) => {
    const usd = fmt.usd(charge.toUSD(yuan))
    return yuan > 0 ? `+${usd}` : usd
  }
  const spendMoved = change(data.quota_usd, previous?.quota_usd)
  const flat =
    !previous?.quota_usd ||
    Math.abs(data.quota_usd / previous.quota_usd - 1) < 0.005
  const drivers = flat ? [] : consumptionDrivers(data, previous)
  let spendSentence: string | false = false
  if (spendMoved && drivers.length === 1) {
    spendSentence = t('Consumption {{change}}, mostly {{user}} ({{delta}}).', {
      change: spendMoved,
      user: name({ user_id: Number(drivers[0].key) }),
      delta: signed(drivers[0].change),
    })
  } else if (spendMoved && drivers.length === 2) {
    spendSentence = t(
      'Consumption {{change}}, mostly {{user}} ({{delta}}) and {{user2}} ({{delta2}}).',
      {
        change: spendMoved,
        user: name({ user_id: Number(drivers[0].key) }),
        delta: signed(drivers[0].change),
        user2: name({ user_id: Number(drivers[1].key) }),
        delta2: signed(drivers[1].change),
      }
    )
  }
  return {
    tone: data.top1_share > CONCENTRATION_SHARE ? 'warning' : 'good',
    text: join(
      (() => {
        const moved = change(data.active_users, previous?.active_users)
        const count = fmt.num(data.active_users)
        return moved
          ? t('{{count}} active users ({{change}}).', { count, change: moved })
          : t('{{count}} active users.', { count })
      })(),
      spendSentence,
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
