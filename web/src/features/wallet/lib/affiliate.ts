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
// ============================================================================
// Affiliate Functions
// ============================================================================

/** Mirrors affiliateCodePattern on the server. */
export const AFF_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/

/**
 * Generate the invitation link. Sign-in is the registration page: the emailed
 * link creates the account and reads the code from the address. The parameter
 * is `ref`, not `aff`: linux.do marks any address containing `aff=` as dangerous.
 */
export function generateAffiliateLink(affCode: string): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/sign-in?ref=${encodeURIComponent(affCode)}`
}
