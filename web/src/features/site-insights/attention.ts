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
import type { Finding } from './components/insight-kit'

/** The red and yellow findings among a tab's, and all of them. */
export function attentionCounts(items: Finding[]) {
  return {
    total: items.length,
    red: items.filter((item) => item.tone === 'danger').length,
    yellow: items.filter((item) => item.tone === 'warning').length,
  }
}

/** The red findings a closed list still shows. */
export const RED_SHOWN = 3

/** The rows a folded breakdown shows before its fold. */
export const BREAKDOWN_SHOWN = 5
