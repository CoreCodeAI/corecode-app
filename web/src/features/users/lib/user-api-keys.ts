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
import type { UserApiKey } from '../types'

/** Counts keys per group, largest first; '' is the keys that follow the user's group. */
export function countKeysByGroup(
  keys: UserApiKey[]
): Array<{ group: string; count: number }> {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const group = key.group?.trim() ?? ''
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group))
}
