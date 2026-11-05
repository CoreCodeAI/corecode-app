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
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type {
  CapacityInsights,
  GrowthInsights,
  QualityInsights,
  RiskInsights,
} from '../types'
import {
  useCapacityVerdict,
  useGrowthVerdict,
  useQualityVerdict,
  useRiskVerdict,
} from '../verdicts'

describe('tab verdicts', () => {
  it('reads the capacity tab: requests, peak against slots, what was turned away', () => {
    const data = {
      requests: 1200,
      peak_concurrency: 30,
      error_categories: [{ name: 'engine_concurrency', count: 4 }],
      limit_rejection_total: 0,
      pool: { configured: true, effective_slots: 60 },
    } as unknown as CapacityInsights
    const previous = { requests: 1000 } as CapacityInsights
    const { result } = renderHook(() => useCapacityVerdict(data, previous))
    expect(result.current).toEqual({
      tone: 'danger',
      text: '1,200 requests (up 20%). Peak concurrency 30 of 60 slots (50%). 4 turned away with the pool full.',
    })
  })

  it('reads the quality tab: failure rate and its move, Claude’s first token, the worst model', () => {
    const data = {
      requests: 1000,
      error_rate: 0.03,
      vendors: [
        { vendor: 'claude', ttft_p50_ms: 1400, ttft_p95_ms: 6800 },
        { vendor: 'codex', ttft_p50_ms: 5700, ttft_p95_ms: 17000 },
      ],
      models: [
        { model: 'gpt-6.1-terra', requests: 400, error_rate: 0.15 },
        { model: 'claude-opus-5-5', requests: 600, error_rate: 0.001 },
      ],
    } as unknown as QualityInsights
    const previous = { requests: 900, error_rate: 0.01 } as QualityInsights
    const { result } = renderHook(() => useQualityVerdict(data, previous))
    expect(result.current?.tone).toBe('warning')
    expect(result.current?.text).toBe(
      'Failure rate 3% (+2 points). Claude first token 1.4s at p50, 6.8s at p95. Failing most: gpt-6.1-terra at 15%.'
    )
  })

  it('reads the growth tab without a previous period', () => {
    const data = {
      funnel: { registered: 50, activated: 10, paid: 5, repeat: 1 },
    } as unknown as GrowthInsights
    const { result } = renderHook(() => useGrowthVerdict(data, undefined))
    expect(result.current).toEqual({
      tone: 'warning',
      text: '50 sign-ups. 20% sent a request and 10% paid.',
    })
  })

  it('lists what the risk tab wants checked, or says nothing does', () => {
    const quiet = {
      signups: 8,
      shared_ips: [],
      alias_emails: 0,
      off_whitelist: 0,
      debtors: [],
    } as unknown as RiskInsights
    expect(renderHook(() => useRiskVerdict(quiet)).result.current).toEqual({
      tone: 'good',
      text: '8 sign-ups. Nothing to check.',
    })
    const busy = { ...quiet, alias_emails: 2, debtors: [{}] } as RiskInsights
    expect(renderHook(() => useRiskVerdict(busy)).result.current?.text).toBe(
      '8 sign-ups. To check: 2 alias emails, 1 accounts in debt.'
    )
  })
})
