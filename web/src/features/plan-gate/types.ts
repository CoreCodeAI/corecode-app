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
 * CoreCode fork: what the newcomer plan's network limit did to a customer's
 * recent requests (GET /api/subscription/self/plan-gate).
 */

/** How a gated request was funded: the balance, another plan, or not at all. */
export type PlanGateKind = 'wallet' | 'other_plan' | 'refused'

/** Null from the server for a customer who holds no plan the limit guards. */
export interface PlanGateNotice {
  window_seconds: number
  wallet: number
  other_plan: number
  refused: number
  last_at: number
  /** The customer's active plans the limit guards. */
  subscription_ids: number[]
}
