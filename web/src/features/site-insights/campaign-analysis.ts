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
  CampaignInsights,
  CampaignRow,
  GateInsights,
  NewcomerFunnel,
} from './types'

/** The kinds of campaign, in the order the panel lists them. */
export const CAMPAIGN_KINDS = [
  'invite_gift',
  'newcomer_plan',
  'forum_id',
  'raffle',
  'admin_plan',
  'redemption',
  'channel_fee',
  'manual_other',
] as const

/** Compensation and refunds are not promotion: listed, but left out of the total. */
export function isPromotion(kind: string) {
  return kind !== 'manual_other'
}

/** What a campaign brought back: payments after receiving, and a newcomer plan's own price. */
export function campaignReturn(row: CampaignRow) {
  return row.paid_money + row.pack_money
}

/** Money back per unit of cost; null when the campaign cost nothing, so no ratio. */
export function campaignMultiple(row: CampaignRow): number | null {
  return row.cost_usd > 0 ? campaignReturn(row) / row.cost_usd : null
}

/** The share of recipients that paid afterwards; null without recipients. */
export function campaignConversion(row: CampaignRow): number | null {
  return row.recipients > 0 ? row.payers / row.recipients : null
}

/** The rows in the panel's order, a kind the server sent none for left out. */
export function orderedCampaigns(data: CampaignInsights | undefined) {
  const rows = data?.rows ?? []
  return CAMPAIGN_KINDS.map((kind) =>
    rows.find((row) => row.kind === kind)
  ).filter((row): row is CampaignRow => row != null)
}

/** The largest figure on either side of a bar pair, which the bars' ends stand for. */
export function campaignScale(rows: CampaignRow[]) {
  return Math.max(
    0,
    ...rows.map((row) => Math.max(row.cost_usd, campaignReturn(row)))
  )
}

export type FunnelStep = { key: string; count: number; share: number }

/**
 * The newcomer plan's buyers as steps, each against the buyers: bought, used up
 * (90 % of the quota spent), and paid again after buying. Empty without buyers.
 */
export function funnelSteps(funnel: NewcomerFunnel | undefined): FunnelStep[] {
  if (!funnel || funnel.bought <= 0) return []
  const step = (key: string, count: number) => ({
    key,
    count,
    share: count / funnel.bought,
  })
  return [
    step('bought', funnel.bought),
    step('used_up', funnel.used_up),
    step('repaid', funnel.repaid),
  ]
}

/** The newcomer plan's net: what its buyers paid, for it and after, less the quota they used. */
export function newcomerNet(funnel: NewcomerFunnel) {
  return funnel.pack_money + funnel.repaid_money - funnel.used_usd
}

/** Every request the gate kept off a plan: moved to the wallet, turned away, or paid by another plan. */
export function gatedRequests(data: GateInsights) {
  return data.wallet + data.refused + data.other_plan
}

/**
 * The share of the accounts the gate acted on that an administrator then
 * exempted: its known mistakes. Null when it acted on none.
 */
export function gateMistakeRate(data: GateInsights): number | null {
  return data.users > 0 ? data.exemptions.gated / data.users : null
}
