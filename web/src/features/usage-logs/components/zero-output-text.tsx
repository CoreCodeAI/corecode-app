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
import type { TFunction } from 'i18next'

import type { ZeroOutputReason } from '../lib/bill-explain'

/**
 * What a zero-output charge means, in the customer's words. A refusal names
 * its category when the gateway recorded a known one; the general text lists
 * the usual causes.
 */
export function getZeroOutputText(
  t: TFunction,
  reason: ZeroOutputReason
): string {
  if (reason.kind === 'refusal') {
    return reason.category
      ? t(
          "Refused by Anthropic's safety policy (category: {{category}}). Anthropic still charges for the input and cache writes.",
          { category: t(reason.category) }
        )
      : t(
          "Refused by Anthropic's safety policy. Anthropic still charges for the input and cache writes."
        )
  }
  return t(
    'Input and cache are billed by the upstream; no output means no output fee. Common causes: the client disconnected, a timeout, or the request only warmed the cache.'
  )
}
