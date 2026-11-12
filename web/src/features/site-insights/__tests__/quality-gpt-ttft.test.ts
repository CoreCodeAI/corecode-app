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

import type { QualityInsights } from '../types'
import { useQualityVerdict } from '../verdicts'

function vendor(name: string, requests: number, p95: number) {
  return {
    vendor: name,
    requests,
    errors: 0,
    error_rate: 0,
    ttft_p50_ms: 1000,
    ttft_p95_ms: p95,
  }
}

function quality(gpt: { requests: number; p95: number }) {
  return {
    requests: 1000,
    errors: 0,
    error_rate: 0,
    models: [],
    vendors: [
      vendor('claude', 600, 4000),
      vendor('codex', gpt.requests, gpt.p95),
    ],
  } as unknown as QualityInsights
}

describe('GPT first token in the quality verdict', () => {
  it('names a GPT tail only on a sample that can carry one', () => {
    // Under the 100-request sample the tail is not judged.
    const { result } = renderHook(() =>
      useQualityVerdict(quality({ requests: 50, p95: 18000 }), undefined)
    )
    expect(result.current?.text).not.toContain('GPT first token')
    expect(result.current?.tone).toBe('good')
  })

  it('names a GPT tail only past 10 seconds at p95', () => {
    const { result } = renderHook(() =>
      useQualityVerdict(quality({ requests: 400, p95: 9000 }), undefined)
    )
    expect(result.current?.text).not.toContain('GPT first token')
    expect(result.current?.tone).toBe('good')
  })
})
