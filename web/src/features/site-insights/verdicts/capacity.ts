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

import { diagnoseRejections, headroom, rangeEnd } from '../capacity-analysis'
import type { Tone } from '../components/shared'
import {
  HEADROOM_SHARE,
  useInsightsFormat,
  type InsightsRangeInfo,
} from '../lib'
import type { CapacityInsights } from '../types'
import { join, useChange, type TabVerdict } from './shared'

/**
 * The capacity tab's verdict over the slots in view: every pool slot, or one
 * provider's. The per-user limit is not split by provider, so a provider's
 * verdict leaves it out. With an hourly series it names the hour the engine
 * turned most away, why, and what to do.
 */
export function useCapacityVerdict(
  data: CapacityInsights | undefined,
  previous: CapacityInsights | undefined,
  scope?: { slots: number; userLimits: boolean },
  range?: InsightsRangeInfo
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
  const hourly = data.hourly ?? []
  const diagnosis = diagnoseRejections(hourly, slots)
  const room = headroom(hourly, slots, rangeEnd(range))
  let tone: Tone = 'good'
  if (slots && data.peak_concurrency > slots) tone = 'danger'
  else if (pool > 0) tone = 'danger'
  else if (limited > 0) tone = 'warning'
  const poolSentence = (): string => {
    const count = fmt.num(pool)
    if (!diagnosis) {
      return t('{{count}} turned away with the pool full.', { count })
    }
    const time = fmt.time(diagnosis.worst.hour)
    const peak = fmt.num(diagnosis.worst.peak)
    if (diagnosis.cause === 'saturation') {
      return t(
        '{{count}} turned away with the pool full, most at {{time}} with the peak at {{peak}} of {{slots}} slots: the pool is too small, add accounts.',
        { count, time, peak, slots: fmt.num(slots) }
      )
    }
    if (diagnosis.cause === 'eligibility') {
      return t(
        '{{count}} turned away with the pool full, most at {{time}} with the peak only {{peak}} of {{slots}} slots: too few accounts were schedulable (cooldowns or spent quota); check the account pool.',
        { count, time, peak, slots: fmt.num(slots) }
      )
    }
    return t('{{count}} turned away with the pool full, most at {{time}}.', {
      count,
      time,
    })
  }
  // Near-full hours matter most when nothing was turned away yet.
  const tightest = room?.tightest
  const headroomSentence =
    pool === 0 &&
    room &&
    room.near > 0 &&
    tightest &&
    t(
      "{{hours}} hours reached {{share}} of today's slots; the tightest, {{time}}, had {{free}} free.",
      {
        hours: fmt.num(room.near),
        share: fmt.pct(HEADROOM_SHARE),
        time: fmt.time(tightest.hour),
        free: fmt.num(Math.max(0, tightest.free)),
      }
    )
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
      headroomSentence,
      pool > 0 && poolSentence(),
      limited > 0 &&
        t('{{count}} turned away by per-user limits.', {
          count: fmt.num(limited),
        }),
      pool === 0 && limited === 0 && t('Nothing turned away.')
    ),
  }
}
