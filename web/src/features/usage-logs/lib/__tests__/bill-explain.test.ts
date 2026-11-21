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
import { describe, expect, test } from 'vitest'

import type { UsageLog } from '../../data/schema'
import type { LogOtherData } from '../../types'
import {
  getBilledModel,
  getCacheBadge,
  getCacheWriteTtl,
  getZeroOutputReason,
  isClaudeFallback,
  isZeroOutputCharge,
  keepCostlyCacheMisses,
} from '../bill-explain'

function log(fields: Partial<UsageLog>): UsageLog {
  return {
    id: 1,
    user_id: 1,
    created_at: 0,
    type: 2,
    content: '',
    username: '',
    token_name: '',
    model_name: 'claude-opus-5-5',
    quota: 1000,
    prompt_tokens: 0,
    completion_tokens: 0,
    use_time: 0,
    is_stream: true,
    channel: 0,
    channel_name: '',
    token_id: 0,
    group: '',
    ip: '',
    other: '',
    request_id: '',
    upstream_request_id: '',
    ...fields,
  }
}

const opus: LogOtherData = {
  claude: true,
  model_ratio: 2,
  group_ratio: 1,
  completion_ratio: 5,
  cache_ratio: 0.05,
  cache_creation_ratio: 1.25,
}

describe('getCacheWriteTtl', () => {
  test('names the lifetime of the writes, and mixed when both occur', () => {
    expect(getCacheWriteTtl({ cache_creation_tokens_1h: 10 })).toBe('1h')
    expect(getCacheWriteTtl({ cache_creation_tokens_5m: 10 })).toBe('5m')
    expect(
      getCacheWriteTtl({
        cache_creation_tokens_5m: 10,
        cache_creation_tokens_1h: 10,
      })
    ).toBe('mixed')
  })

  test('does not guess when the log has no split', () => {
    expect(getCacheWriteTtl({ cache_creation_tokens: 10 })).toBeNull()
    expect(getCacheWriteTtl(null)).toBeNull()
  })
})

describe('zero-output charges', () => {
  test('flags a per-token charge with no output and no refusal as general', () => {
    const request = log({ prompt_tokens: 100, quota: 500 })
    expect(isZeroOutputCharge(request, opus)).toBe(true)
    expect(getZeroOutputReason(request, opus)).toEqual({ kind: 'general' })
  })

  test('says refusal, with a known category, when the gateway recorded one', () => {
    const request = log({ prompt_tokens: 100, quota: 500 })
    expect(
      getZeroOutputReason(request, {
        ...opus,
        upstream_refusal: true,
        upstream_refusal_category: 'cyber',
      })
    ).toEqual({ kind: 'refusal', category: 'cybersecurity' })
  })

  test('keeps the refusal but drops a category it does not know', () => {
    const request = log({ prompt_tokens: 100, quota: 500 })
    expect(
      getZeroOutputReason(request, {
        ...opus,
        upstream_refusal: true,
        upstream_refusal_category: 'something_new',
      })
    ).toEqual({ kind: 'refusal', category: null })
  })

  test.each([
    ['it produced output', log({ prompt_tokens: 100, completion_tokens: 5 })],
    ['it cost nothing', log({ prompt_tokens: 100, quota: 0 })],
    ['it is not a consume log', log({ prompt_tokens: 100, type: 5 })],
  ])('does not flag a request when %s', (_name, request) => {
    expect(getZeroOutputReason(request, opus)).toBeNull()
  })

  test('does not flag a per-call price, where output never mattered', () => {
    const request = log({ prompt_tokens: 100 })
    expect(isZeroOutputCharge(request, { model_price: 0.25 })).toBe(false)
  })
})

describe('getCacheBadge', () => {
  test('reports the share of input read from the cache', () => {
    expect(
      getCacheBadge(log({ prompt_tokens: 20 }), {
        ...opus,
        cache_tokens: 980,
      })
    ).toEqual({ kind: 'hit', percent: 98 })
  })

  test('never rounds a hit down to 0% or up past 100%', () => {
    expect(
      getCacheBadge(log({ prompt_tokens: 100_000 }), {
        ...opus,
        cache_tokens: 10,
      })
    ).toEqual({ kind: 'hit', percent: 1 })
    expect(
      getCacheBadge(log({ prompt_tokens: 0 }), { ...opus, cache_tokens: 5 })
    ).toEqual({ kind: 'hit', percent: 100 })
  })

  test('calls a long request that read nothing a miss at full price', () => {
    expect(getCacheBadge(log({ prompt_tokens: 5000 }), opus)).toEqual({
      kind: 'miss',
    })
  })

  test('stays quiet when there was nothing to cache or no discount exists', () => {
    expect(getCacheBadge(log({ prompt_tokens: 200 }), opus)).toBeNull()
    expect(
      getCacheBadge(log({ prompt_tokens: 5000 }), {
        ...opus,
        cache_ratio: 1,
      })
    ).toBeNull()
    expect(
      getCacheBadge(log({ prompt_tokens: 5000, type: 5 }), opus)
    ).toBeNull()
    expect(getCacheBadge(log({ prompt_tokens: 5000 }), null)).toBeNull()
  })
})

describe('model fallback', () => {
  const fallback = {
    requested_model: 'claude-opus-5-5',
    upstream_model: 'claude-opus-5-5',
    returned_model: 'claude-opus-4-8',
  }

  test('recognises a Claude answered by another Claude', () => {
    expect(isClaudeFallback(fallback)).toBe(true)
  })

  test('leaves other mismatches to the hedged wording', () => {
    expect(
      isClaudeFallback({ ...fallback, returned_model: 'unexpected-model' })
    ).toBe(false)
    expect(
      isClaudeFallback({
        requested_model: 'gpt-5',
        upstream_model: 'gpt-5',
        returned_model: 'gpt-5-mini',
      })
    ).toBe(false)
    expect(isClaudeFallback(undefined)).toBe(false)
  })

  test('bills the model the client asked for', () => {
    expect(getBilledModel(fallback)).toBe('claude-opus-5-5')
  })
})

describe('keepCostlyCacheMisses', () => {
  const miss = log({
    id: 1,
    prompt_tokens: 100,
    other: JSON.stringify({ ...opus, cache_creation_tokens: 286_000 }),
  })
  const hit = log({
    id: 2,
    prompt_tokens: 100,
    other: JSON.stringify({ ...opus, cache_tokens: 286_000 }),
  })
  const short = log({
    id: 3,
    prompt_tokens: 100,
    other: JSON.stringify(opus),
  })
  const legacy = log({ id: 4, prompt_tokens: 300_000, other: '' })

  test('keeps long requests that read almost nothing from the cache', () => {
    expect(
      keepCostlyCacheMisses([miss, hit, short]).map((row) => row.id)
    ).toEqual([1])
  })

  test('a long row with no stored detail still counts, and does not crash the page', () => {
    expect(keepCostlyCacheMisses([legacy]).map((row) => row.id)).toEqual([4])
  })
})
