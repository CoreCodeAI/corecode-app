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

import {
  kindRequests,
  kindUsd,
  unheard,
  unreadFrom,
  UNANSWERED_ALERT,
  WASTE_KINDS,
  WASTE_SHARE_ALERT,
  WASTE_SHARE_WARN,
  wasteShare,
} from '../components/experience-analysis'
import type { Tone } from '../components/shared'
import { useInsightsFormat, type InsightsRangeInfo } from '../lib'
import type { ExperienceInsights, WasteKind } from '../types'
import { chipList, sentences, worse, type TabVerdict } from './shared'

/** What a waiting time reads as: minutes under an hour, hours under two days, else days. */
export function useWaitFormat(): (seconds: number) => string {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  return (seconds) => {
    if (seconds < 3600) {
      return t('{{count}} min', {
        count: fmt.num(Math.max(1, Math.round(seconds / 60))),
      })
    }
    if (seconds < 2 * 86400) {
      return t('{{count}} h', {
        count: fmt.num(Math.round(seconds / 360) / 10),
      })
    }
    return t('{{count}} d', { count: fmt.num(Math.round(seconds / 8640) / 10) })
  }
}

/** A report category's name, as the feedback pages print it. */
export function useCategoryLabel(): (name: string) => string {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    bug: t('Bug'),
    suggestion: t('Suggestion'),
    billing: t('Billing issue'),
    other: t('Other'),
  }
  return (name) => labels[name] ?? name
}

/** A report status's name, as the feedback pages print it. */
export function useStatusLabel(): (name: string) => string {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    pending: t('Pending'),
    processing: t('In progress'),
    resolved: t('Resolved'),
    invalid: t('Invalid'),
  }
  return (name) => labels[name] ?? name
}

/** The kinds of waste named in words. */
export function useWasteKindLabel(): (kind: string) => string {
  const { t } = useTranslation()
  const labels: Record<WasteKind, string> = {
    refusal: t('Refused but charged'),
    failed_billed: t('Failed but charged'),
    gate_wallet: t('Plan gate charged the wallet'),
    cache_1h: t('1h cache never reused'),
  }
  return (kind) => labels[kind as WasteKind] ?? kind
}

export function useExperienceVerdict(
  data: ExperienceInsights | undefined,
  range?: Pick<InsightsRangeInfo, 'start' | 'days'>
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const wait = useWaitFormat()
  const kindLabel = useWasteKindLabel()
  if (!data) return undefined
  const { waste, feedback } = data
  const share = wasteShare(waste)
  const refusals = kindRequests(waste, 'refusal')
  const largest = WASTE_KINDS.map((kind) => ({
    kind,
    usd: kindUsd(waste, kind),
  })).reduce((best, item) => (item.usd > best.usd ? item : best))
  const unheardCount = unheard(waste)
  const unread = unreadFrom(waste, range)

  let tone: Tone = 'good'
  if (share != null && share >= WASTE_SHARE_WARN) tone = 'warning'
  if (share != null && share >= WASTE_SHARE_ALERT) tone = 'danger'
  if (feedback.unanswered_24h > 0) tone = worse(tone, 'warning')
  if (feedback.unanswered_24h >= UNANSWERED_ALERT) tone = worse(tone, 'danger')

  const headline =
    waste.total_usd > 0
      ? t(
          'Customers paid {{amount}} for nothing, {{share}} of what they consumed.',
          {
            amount: fmt.usd(waste.total_usd),
            share: share == null ? '-' : fmt.pct(share),
          }
        )
      : t('No wasted money found in this range.')
  return {
    tone,
    chips: chipList(
      {
        label: t('Wasted'),
        value: fmt.usd(waste.total_usd),
        tone: tone === 'good' ? 'good' : undefined,
      },
      refusals > 0 && {
        label: t('Refusals charged'),
        value: fmt.num(refusals),
        tone: 'warning',
      },
      {
        label: t('Reports'),
        value: fmt.num(feedback.total),
      },
      feedback.unanswered_24h > 0 && {
        label: t('Unanswered over 24 hours'),
        value: fmt.num(feedback.unanswered_24h),
        tone:
          feedback.unanswered_24h >= UNANSWERED_ALERT ? 'danger' : 'warning',
      },
      feedback.unanswered_24h === 0 && {
        label: t('Unanswered over 24 hours'),
        value: '0',
        tone: 'good',
      }
    ),
    ...sentences(
      headline,
      largest.usd > 0 &&
        waste.total_usd > 0 &&
        t('Most of it was “{{kind}}”: {{amount}}.', {
          kind: kindLabel(largest.kind),
          amount: fmt.usd(largest.usd),
        }),
      unheardCount > 0 &&
        t(
          '{{count}} of the {{checked}} customers who lost most never filed a report.',
          { count: fmt.num(unheardCount), checked: fmt.num(waste.checked_top) }
        ),
      feedback.total > 0
        ? t('{{count}} reports were filed.', { count: fmt.num(feedback.total) })
        : t('No reports were filed in this range.'),
      feedback.replied > 0 &&
        t('The first reply took {{time}} at the median.', {
          time: wait(feedback.first_reply_p50),
        }),
      feedback.unanswered_24h > 0 &&
        t('{{count}} reports have waited more than a day with no reply.', {
          count: fmt.num(feedback.unanswered_24h),
        }),
      unread != null &&
        t(
          'Waste figures cover only from {{time}}: reading further back would be too slow.',
          { time: fmt.time(unread) }
        ),
      waste.total_usd > 0 &&
        t(
          'The 1h cache figure is an estimate: it counts writes no request of the same key followed within an hour.'
        )
    ),
  }
}
