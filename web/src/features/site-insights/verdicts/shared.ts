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

import type { Tone } from '../components/shared'
import { joinSentences, useInsightsFormat } from '../lib'

/** A tab's answer: one sentence and how it reads. */
export type TabVerdict = { tone: Tone; text: string }

/** The worse of two tones. */
export function worse(a: Tone, b: Tone): Tone {
  const order: Tone[] = ['good', 'default', 'warning', 'danger']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

/**
 * How a figure moved against the previous period, as a short phrase, or
 * null without one to compare with.
 */
export function useChange(): (
  current: number,
  previous: number | undefined
) => string | null {
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

export const join = joinSentences
