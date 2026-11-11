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

const HOUR = 3600
const start = 1_800_000_000 - (1_800_000_000 % HOUR)

function qualityHour(index: number, requests: number, errors: number) {
  return {
    hour: start + index * HOUR,
    requests,
    errors,
    error_rate: errors / requests,
    ttft_p50_ms: 1000,
    ttft_p95_ms: 4000,
  }
}

function qualityModel(model: string, requests: number, errors: number) {
  return {
    model,
    vendor: 'claude',
    requests,
    errors,
    error_rate: errors / requests,
    ttft_p50_ms: 1000,
    ttft_p95_ms: 4000,
    latency_p50_s: 1,
    latency_p95_s: 2,
    cache_share: 0,
  }
}

describe('QualityTab diagnosis', () => {
  const range = {
    start,
    end: start + 3 * HOUR + 600,
    days: 1,
    hourly: true,
  }
  const hourly = {
    ...data,
    requests: 400,
    errors: 44,
    error_rate: 0.11,
    all_models: figures({ requests: 400, errors: 44, error_rate: 0.11 }),
    daily: [
      {
        day: start,
        read: 0,
        write: 0,
        uncached: 0,
        read_share: 0,
        ttft_p50_ms: 0,
        error_rate: 0.11,
        requests: 400,
        errors: 44,
      },
    ],
    hourly: [
      qualityHour(0, 100, 1),
      qualityHour(1, 100, 40),
      qualityHour(2, 100, 2),
      qualityHour(3, 100, 1),
    ],
    models: [
      qualityModel('quiet-model', 300, 3),
      qualityModel('failing-model', 100, 41),
    ],
    error_categories: [
      { name: 'upstream_rate_limit', count: 30 },
      { name: 'client_error', count: 10 },
      { name: 'engine_concurrency', count: 4 },
    ],
    stream_ends: [
      { name: 'eof', count: 90 },
      { name: 'timeout', count: 10 },
    ],
  } satisfies QualityInsights

  it('reads a short range by the hour and names the worst closed hour', () => {
    render(
      <QualityTab
        data={hourly}
        models={{ selected: [], onChange: vi.fn() }}
        range={range}
      />
    )
    expect(screen.getByText('Failure rate by hour')).toBeInTheDocument()
    expect(screen.queryByText('Daily failure rate')).not.toBeInTheDocument()
    expect(
      screen.getByText(/^Worst hour .*: 40% of 100 requests\.$/)
    ).toBeInTheDocument()
  })

  it('keeps the daily chart on a server without hourly data', () => {
    render(
      <QualityTab
        data={{ ...hourly, hourly: undefined }}
        models={{ selected: [], onChange: vi.fn() }}
        range={range}
      />
    )
    expect(screen.getByText('Daily failure rate')).toBeInTheDocument()
    expect(screen.queryByText('Failure rate by hour')).not.toBeInTheDocument()
  })

  it('says whose failures they are and links to where they are acted on', async () => {
    const onOpen = vi.fn()
    render(
      <QualityTab
        data={hourly}
        models={{ selected: [], onChange: vi.fn() }}
        range={range}
        onOpen={onOpen}
      />
    )
    expect(
      screen.getByText(
        'Customers only, root left out; the headline counts everyone.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Service failure rate')).toBeInTheDocument()
    // (44 - 10) / (400 - 10)
    expect(screen.getByText('8.7%')).toBeInTheDocument()
    expect(screen.getByText('Streams cut short')).toBeInTheDocument()
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Upstreams →' })[0]
    )
    expect(onOpen).toHaveBeenCalledWith('upstream')
  })

  it('ranks models by failures beyond the site’s rate', () => {
    render(
      <QualityTab
        data={hourly}
        models={{ selected: [], onChange: vi.fn() }}
        range={range}
      />
    )
    const cells = screen
      .getAllByText(/^(quiet|failing)-model$/)
      .map((cell) => cell.textContent)
    expect(cells[0]).toBe('failing-model')
    expect(
      screen.getByText(
        'Most failures beyond the site’s rate: failing-model, 41% with 30 extra failures.'
      )
    ).toBeInTheDocument()
  })
})
