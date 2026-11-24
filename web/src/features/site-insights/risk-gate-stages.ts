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
import type { RiskInsights } from './types'

/** The risk gate's stages in the order a request passes them. */
export const GATE_STAGES = [
  'distill',
  'hard_regex',
  'refusal_cache',
  'decision',
] as const

export type GateBlockPoint = NonNullable<
  RiskInsights['gate_block_series']
>[number]

/**
 * The stages that blocked anything in the range, known ones in the order a
 * request passes them and then any stage a newer server adds, so a stage that
 * never fired takes no place in the legend.
 */
export function stagesSeen(series: GateBlockPoint[] | null | undefined) {
  const totals = new Map<string, number>()
  for (const point of series ?? []) {
    for (const [stage, count] of Object.entries(point.stages ?? {})) {
      totals.set(stage, (totals.get(stage) ?? 0) + count)
    }
  }
  const known = GATE_STAGES.filter((stage) => (totals.get(stage) ?? 0) > 0)
  const extra = [...totals.keys()]
    .filter(
      (stage) =>
        !(GATE_STAGES as readonly string[]).includes(stage) &&
        (totals.get(stage) ?? 0) > 0
    )
    .sort()
  return [...known, ...extra]
}

/** A point's blocks of every stage together. */
export function blocksAt(point: GateBlockPoint): number {
  return Object.values(point.stages ?? {}).reduce((sum, n) => sum + n, 0)
}
