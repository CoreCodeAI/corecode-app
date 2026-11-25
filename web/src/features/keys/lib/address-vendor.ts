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
import { lazy, type ComponentType } from 'react'

export type AddressVendor = 'claude' | 'openai'

/** Each vendor's own mark and brand color. The marks load only when drawn. */
export const VENDOR_STYLES: Record<
  AddressVendor,
  { color: string; Mark: ComponentType<{ size?: number }> }
> = {
  claude: {
    color: '#D97757',
    Mark: lazy(() => import('@lobehub/icons/es/Claude/components/Color.js')),
  },
  openai: {
    color: '#10A37F',
    Mark: lazy(() => import('@lobehub/icons/es/OpenAI/components/Mono.js')),
  },
}

/** new-api's ApiInfo color names (`validColors`), as Tailwind's 500 shades. */
const NAMED_COLORS: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  cyan: '#06b6d4',
  purple: '#a855f7',
  pink: '#ec4899',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  'light-green': '#4ade80',
  teal: '#14b8a6',
  'light-blue': '#38bdf8',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  grey: '#6b7280',
  slate: '#64748b',
}

/**
 * The vendor an address serves, read from its route label and URL: Claude's
 * Messages API, or OpenAI's (Codex, Responses, Chat Completions).
 */
export function addressVendor(address: {
  route: string
  url: string
}): AddressVendor | null {
  const text = `${address.route} ${address.url}`
  if (/claude|anthropic|\/v1\/messages/i.test(text)) return 'claude'
  if (/codex|openai|gpt|\/responses|chat\/completions/i.test(text)) {
    return 'openai'
  }
  return null
}

/** The vendor's color, else the configured color name's, else none. */
export function addressAccent(
  vendor: AddressVendor | null,
  color: string | undefined
): string | undefined {
  return vendor ? VENDOR_STYLES[vendor].color : NAMED_COLORS[color ?? '']
}
