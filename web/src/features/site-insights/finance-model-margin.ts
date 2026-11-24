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
// The model margin panel's figures: what each model was charged, what it
// cost, and what is left, with how much of the charge has a known cost.

import { financeMargins } from './finance-analysis'
import type { FinanceInsights, ModelAllocation } from './types'

/** A model whose cost covers less than this share of its charge shows no margin. */
export const MODEL_MIN_COVERAGE = 0.5

/** A margin rate under this reads as thin: a model that brings traffic, not profit. */
export const THIN_MARGIN_RATE = 0.2

/** One model, in yuan. */
export type ModelMarginRow = {
  model: string
  vendor: string
  requests: number
  /** What customers were charged at list, not cash received. */
  revenue: number
  /** The part of revenue served where a cost is known. */
  costedRevenue: number
  /** costedRevenue over revenue. */
  coverage: number
  /** Bills, fees at the rate and the pool accounts' share, for the costed part. Null when the coverage is under MODEL_MIN_COVERAGE. */
  cost: number | null
  margin: number | null
  /** margin over costedRevenue; null without a margin. */
  marginRate: number | null
  /** Charge per request. */
  revenuePerRequest: number | null
  /** Margin per request, the margin spread over the costed part of the requests. */
  marginPerRequest: number | null
  /** Over the margin rate: thin enough to be a model that brings traffic. */
  thin: boolean
}

export type ModelMargins = {
  rows: ModelMarginRow[]
  /** Every customer model's charge, and the part with a known cost. */
  revenue: number
  costedRevenue: number
  /** costedRevenue over revenue; null without revenue. */
  coverage: number | null
  /** Cost and margin over the models counted (coverage at least MODEL_MIN_COVERAGE). */
  cost: number
  margin: number
  marginRate: number | null
  /** Staff use's share of every cost, and the cost no model can carry (an idle pool, a bill with nothing to split it by), yuan. */
  staffCost: number
  idleCost: number
  /** Charge of models whose cost is known too little to count. */
  unknownRevenue: number
}

const poolCost = (
  share: Record<string, number> | null | undefined,
  accounts: Map<string, number>
): number =>
  Object.entries(share ?? {}).reduce(
    (sum, [vendor, fraction]) => sum + fraction * (accounts.get(vendor) ?? 0),
    0
  )

/**
 * Each customer model's charge against its share of the cost, the same shares
 * the group panel uses with the model in place of the group: a bill by the
 * use of the channel and model it came from, a fee the same way, and a vendor's
 * pool accounts by use on the pool's own channels. Only the costed part of a
 * model's charge is measured, so its rate is over that part. Null on a server
 * that sends no allocation.
 */
export function modelMargins(
  data: FinanceInsights,
  rate: number
): ModelMargins | null {
  if (data.model_allocations == null) return null
  const accounts = new Map(
    financeMargins(data, rate).rows.map((row) => [row.vendor, row.accountCost])
  )
  const costOf = (row: ModelAllocation) =>
    row.bill_usd + row.fee_usd * rate + poolCost(row.pool_share, accounts)
  let staffCost = 0
  let idleCost = 0
  const rows: ModelMarginRow[] = []
  for (const item of data.model_allocations) {
    const cost = costOf(item)
    if (item.kind === 'staff') staffCost = cost
    if (item.kind === 'unattributed') idleCost = cost
    if (item.kind !== 'model') continue
    if (item.revenue_usd <= 0 && cost <= 0) continue
    const coverage =
      item.revenue_usd > 0 ? item.costed_revenue_usd / item.revenue_usd : 0
    const known = coverage >= MODEL_MIN_COVERAGE
    const margin = known ? item.costed_revenue_usd - cost : null
    const marginRate =
      margin != null && item.costed_revenue_usd > 0
        ? margin / item.costed_revenue_usd
        : null
    const costedRequests = item.requests * coverage
    rows.push({
      model: item.model,
      vendor: item.vendor,
      requests: item.requests,
      revenue: item.revenue_usd,
      costedRevenue: item.costed_revenue_usd,
      coverage,
      cost: known ? cost : null,
      margin,
      marginRate,
      revenuePerRequest:
        item.requests > 0 ? item.revenue_usd / item.requests : null,
      marginPerRequest:
        margin != null && costedRequests > 0 ? margin / costedRequests : null,
      thin: marginRate != null && marginRate < THIN_MARGIN_RATE,
    })
  }
  rows.sort((a, b) => b.revenue - a.revenue || a.model.localeCompare(b.model))
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const counted = rows.filter((row) => row.margin != null)
  const costedRevenue = counted.reduce((sum, row) => sum + row.costedRevenue, 0)
  const cost = counted.reduce((sum, row) => sum + (row.cost ?? 0), 0)
  const margin = costedRevenue - cost
  return {
    rows,
    revenue,
    costedRevenue,
    coverage: revenue > 0 ? costedRevenue / revenue : null,
    cost,
    margin,
    marginRate: costedRevenue > 0 ? margin / costedRevenue : null,
    staffCost,
    idleCost,
    unknownRevenue: rows
      .filter((row) => row.margin == null)
      .reduce((sum, row) => sum + row.revenue, 0),
  }
}

