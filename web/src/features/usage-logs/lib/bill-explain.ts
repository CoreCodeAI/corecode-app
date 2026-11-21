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
 * CoreCode fork: the plain-language side of a charge. The small decisions the
 * log list, the detail dialog and the overview banner share when they explain
 * why a request cost what it did. Nothing here prices a request; the numbers
 * come from the log and from buildCostCheck.
 */
import type { UsageLog } from '../data/schema'
import type { LogOtherData } from '../types'
import {
  buildCostCheck,
  getInputCacheTokens,
  isCostlyCacheMiss,
} from './cost-check'
import { parseLogOther } from './format'
import {
  isResponseModelMismatch,
  type ResponseModelObservation,
} from './response-model'

/** A prompt shorter than this is below what a provider caches at all. */
const CACHE_BADGE_MIN_INPUT = 1024

export type CacheWriteTtl = '5m' | '1h' | 'mixed'

/**
 * How long the cache writes of a request live. Claude logs split the writes by
 * lifetime; a log without the split (OpenAI-shaped usage, older rows) gives
 * null rather than a guess.
 */
export function getCacheWriteTtl(
  other: LogOtherData | null
): CacheWriteTtl | null {
  const fiveMinutes = other?.cache_creation_tokens_5m || 0
  const oneHour = other?.cache_creation_tokens_1h || 0
  if (fiveMinutes > 0 && oneHour > 0) return 'mixed'
  if (oneHour > 0) return '1h'
  if (fiveMinutes > 0) return '5m'
  return null
}

/**
 * A charge for input and cache that carries no output: the client dropped the
 * connection, the request timed out, or it only warmed the cache. Limited to
 * per-token charges, where an empty output really costs nothing; a per-call
 * or dynamic price does not depend on the output.
 */
export function isZeroOutputCharge(
  log: UsageLog,
  other: LogOtherData | null
): boolean {
  if (log.type !== 2 || !(log.quota > 0)) return false
  if ((log.completion_tokens || 0) !== 0) return false
  return buildCostCheck(log, other) !== null
}

/**
 * Why a zero-output charge has no output. Anthropic's refusal is recorded by
 * the gateway (other.upstream_refusal) and said plainly; anything else gets
 * the general explanation.
 */
export type ZeroOutputReason =
  | { kind: 'refusal'; category: string | null }
  | { kind: 'general' }

/** Policy tags the gateway records for a refusal, with a customer-facing name. */
const REFUSAL_CATEGORIES: Record<string, string> = {
  cyber: 'cybersecurity',
  bio: 'biology',
  reasoning_extraction: 'reasoning extraction',
}

export function getZeroOutputReason(
  log: UsageLog,
  other: LogOtherData | null
): ZeroOutputReason | null {
  if (!isZeroOutputCharge(log, other)) return null
  if (other?.upstream_refusal !== true) return { kind: 'general' }
  const category = other.upstream_refusal_category?.toLowerCase() ?? ''
  return {
    kind: 'refusal',
    category: Object.hasOwn(REFUSAL_CATEGORIES, category)
      ? REFUSAL_CATEGORIES[category]
      : null,
  }
}

export type CacheBadge = { kind: 'hit'; percent: number } | { kind: 'miss' }

/**
 * The cache outcome of one request, for the badge beside its cost. A request
 * that read from the cache is a hit at its share of the input. One that read
 * nothing is a miss only where the model discounts cached input; without a
 * discount there is nothing to miss, and a short prompt is not cacheable.
 */
export function getCacheBadge(
  log: Pick<UsageLog, 'prompt_tokens' | 'type'>,
  other: LogOtherData | null
): CacheBadge | null {
  if (log.type !== 2 || !other) return null
  const { cacheRead, totalInput } = getInputCacheTokens(log, other)
  if (totalInput <= 0) return null
  if (cacheRead > 0) {
    return {
      kind: 'hit',
      percent: Math.min(
        100,
        Math.max(1, Math.round((cacheRead / totalInput) * 100))
      ),
    }
  }
  const discount = other.cache_ratio
  if (totalInput < CACHE_BADGE_MIN_INPUT) return null
  if (discount == null || !(discount < 1)) return null
  return { kind: 'miss' }
}

const CLAUDE_PREFIX = 'claude'

/**
 * A Claude request answered by a different Claude model. Anthropic's safety
 * classifier does this on purpose (docs/fallback), so the log can name the
 * cause. Any other name mismatch could be an alias or a dated version, and
 * keeps the hedged wording.
 */
export function isClaudeFallback(
  observation: ResponseModelObservation | undefined
): boolean {
  if (!observation || !isResponseModelMismatch(observation)) return false
  return (
    observation.requested_model.toLowerCase().startsWith(CLAUDE_PREFIX) &&
    observation.returned_model.toLowerCase().includes(CLAUDE_PREFIX)
  )
}

/**
 * The model a request is priced as. The gateway bills by the model the client
 * asked for (relay/helper/price.go prices OriginModelName), whatever model
 * answered, so a fallback to a model with another price changes nothing.
 */
export function getBilledModel(observation: ResponseModelObservation): string {
  return observation.requested_model
}

/**
 * The rows of a log page that are long requests which missed the cache: the
 * set the overview banner counts. The server has no such filter.
 */
export function keepCostlyCacheMisses(logs: UsageLog[]): UsageLog[] {
  return logs.filter((log) => isCostlyCacheMiss(log, parseLogOther(log.other)))
}
