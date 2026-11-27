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
import type { PricingModel } from '../types'

export interface GroupVendor {
  name: string
  /** A @lobehub/icons name for getLobeIcon. */
  icon: string
}

export const CLAUDE_VENDOR = 'Anthropic'

// Used when a model has no vendor configured; the prefix is the model family.
const PREFIX_VENDORS: [RegExp, GroupVendor][] = [
  [/^claude-/i, { name: CLAUDE_VENDOR, icon: 'Claude.Color' }],
  [/^(gpt-|codex-|o\d)/i, { name: 'OpenAI', icon: 'OpenAI' }],
  [/^grok-/i, { name: 'xAI', icon: 'XAI' }],
  [/^deepseek-/i, { name: 'DeepSeek', icon: 'DeepSeek.Color' }],
  [/^gemini-/i, { name: 'Google', icon: 'Gemini.Color' }],
  [/^seedance-/i, { name: 'ByteDance', icon: 'ByteDance.Color' }],
  [/^wan-/i, { name: 'Wan', icon: 'Wan' }],
]

export function modelVendor(model: PricingModel): GroupVendor | null {
  if (model.vendor_name) {
    return { name: model.vendor_name, icon: model.vendor_icon ?? '' }
  }
  const match = PREFIX_VENDORS.find(([pattern]) =>
    pattern.test(model.model_name)
  )
  return match ? match[1] : null
}

/**
 * The vendor most of a group's models come from. Aliases such as
 * `gemini/claude-opus-5-5-high` are another pool's route to a model, so they
 * do not vote.
 */
export function groupVendor(
  models: PricingModel[],
  group: string
): GroupVendor | null {
  const votes = new Map<string, { vendor: GroupVendor; count: number }>()
  for (const model of models) {
    if (model.model_name.includes('/')) continue
    if (!(model.enable_groups ?? []).includes(group)) continue
    const vendor = modelVendor(model)
    if (!vendor) continue
    const entry = votes.get(vendor.name)
    if (entry) {
      entry.count += 1
      if (!entry.vendor.icon && vendor.icon) entry.vendor = vendor
    } else {
      votes.set(vendor.name, { vendor, count: 1 })
    }
  }
  let best: { vendor: GroupVendor; count: number } | null = null
  for (const entry of votes.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  return best?.vendor ?? null
}

/**
 * Claude groups first, then each other vendor's groups together: the vendor
 * whose cheapest group is cheapest first. Within a vendor, groups priced by
 * the token come before those priced per call (images, video), each cheapest
 * first. Groups no vendor claims come last.
 */
export function orderGroups(
  groups: string[],
  vendors: Map<string, GroupVendor | null>,
  ratio: (group: string) => number,
  tokenPriced: (group: string) => boolean = () => true
): string[] {
  const vendorOf = (group: string) => vendors.get(group)?.name
  const cheapest = new Map<string, number>()
  for (const group of groups) {
    const vendor = vendorOf(group)
    if (vendor === undefined) continue
    cheapest.set(
      vendor,
      Math.min(cheapest.get(vendor) ?? Infinity, ratio(group))
    )
  }
  // Ratios are never negative, so -1 puts Claude ahead of every vendor.
  const rank = (group: string) => {
    const vendor = vendorOf(group)
    if (vendor === CLAUDE_VENDOR) return -1
    if (vendor === undefined) return Number.MAX_VALUE
    return cheapest.get(vendor) ?? Number.MAX_VALUE
  }
  return [...groups].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (vendorOf(a) ?? '').localeCompare(vendorOf(b) ?? '') ||
      Number(tokenPriced(b)) - Number(tokenPriced(a)) ||
      ratio(a) - ratio(b)
  )
}

export interface VendorSection {
  /** Null for groups no vendor claims. */
  vendor: GroupVendor | null
  groups: string[]
}

/** Ordered groups split into runs of one vendor each, keeping their order. */
export function vendorSections(
  groups: string[],
  vendors: Map<string, GroupVendor | null>
): VendorSection[] {
  const sections: VendorSection[] = []
  for (const group of groups) {
    const vendor = vendors.get(group) ?? null
    const last = sections.at(-1)
    if (last && last.vendor?.name === vendor?.name) last.groups.push(group)
    else sections.push({ vendor, groups: [group] })
  }
  return sections
}