/** The models carrying the most margin, and the ones losing it, by the amount. */
export function marginExtremes(rows: ModelMarginRow[]): {
  top: ModelMarginRow[]
  losing: ModelMarginRow[]
} {
  const counted = rows.filter((row) => row.margin != null)
  const byMargin = (a: ModelMarginRow, b: ModelMarginRow) =>
    (b.margin ?? 0) - (a.margin ?? 0) || a.model.localeCompare(b.model)
  return {
    top: counted
      .filter((row) => (row.margin ?? 0) > 0)
      .sort(byMargin)
      .slice(0, 3),
    losing: counted
      .filter((row) => (row.margin ?? 0) < 0)
      .sort((a, b) => byMargin(b, a)),
  }
}

/**
 * The models that bring traffic and little margin: at least TRAFFIC_SHARE of
 * the requests of all counted models, at a thin rate. A thin model with a
 * smaller share is just small.
 */
export const TRAFFIC_SHARE = 0.05

export function trafficModels(rows: ModelMarginRow[]): ModelMarginRow[] {
  const counted = rows.filter((row) => row.margin != null)
  const total = counted.reduce((sum, row) => sum + row.requests, 0)
  if (total <= 0) return []
  return counted
    .filter((row) => row.thin && row.requests / total >= TRAFFIC_SHARE)
    .sort((a, b) => b.requests - a.requests)
}

/** Named on the chart: the biggest models by charge, and every loss. */
const LABELS = 5

/** One bubble of the chart: where it is drawn and how large. */
export type Point = { row: ModelMarginRow; x: number; y: number; r: number }

/** Width of a ten-pixel label, per character, as an estimate. */
const CHAR_WIDTH = 5.6
const LABEL_HEIGHT = 11

type Label = {
  row: ModelMarginRow
  tx: number
  ty: number
  anchor: 'start' | 'end'
}

/**
 * Names for the bubbles worth naming, the losses first and then the largest
 * charges, each beside its bubble and skipped when it would sit on a label
 * already placed.
 */
export function placeLabels(points: Point[], width: number): Label[] {
  const candidates = [
    ...points
      .filter((point) => (point.row.margin ?? 0) < 0)
      .sort((a, b) => (a.row.margin ?? 0) - (b.row.margin ?? 0)),
    ...points
      .filter((point) => (point.row.margin ?? 0) >= 0)
      .sort((a, b) => b.row.revenue - a.row.revenue),
  ]
  const placed: Label[] = []
  const boxes: { left: number; right: number; top: number; bottom: number }[] =
    []
  let named = 0
  for (const point of candidates) {
    if (named >= LABELS + 2) break
    const textWidth = point.row.model.length * CHAR_WIDTH
    for (const side of ['start', 'end'] as const) {
      const tx =
        side === 'start' ? point.x + point.r + 3 : point.x - point.r - 3
      const box = {
        left: side === 'start' ? tx : tx - textWidth,
        right: side === 'start' ? tx + textWidth : tx,
        top: point.y - LABEL_HEIGHT / 2,
        bottom: point.y + LABEL_HEIGHT / 2,
      }
      const inside = box.left >= 0 && box.right <= width
      const clear = boxes.every(
        (other) =>
          box.right < other.left ||
          box.left > other.right ||
          box.bottom < other.top ||
          box.top > other.bottom
      )
      if (inside && clear) {
        boxes.push(box)
        placed.push({ row: point.row, tx, ty: point.y + 3, anchor: side })
        named += 1
        break
      }
    }
  }
  return placed
}
