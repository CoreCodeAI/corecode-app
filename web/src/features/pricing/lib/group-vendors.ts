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

/** Claude groups first, then the rest; cheapest first within each. */
export function orderGroups(
  groups: string[],
  vendors: Map<string, GroupVendor | null>,
  ratio: (group: string) => number
): string[] {
  const isClaude = (group: string) => vendors.get(group)?.name === CLAUDE_VENDOR
  return [...groups].sort(
    (a, b) => Number(isClaude(b)) - Number(isClaude(a)) || ratio(a) - ratio(b)
  )
}
