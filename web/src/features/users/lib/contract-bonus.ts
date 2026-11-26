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
/** A percent typed with at most two decimals, from 0 to 100. */
export function parseContractBonusPercent(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null
  const percent = Number(trimmed)
  return percent <= 100 ? percent : null
}

/** A rate as the percent the form shows, without float noise. */
export function contractBonusRateToPercent(rate: number): string {
  return String(Math.round(rate * 10000) / 100)
}
