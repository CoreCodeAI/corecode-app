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
/** The most columns a wide screen gives a row of figures. */
export const METRIC_COLUMNS = 6

/** The widest a figure's card is drawn, in columns. */
export const METRIC_MAX_SPAN = 4

/**
 * How a wide screen lays out figures that take spans columns each (a
 * featured one takes two). Up to six columns' worth is one row of six, as
 * it always was. More is spread over the fewest rows, all as wide as each
 * other, and the cells left over widen the first featured figure, or else
 * the last one, so no row ends on a lone card beside a gap. When no width
 * fills every row, the six columns stay.
 */
export function metricLayout(spans: number[]): {
  columns: number
  spans: number[]
} {
  const units = spans.reduce((sum, span) => sum + span, 0)
  if (units <= METRIC_COLUMNS) return { columns: METRIC_COLUMNS, spans }
  const rows = Math.ceil(units / METRIC_COLUMNS)
  const featured = spans.findIndex((span) => span > 1)
  const widened = featured >= 0 ? featured : spans.length - 1
  for (
    let columns = Math.ceil(units / rows);
    columns <= METRIC_COLUMNS;
    columns++
  ) {
    const extra = rows * columns - units
    const next = spans.map((span, index) =>
      index === widened ? span + extra : span
    )
    if (next[widened] > METRIC_MAX_SPAN) continue
    // Cards are placed in order; one that does not fit starts a new row.
    let left = columns
    let filled = true
    for (const span of next) {
      if (span > left) {
        if (left !== columns) filled = false
        left = columns
      }
      left -= span
      if (left === 0) left = columns
    }
    if (filled && left === columns) return { columns, spans: next }
  }
  return { columns: METRIC_COLUMNS, spans }
}
