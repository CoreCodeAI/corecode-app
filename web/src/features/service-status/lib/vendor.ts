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
 * CoreCode fork: the vendor behind each status group, for the card's logo
 * and the page's platform filter.
 */
import { resolveModelProvider } from '@/lib/model-provider'

import type { StatusGroup } from '../types'

export type GroupVendor = ReturnType<typeof resolveModelProvider>

/**
 * The busiest model names the vendor; a group with no traffic falls back to
 * its own name, such as WAN3.0.
 */
export function groupVendor(
  group: Pick<StatusGroup, 'name' | 'model'>
): GroupVendor {
  return (
    resolveModelProvider(group.model ?? '') ?? resolveModelProvider(group.name)
  )
}

/** The key of a group's vendor in the filter; '' for no known vendor. */
export function groupVendorKey(
  group: Pick<StatusGroup, 'name' | 'model'>
): string {
  return groupVendor(group)?.name ?? ''
}

export type VendorCount = {
  /** The vendor's name, or '' for groups no rule recognizes. */
  key: string
  icon: string | null
  count: number
}

/**
 * Each vendor with its number of groups, the largest first; ties keep the
 * order the groups come in. Groups of no known vendor come last.
 */
export function vendorCounts(
  groups: readonly Pick<StatusGroup, 'name' | 'model'>[]
): VendorCount[] {
  const counts = new Map<string, VendorCount>()
  for (const group of groups) {
    const vendor = groupVendor(group)
    const key = vendor?.name ?? ''
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { key, icon: vendor?.icon ?? null, count: 1 })
  }
  return [...counts.values()].sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1
    return b.count - a.count
  })
}
