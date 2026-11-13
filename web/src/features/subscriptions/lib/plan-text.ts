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

// Operators write plan titles and subtitles in Chinese, and the server returns
// them as stored. The plans on sale have English keys here, so other languages
// read them translated; a plan not listed shows its text as written.
const PLAN_TEXT_KEYS: Readonly<Record<string, string>> = {
  新人体验包: 'Newcomer trial pack',
  '¥9.9 得 $20 额度，7 天有效，每人限购 1 次':
    '¥9.9 for $20 of credit, valid 7 days, one per person',
  新人福利包: 'Newcomer welcome pack',
  '¥29.9 得 $50 额度，7 天有效，每人限购 1 次':
    '¥29.9 for $50 of credit, valid 7 days, one per person',
  渠道体验包: 'Channel trial pack',
  '$3 体验额度，7 天有效，仅限渠道邀请注册赠送':
    '$3 of trial credit, valid 7 days, given only on sign-up through a channel invitation',
}

/** A plan's title or subtitle in the reader's language, when it has a key. */
export function planText(text: string | undefined, t: TFunction): string {
  if (!text) return ''
  const key = PLAN_TEXT_KEYS[text.trim()]
  return key ? t(key) : text
}
