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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { QualityInsights, VendorQuality } from '../../types'
import { QualityTab } from '../quality-tab'

function figures(overrides: Partial<VendorQuality>): VendorQuality {
  return {
    vendor: '',
    models: [],
    requests: 0,
    errors: 0,
    error_rate: 0,
    ttft_p50_ms: 0,
    ttft_p95_ms: 0,
    ...overrides,
  }
}

const data: QualityInsights = {
  requests: 300,
  errors: 3,
  error_rate: 0.01,
  ttft_p50_ms: 3400,
  ttft_p95_ms: 12000,
  cache_share: 0.5,
  models: null,
  vendors: [
    figures({
      vendor: 'codex',
      models: ['gpt-6-astra', 'gpt-6.1-sol'],
      requests: 200,
      ttft_p50_ms: 5500,
      ttft_p95_ms: 18000,
    }),
    figures({
      vendor: 'claude',
      models: ['claude-opus-5-5'],
      requests: 100,
      ttft_p50_ms: 1500,
      ttft_p95_ms: 6000,
    }),
  ],
  all_models: figures({
    requests: 300,
    ttft_p50_ms: 3400,
    ttft_p95_ms: 12000,
  }),
  daily: [],
  stream_ends: [],
  status_codes: [],
  error_reasons: [],
  truncated: false,
}

function renderTab(selected: string[]) {
  const onChange = vi.fn()
  render(<QualityTab data={data} models={{ selected, onChange }} />)
  return onChange
}

describe('QualityTab vendor cards', () => {
  it('selects a vendor’s models from its card', async () => {
    const onChange = renderTab([])
    const cards = screen.getByRole('group', { name: 'Quick select by vendor' })
    const claude = screen.getByRole('button', { name: /^Claude/ })
    expect(cards).toContainElement(claude)
    expect(claude).toHaveTextContent('1.5s / 6.0s')
    expect(screen.getByRole('button', { name: /^All models/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await userEvent.click(claude)
    expect(onChange).toHaveBeenCalledWith(['claude-opus-5-5'])
  })

  it('marks the vendor whose models are selected and clears from all models', async () => {
    const onChange = renderTab(['gpt-6.1-sol', 'gpt-6-astra'])
    expect(screen.getByRole('button', { name: /^GPT/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const all = screen.getByRole('button', { name: /^All models/ })
    expect(all).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(all)
    expect(onChange).toHaveBeenCalledWith([])
  })
})
