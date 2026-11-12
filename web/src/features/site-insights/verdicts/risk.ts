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
  grantedShare,
  hasRepeatBuyers,
  materialDebtors,
  MIN_SIGNAL_COUNT,
  rankClusters,
  riskRangeStart,
  riskSurges,
  sharedCounts,
  splitExits,
  suspectInviters,
  unpaidSpend,
  usesGiftPart,
  type ClusterRisk,
  type SignupSurge,
} from '../components/risk-analysis'
import type { Tone } from '../components/shared'
import {
  useInsightsFormat,
  useSharedAddresses,
  type InsightsRangeInfo,
} from '../lib'
import type { RiskInsights } from '../types'
import { join, type TabVerdict } from './shared'

/** One reason an address ranks where it does, as a badge reads it. */
export type ClusterReason = { key: string; text: string; tone: Tone }

/** The reasons behind a cluster's risk, most serious first. */
export function useClusterReasons(): (risk: ClusterRisk) => ClusterReason[] {
  const { t } = useTranslation()
  return (risk) => {
    const reasons: ClusterReason[] = []
    if (risk.buyers > 1) {
      reasons.push({
        key: 'buyers',
        tone: 'danger',
        text: risk.limited
          ? t('{{count}} recent buyers of one-per-user plans', {
              count: risk.buyers,
            })
          : t('{{count}} plan buyers', { count: risk.buyers }),
      })
    }
    if (risk.burst > 1) {
      reasons.push({
        key: 'burst',
        tone: 'warning',
        text: t('{{count}} registered within 10 minutes', {
          count: risk.burst,
        }),
      })
    }
    if (risk.fresh > 0) {
      reasons.push({
        key: 'fresh',
        tone: 'warning',
        text: t('{{count}} created in this range', { count: risk.fresh }),
      })
    }
    if (risk.empty > 0) {
      reasons.push({
        key: 'empty',
        tone: 'default',
        text: t('{{count}} unpaid with nothing left', { count: risk.empty }),
      })
    }
    if (risk.allPaid) {
      reasons.push({
        key: 'paid',
        tone: 'default',
        text: t('All paid: likely an office or a reseller'),
      })
    }
    return reasons
  }
}

/** A sign-up surge as one sentence: when, how many, and against what. */
export function useSurgeText(): (
  surge: SignupSurge,
  unit: 'hour' | 'day'
) => string {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  return (surge, unit) => {
    const values = {
      time: unit === 'day' ? fmt.day(surge.at) : fmt.time(surge.at),
      count: fmt.num(surge.count),
      times:
        surge.baseline > 0
          ? fmt.num(Math.round((surge.count / surge.baseline) * 10) / 10)
          : '',
    }
    if (surge.baseline <= 0) {
      return t(
        'Sign-ups surged at {{time}}: {{count}}, from almost none.',
        values
      )
    }
    if (surge.basis === 'same-hour') {
      return t(
        'Sign-ups surged at {{time}}: {{count}}, {{times}}× the same hour of the previous period.',
        values
      )
    }
    if (surge.basis === 'previous') {
      return unit === 'day'
        ? t(
            'Sign-ups surged at {{time}}: {{count}}, {{times}}× the previous period’s typical day.',
            values
          )
        : t(
            'Sign-ups surged at {{time}}: {{count}}, {{times}}× the previous period’s typical hour.',
            values
          )
    }
    return unit === 'day'
      ? t(
          'Sign-ups surged at {{time}}: {{count}}, {{times}}× a typical day in this range.',
          values
        )
      : t(
          'Sign-ups surged at {{time}}: {{count}}, {{times}}× a typical hour in this range.',
          values
        )
  }
}

/** The largest surge, the earliest of equals. */
export function largestSurge(surges: SignupSurge[]): SignupSurge | undefined {
  let best: SignupSurge | undefined
  for (const surge of surges) {
    if (!best || surge.count > best.count) best = surge
  }
  return best
}

export function useRiskVerdict(
  data: RiskInsights | undefined,
  previous?: RiskInsights,
  range?: InsightsRangeInfo
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const clusters = useSharedAddresses(data)
  const reasonsOf = useClusterReasons()
  const surgeText = useSurgeText()
  if (!data) return undefined
  const debtors = materialDebtors(data.debtors).length
  const buyers = hasRepeatBuyers(clusters)
  const shared = sharedCounts(data, clusters)
  const inviters = suspectInviters(data)
  const giftBased = usesGiftPart(data)
  const granted = grantedShare(unpaidSpend(data))
  const surge = largestSurge(riskSurges(data, previous, range))
  const [top] = rankClusters(
    splitExits(clusters).review,
    riskRangeStart(data, range)
  )
  const findings = [
    shared.total > 0 &&
      t('{{count}} addresses shared by several accounts', {
        count: shared.total,
      }),
    data.alias_emails > 0 &&
      t('{{count}} alias emails', { count: data.alias_emails }),
    data.off_whitelist > 0 &&
      t('{{count}} sign-ups off the email whitelist', {
        count: data.off_whitelist,
      }),
    inviters.unpaid > 0 &&
      (giftBased
        ? t(
            '{{count}} inviters with {{min}} or more unpaid spenders on gift credit',
            { count: inviters.unpaid, min: MIN_SIGNAL_COUNT }
          )
        : t('{{count}} inviters with {{min}} or more unpaid spenders', {
            count: inviters.unpaid,
            min: MIN_SIGNAL_COUNT,
          })),
    inviters.blocked > 0 &&
      t('{{count}} inviters with {{min}} or more blocked gifts', {
        count: inviters.blocked,
        min: MIN_SIGNAL_COUNT,
      }),
    debtors > 0 && t('{{count}} accounts in debt', { count: debtors }),
    buyers && t('an address with repeat plan buyers'),
  ].filter((item): item is string => !!item)
  const reasons =
    top && top.risk.score > 0
      ? reasonsOf(top.risk).map((reason) => reason.text)
      : []
  let tone: Tone = 'good'
  if (findings.length > 0 || surge) tone = 'warning'
  if (buyers) tone = 'danger'
  let summary: string | null = null
  if (findings.length > 0) {
    summary = t('To check: {{items}}.', { items: findings.join(t(', ')) })
  } else if (!surge) {
    summary = t('Nothing to check.')
  }
  // An information line, not a finding: the administrator's own grants.
  const handGranted =
    granted > 0.5 &&
    t(
      '{{share}} of unpaid spend was credit an administrator granted by hand.',
      {
        share: fmt.pct(granted),
      }
    )
  return {
    tone,
    text: join(
      t('{{count}} sign-ups.', { count: fmt.num(data.signups) }),
      surge && surgeText(surge, data.series_unit === 'day' ? 'day' : 'hour'),
      summary,
      handGranted,
      reasons.length > 0 &&
        top &&
        t('Review {{ip}} first: {{reasons}}.', {
          ip: top.ip,
          reasons: reasons.join(t(', ')),
        }),
      tone !== 'good' &&
        t('Act on accounts from Users, usage logs and Risk Control.')
    ),
  }
}
