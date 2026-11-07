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
 * CoreCode fork: what a Claude Code workload costs on a model.
 *
 * Claude Code resends the whole conversation every turn and marks the newest
 * message as a cache breakpoint. The part of the context already cached is
 * billed as cache reads; the rest is new and is written to the cache, so it
 * is billed at the cache write price. Output is billed as output.
 */
import type { PricingModel } from '../types'
import { splitBillingExprAndRequestRules } from './billing-expr'
import { compileBillingExpression } from './billing-expression/parser'
import { evaluateBillingExpression } from './billing-expression/runtime'
import type { TokenVariable } from './billing-expression/types'
import { isDynamicPricingModel, isTaskUsagePricingModel } from './dynamic-price'
import { getDisplayGroupRatio } from './model-helpers'
import { getTokenPricePerMillion } from './price'

export interface ClaudeCodeWorkload {
  /** Context tokens sent each turn. */
  contextTokens: number
  /** Share of the context read from cache, 0–1. */
  cacheHitRate: number
  /** Output tokens per turn. */
  outputTokens: number
  turnsPerDay: number
}

export interface ClaudeCodeEstimate {
  /** USD per turn. */
  perTurn: number
  perDay: number
  /** The same workload with every context token billed as plain input. */
  perDayWithoutCache: number
  /** The tier a context-priced model bills this workload at. */
  tier?: string
}

export const DEFAULT_WORKLOAD: ClaudeCodeWorkload = {
  contextTokens: 60_000,
  cacheHitRate: 0.9,
  outputTokens: 1_500,
  turnsPerDay: 200,
}

const MILLION = 1_000_000

/**
 * USD for one turn under a model's billing expression, with the group ratio.
 * Exported for the price board, which reads base unit prices the same way.
 * Request rules after `|||` depend on a real request and are left out. A token
 * the expression does not price on its own is billed as plain input, as the
 * gateway does.
 */
export function expressionTurnCost(
  model: PricingModel,
  tokens: Partial<Record<TokenVariable, number>>,
  groupRatio: number
): { usd: number; tier: string } | null {
  const { billingExpr } = splitBillingExprAndRequestRules(
    model.billing_expr || ''
  )
  const compiled = compileBillingExpression(billingExpr)
  if (compiled.status !== 'ready') return null
  // The runtime needs a value for every variable the expression reads.
  const normalized: Partial<Record<TokenVariable, number>> = {
    p: 0,
    c: 0,
    len: 0,
    cr: 0,
    cc: 0,
    cc1h: 0,
    cc12h: 0,
    ...tokens,
  }
  for (const variable of ['cr', 'cc', 'cc1h', 'cc12h'] as const) {
    if (!compiled.variables.has(variable) && normalized[variable]) {
      normalized.p = (normalized.p ?? 0) + normalized[variable]
      normalized[variable] = 0
    }
  }
  const result = evaluateBillingExpression(compiled, { tokens: normalized })
  if (result.status !== 'success' || result.billingUnit !== 'token') return null
  return {
    usd: (result.cost / MILLION) * groupRatio,
    tier: result.matchedTier ?? '',
  }
}

export function estimateClaudeCodeCost(
  model: PricingModel,
  workload: ClaudeCodeWorkload,
  selectedGroup?: string
): ClaudeCodeEstimate | null {
  const hitRate = Math.min(Math.max(workload.cacheHitRate, 0), 1)
  const hit = workload.contextTokens * hitRate
  const miss = workload.contextTokens - hit

  // A context-priced model: run its expression, so a long context lands in
  // the tier the gateway would bill it at.
  if (
    isDynamicPricingModel(model) &&
    !isTaskUsagePricingModel(model) &&
    !model.billing_plugin_variants?.length
  ) {
    const groupRatio = getDisplayGroupRatio(model, selectedGroup)
    const len = workload.contextTokens
    const c = workload.outputTokens
    const cached = expressionTurnCost(
      model,
      { p: 0, cr: hit, cc: miss, c, len },
      groupRatio
    )
    const plain = expressionTurnCost(model, { p: len, c, len }, groupRatio)
    if (!cached || !plain) return null
    return {
      perTurn: cached.usd,
      perDay: cached.usd * workload.turnsPerDay,
      perDayWithoutCache: plain.usd * workload.turnsPerDay,
      tier: cached.tier,
    }
  }

  const input = getTokenPricePerMillion(model, 'input', selectedGroup)
  const output = getTokenPricePerMillion(model, 'output', selectedGroup)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null

  // A model without cache prices bills the whole context as input.
  const cacheRead = getTokenPricePerMillion(model, 'cache', selectedGroup)
  const cacheWrite = getTokenPricePerMillion(
    model,
    'create_cache',
    selectedGroup
  )
  const contextCost =
    hit * (Number.isFinite(cacheRead) ? cacheRead : input) +
    miss * (Number.isFinite(cacheWrite) ? cacheWrite : input)
  const outputCost = workload.outputTokens * output
  const perTurn = (contextCost + outputCost) / MILLION
  const perTurnWithoutCache =
    (workload.contextTokens * input + outputCost) / MILLION

  return {
    perTurn,
    perDay: perTurn * workload.turnsPerDay,
    perDayWithoutCache: perTurnWithoutCache * workload.turnsPerDay,
  }
}
