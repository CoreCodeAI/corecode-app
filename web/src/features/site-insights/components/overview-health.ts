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
import type { InsightsTab } from '../lib'
import { worse } from '../verdicts/shared'
import type { Finding } from './insight-kit'
import type { TabVerdicts } from './overview-verdicts'
import type { Tone } from './shared'

/** The tabs the status bar marks, in the order the page lists them. */
export const HEALTH_TABS = [
  'capacity',
  'pool',
  'quality',
  'upstream',
  'finance',
  'risk',
] as const satisfies readonly InsightsTab[]

/** Red findings listed before the reader asks for the rest. */
export const URGENT_SHOWN = 3

/** How many findings are red and how many amber. */
export function attentionCounts(signals: Finding[]) {
  return {
    danger: signals.filter((item) => item.tone === 'danger').length,
    warning: signals.filter((item) => item.tone === 'warning').length,
    total: signals.filter(
      (item) => item.tone === 'danger' || item.tone === 'warning'
    ).length,
  }
}

/**
 * How a tab reads: the worse of its own verdict and the findings that name
 * it. Undefined where neither has been read, which draws a grey dot.
 */
export function tabHealth(
  tab: InsightsTab,
  verdicts: TabVerdicts,
  signals: Finding[],
  read: boolean
): Tone | undefined {
  const verdict = verdicts.find(([name]) => name === tab)?.[1]
  const named = signals.filter((item) => item.tab === tab)
  if (!verdict && named.length === 0) return read ? 'good' : undefined
  return named.reduce<Tone>(
    (tone, item) => worse(tone, item.tone),
    verdict?.tone ?? 'good'
  )
}

