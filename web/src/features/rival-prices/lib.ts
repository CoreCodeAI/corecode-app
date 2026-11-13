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
import type { RivalBoard, RivalPrice, RivalSite } from './types'

/** One line of the board: a site's cheapest group, or one of our groups. */
export type BoardRow = {
  key: string
  ours: boolean
  name: string
  url: string
  group: string
  groupRatio: number
  /** CNY per million tokens; null when the site's top-up price is unknown. */
  input: number | null
  output: number | null
  cacheRead: number | null
  /** input as a share of the official price; null when input is. */
  share: number | null
  topUpPrice: number
  /** Every group of the site, cheapest first. */
  groups: RivalPrice[]
  site?: RivalSite
}

/** Orders prices cheapest first; a price without a CNY figure goes last, by ratio. */
export function cheapestFirst(a: RivalPrice, b: RivalPrice): number {
  if (a.input_cny != null && b.input_cny != null) {
    return a.input_cny - b.input_cny
  }
  if (a.input_cny != null) return -1
  if (b.input_cny != null) return 1
  return a.model_ratio * a.group_ratio - b.model_ratio * b.group_ratio
}

/**
 * Builds the board for the selected model: each site at its cheapest group
 * and each of our groups, cheapest first, priced against the official
 * input price. Rows without a CNY price follow, as the site reported them.
 */
export function buildBoardRows(board: RivalBoard): BoardRow[] {
  const official = board.models.find((m) => m.model === board.model)
  const share = (input: number | null) =>
    input != null && official && official.input_cny > 0
      ? input / official.input_cny
      : null

  const rows: BoardRow[] = []
  for (const own of board.ours ?? []) {
    rows.push({
      key: `ours:${own.group}`,
      ours: true,
      name: 'CoreCode',
      url: '',
      group: own.group,
      groupRatio: own.group_ratio,
      input: own.input_cny,
      output: own.output_cny,
      cacheRead: own.cache_read_cny,
      share: share(own.input_cny),
      topUpPrice: board.top_up_price,
      groups: [],
    })
  }
  for (const site of board.sites) {
    const groups = [...site.prices].sort(cheapestFirst)
    const best = groups[0]
    if (!best) continue
    rows.push({
      key: `site:${site.id}`,
      ours: false,
      name: site.name || site.slug,
      url: site.site_url || site.api_base,
      group: best.group,
      groupRatio: best.group_ratio,
      input: best.input_cny,
      output: best.output_cny,
      cacheRead: best.cache_read_cny,
      share: share(best.input_cny),
      topUpPrice: site.top_up_price,
      groups,
      site,
    })
  }
  return rows.sort((a, b) => {
    if (a.input != null && b.input != null) return a.input - b.input
    if (a.input != null) return -1
    if (b.input != null) return 1
    return a.groupRatio - b.groupRatio
  })
}

/** Where our cheapest group places among the priced rows, 1-based. */
export function ourRank(rows: BoardRow[]): { rank: number; of: number } | null {
  const priced = rows.filter((r) => r.input != null)
  const first = priced.findIndex((r) => r.ours)
  if (first < 0) return null
  const others = priced.filter((r) => !r.ours).length
  return { rank: first + 1, of: others + 1 }
}

export function formatCNY(value: number | null): string {
  if (value == null) return '-'
  return `¥${value < 1 ? value.toFixed(3) : value.toFixed(2)}`
}

export function formatShare(value: number | null): string {
  if (value == null) return '-'
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`
}
