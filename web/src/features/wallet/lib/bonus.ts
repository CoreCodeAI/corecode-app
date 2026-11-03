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

import { PAYMENT_TYPES } from '../constants'

// ============================================================================
// Top-up Bonus Helpers
// ============================================================================

export interface BonusTier {
  /** Smallest top-up amount that earns this tier */
  threshold: number
  /** Bonus as a fraction of the top-up amount (0.1 = 10%) */
  rate: number
}

const NO_BONUS_PAYMENT_TYPES = new Set<string>([
  PAYMENT_TYPES.STRIPE,
  PAYMENT_TYPES.CREEM,
  PAYMENT_TYPES.WAFFO,
  PAYMENT_TYPES.WAFFO_PANCAKE,
])

/**
 * Online epay methods (alipay, wxpay and similar) and NOWPayments (USDT /
 * USDC), whose orders are priced like epay's, earn a bonus; Stripe, Creem and
 * Waffo orders never do.
 */
export function isBonusEligiblePayment(paymentType: string | undefined) {
  return !!paymentType && !NO_BONUS_PAYMENT_TYPES.has(paymentType)
}

function getTiers(bonus: Record<number, number> | undefined): BonusTier[] {
  if (!bonus) return []

  return Object.entries(bonus)
    .map(([threshold, rate]) => ({
      threshold: Number(threshold),
      rate: Number(rate),
    }))
    .filter(
      (tier) =>
        Number.isFinite(tier.threshold) &&
        tier.threshold > 0 &&
        Number.isFinite(tier.rate) &&
        tier.rate > 0
    )
    .sort((a, b) => a.threshold - b.threshold)
}

/**
 * Tiers are ranges: the tier that applies is the one with the highest
 * threshold at or below the amount. Below the lowest threshold none applies.
 */
export function findBonusTier(
  bonus: Record<number, number> | undefined,
  amount: number
): BonusTier | null {
  let found: BonusTier | null = null
  for (const tier of getTiers(bonus)) {
    if (tier.threshold <= amount) found = tier
  }
  return found
}

/**
 * The closest tier above the amount, for a "top up N more" hint.
 */
export function findNextBonusTier(
  bonus: Record<number, number> | undefined,
  amount: number
): BonusTier | null {
  return getTiers(bonus).find((tier) => tier.threshold > amount) ?? null
}

/**
 * Bonus in the same unit as the amount (amount x rate); 0 when no tier applies.
 */
export function calculateBonus(
  bonus: Record<number, number> | undefined,
  amount: number
): number {
  const tier = findBonusTier(bonus, amount)
  return tier ? amount * tier.rate : 0
}

/**
 * Rate as a whole-number-friendly percent, without float noise (0.07 -> 7).
 */
export function bonusRateToPercent(rate: number): number {
  return Number((rate * 100).toFixed(2))
}

/**
 * Get bonus label for display (e.g., "+5% bonus")
 */
export function getBonusLabel(rate: number, t: TFunction): string {
  return t('+{{percent}}% bonus', { percent: bonusRateToPercent(rate) })
}
