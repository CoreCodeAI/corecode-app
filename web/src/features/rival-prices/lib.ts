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
import type {
  RivalBoard,
  RivalBoardPrice,
  RivalKind,
  RivalSite,
  RivalTrust,
} from './types'

export type Metric = 'blended' | 'input'

export type BoardOptions = {
  /** Only groups of this kind; 'all' for every kind. */
  kind: RivalKind | 'all'
  metric: Metric
  /** Rank sites whose top-up price cannot be trusted. */
  includeUntrusted: boolean
}

/** One line of the board: a site's cheapest group, or one of our groups. */
export type BoardRow = {
  key: string
  ours: boolean
  name: string
  url: string
  group: string
  kind: RivalKind
  groupRatio: number
  /** CNY per million tokens; null when the site's top-up price is unknown. */
  input: number | null
  blended: number | null
  cacheRead: number | null
  cacheRatio: number | null
  /** The ranked figure as a share of the official one. */
  share: number | null
  topUpPrice: number
  trust: RivalTrust
  /** Every group of the site in the chosen kind, cheapest first. */
  groups: RivalBoardPrice[]
  site?: RivalSite
}

function metricOf(
  metric: Metric,
  input: number | null,
  blended: number | null
): number | null {
  return metric === 'blended' ? blended : input
}

/** Ranks by the metric; a row without one goes last, by group ratio. */
function byMetric(
  metric: Metric
): (
  a: { input: number | null; blended: number | null; groupRatio: number },
  b: { input: number | null; blended: number | null; groupRatio: number }
) => number {
  return (a, b) => {
    const x = metricOf(metric, a.input, a.blended)
    const y = metricOf(metric, b.input, b.blended)
    if (x != null && y != null) return x - y
    if (x != null) return -1
    if (y != null) return 1
    return a.groupRatio - b.groupRatio
  }
}

/** The metric falls back to input when the board has no traffic mix. */
export function effectiveMetric(board: RivalBoard, metric: Metric): Metric {
  const official = board.models.find((m) => m.model === board.model)
  return metric === 'blended' && official?.blended_cny == null
    ? 'input'
    : metric
}

/**
 * Builds the board for the selected model: each site at its cheapest group
 * of the chosen kind, and our groups, ranked by the metric and priced against
 * the official figure. Untrusted sites are left out unless asked for.
 */
export function buildBoardRows(
  board: RivalBoard,
  options: BoardOptions
): BoardRow[] {
  const metric = effectiveMetric(board, options.metric)
  const official = board.models.find((m) => m.model === board.model)
  const officialFigure =
    metric === 'blended' ? official?.blended_cny : official?.input_cny
  const share = (value: number | null) =>
    value != null && officialFigure ? value / officialFigure : null
  const inKind = (kind: RivalKind) =>
    options.kind === 'all' || kind === options.kind

  const rows: BoardRow[] = []
  for (const own of board.ours ?? []) {
    if (!inKind(own.kind)) continue
    rows.push({
      key: `ours:${own.group}`,
      ours: true,
      name: 'CoreCode',
      url: '',
      group: own.group,
      kind: own.kind,
      groupRatio: own.group_ratio,
      input: own.input_cny,
      blended: own.blended_cny,
      cacheRead: own.cache_read_cny,
      cacheRatio: own.cache_ratio,
      share: share(metricOf(metric, own.input_cny, own.blended_cny)),
      topUpPrice: board.top_up_price,
      trust: 'ok',
      groups: [],
    })
  }
  for (const site of board.sites) {
    if (!options.includeUntrusted && site.trust !== 'ok') continue
    const groups = site.prices
      .filter((p) => inKind(p.kind))
      .map((p) => ({
        p,
        input: p.input_cny,
        blended: p.blended_cny,
        groupRatio: p.group_ratio,
      }))
      .sort(byMetric(metric))
      .map((x) => x.p)
    const best = groups[0]
    if (!best) continue
    rows.push({
      key: `site:${site.id}`,
      ours: false,
      name: site.name || site.slug,
      url: site.site_url || site.api_base,
      group: best.group,
      kind: best.kind,
      groupRatio: best.group_ratio,
      input: best.input_cny,
      blended: best.blended_cny,
      cacheRead: best.cache_read_cny,
      cacheRatio: best.cache_ratio,
      share: share(metricOf(metric, best.input_cny, best.blended_cny)),
      topUpPrice: site.top_up_price,
      trust: site.trust,
      groups,
      site,
    })
  }
  return rows.sort(byMetric(metric))
}

export type BoardStats = {
  /** Other sites with a figure. */
  sites: number
  p10: number | null
  median: number | null
  p90: number | null
  cheapest: number | null
  /** Our cheapest figure. */
  ours: number | null
  /** Sites cheaper than our cheapest. */
  cheaper: number
  /** Our cheapest as a percentile among the sites, 0 = cheapest of all. */
  percentile: number | null
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** The spread of the other sites' figures, and where our cheapest falls. */
export function boardStats(
  rows: BoardRow[],
  board: RivalBoard,
  metric: Metric
): BoardStats {
  const m = effectiveMetric(board, metric)
  const figures = rows
    .filter((r) => !r.ours)
    .map((r) => metricOf(m, r.input, r.blended))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)
  const oursList = rows
    .filter((r) => r.ours)
    .map((r) => metricOf(m, r.input, r.blended))
    .filter((v): v is number => v != null)
  const ours = oursList.length > 0 ? Math.min(...oursList) : null
  const cheaper = ours == null ? 0 : figures.filter((v) => v < ours).length
  return {
    sites: figures.length,
    p10: quantile(figures, 0.1),
    median: quantile(figures, 0.5),
    p90: quantile(figures, 0.9),
    cheapest: figures[0] ?? null,
    ours,
    cheaper,
    percentile:
      ours == null || figures.length === 0 ? null : cheaper / figures.length,
  }
}

export function formatCNY(value: number | null | undefined): string {
  if (value == null) return '-'
  return `¥${value < 1 ? value.toFixed(3) : value.toFixed(2)}`
}

export function formatShare(value: number | null | undefined): string {
  if (value == null) return '-'
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`
}
