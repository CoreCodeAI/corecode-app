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
import { translateServerText } from '@/lib/server-error-message'

const HAN_CHARACTER = /\p{Script=Han}/u

/**
 * A stored group name or description in the reader's language. The stored
 * Chinese text is the locale key (see translateServerText). Only text with a
 * Han character is looked up: an ASCII group such as `default` or `vip` is an
 * identifier, and the locale's own `default` or `vip` entries would translate
 * it for a Chinese reader too.
 */
export function groupText(
  t: (key: string, options?: Record<string, unknown>) => string,
  text: string
): string {
  return HAN_CHARACTER.test(text) ? translateServerText(t, text) : text
}
