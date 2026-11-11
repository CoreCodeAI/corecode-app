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
/**
 * Whether a range is the one the logs page opens with: from the start of
 * today through the present. The default's end is an hour past the moment
 * it was taken, so it is not compared by timestamp; any end that still
 * reaches the present and stops within today (or that hour) counts, which
 * also covers the "Today" preset.
 */
export function isDefaultTimeRange(
  start: Date | undefined,
  end: Date | undefined,
  now: Date = new Date()
): boolean {
  if (!start || !end) return false
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  if (start.getTime() !== startOfToday.getTime()) return false
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  const latestEnd = Math.max(endOfToday.getTime(), now.getTime() + 3600 * 1000)
  return end.getTime() >= now.getTime() && end.getTime() <= latestEnd
}
