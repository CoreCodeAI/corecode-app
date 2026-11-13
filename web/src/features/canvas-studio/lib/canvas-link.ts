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
 * CoreCode fork: the link into the AI canvas app, a separate static site.
 *
 * The key travels in the URL fragment, never the query string: a fragment is
 * not sent to the server and not carried in a Referer, so the canvas site's
 * logs and any third-party request it makes never see the key.
 */
import { API_KEY_STATUS } from '@/features/keys/constants'
import type { ApiKey } from '@/features/keys/types'

/** The one place the canvas origin is written. */
export const CANVAS_ORIGIN = 'https://canvas.corecode.live'

/** The key the canvas entry looks for first, and creates on request. */
export const CANVAS_KEY_NAME = '创作台'

/** Only an `auto` key reaches the chat, image and video groups together. */
export const CANVAS_KEY_GROUP = 'auto'

/**
 * A key or token name as the console shows it. The canvas key's stored name is
 * Chinese, so every reader sees the locale's "Creation Studio" instead; the
 * stored name stays the one the lookups above match.
 */
export function displayKeyName(
  name: string,
  t: (key: string) => string
): string {
  return name === CANVAS_KEY_NAME ? t('Creation Studio') : name
}

/**
 * Pick the key to hand the canvas: an enabled key named exactly
 * {@link CANVAS_KEY_NAME}, else the first enabled key in the `auto` group.
 * Returns undefined when neither exists.
 */
export function pickCanvasKey<
  T extends Pick<ApiKey, 'name' | 'status' | 'group'>,
>(keys: readonly T[]): T | undefined {
  const enabled = keys.filter((key) => key.status === API_KEY_STATUS.ENABLED)
  return (
    enabled.find((key) => key.name === CANVAS_KEY_NAME) ??
    enabled.find((key) => key.group === CANVAS_KEY_GROUP)
  )
}

/** The canvas URL for a server address and a full key (with its `sk-`). */
export function buildCanvasUrl(serverAddress: string, fullKey: string): string {
  const fragment = [
    `baseUrl=${encodeURIComponent(serverAddress)}`,
    `apiKey=${encodeURIComponent(fullKey)}`,
  ].join('&')
  return `${CANVAS_ORIGIN}/#${fragment}`
}
