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
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { QualityInsights, TaskOutcome, VendorQuality } from '../../types'
import { QualityTab } from '../quality-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

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
        'Customers only, as in the headline; root and staff are left out.'
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

describe('QualityTab round 2', () => {
  const task = (model: string, counts: Partial<TaskOutcome>): TaskOutcome => ({
    model,
    submitted: 0,
    succeeded: 0,
    failed: 0,
    timed_out: 0,
    running: 0,
    stalled: 0,
    failure_rate: 0,
    finish_p50_s: 0,
    finish_p95_s: 0,
    reasons: null,
    ...counts,
  })
  const media = {
    ...data,
    models: [
      {
        model: 'seedance-2.5-720p',
        vendor: 'media',
        requests: 200,
        errors: 0,
        error_rate: 0,
        ttft_p50_ms: 0,
        ttft_p95_ms: 0,
        latency_p50_s: 0,
        latency_p95_s: 0,
        cache_share: 0,
      },
    ],
    status_codes: [{ name: '503', count: 10 }],
    error_reasons: [{ name: 'No eligible accounts', count: 4 }],
    tasks: {
      total: task('', {
        submitted: 200,
        succeeded: 140,
        failed: 40,
        timed_out: 5,
        running: 20,
        stalled: 3,
        failure_rate: 40 / 180,
      }),
      models: [
        task('seedance-2.5-720p', {
          submitted: 200,
          succeeded: 140,
          failed: 40,
          timed_out: 5,
          running: 20,
          stalled: 3,
          failure_rate: 40 / 180,
          finish_p50_s: 90,
          finish_p95_s: 600,
          reasons: [{ name: 'content policy', count: 30 }],
        }),
      ],
      channels: null,
      truncated: false,
    },
    refusals: {
      no_channel: 12,
      risk_gate: 7,
      risk_gate_stages: [{ name: 'violation_guard', count: 7 }],
    },
  } satisfies QualityInsights

  it('shows media task outcomes, leaves their latency blank and names stuck tasks', () => {
    render(
      <QualityTab data={media} models={{ selected: [], onChange: vi.fn() }} />
    )
    expect(screen.getByText('Image and video tasks')).toBeInTheDocument()
    expect(
      screen.getByText(
        /^200 submitted: 140 succeeded, 40 failed \(5 timed out\), 20 still running\./
      )
    ).toBeInTheDocument()
    expect(screen.getByText('90s / 10 min')).toBeInTheDocument()
    expect(
      screen.getByText(
        '3 tasks have run over 30 minutes and may be stuck at the supplier.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('0s / 0s')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        /^1 models have no first-token time, so the map leaves them out/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'seedance-2.5-720p tasks fail 22.2%: 40 of 180 finished.'
      )
    ).toBeInTheDocument()
  })

  it('shows refusals before a channel with where to act', () => {
    render(
      <QualityTab data={media} models={{ selected: [], onChange: vi.fn() }} />
    )
    expect(screen.getByText('Refused before a channel')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Risk Control →' })
    ).toHaveAttribute('href', '/risk-control#audit')
    expect(
      screen.getByText('12 requests found no channel for their model.')
    ).toBeInTheDocument()
  })

  it('shares failure reasons over every failure, not the listed ones', () => {
    render(
      <QualityTab data={media} models={{ selected: [], onChange: vi.fn() }} />
    )
    expect(screen.getByText('Other reasons')).toBeInTheDocument()
  })

  it('keeps round 1 on an old server: no task or refusal panels', () => {
    render(
      <QualityTab data={data} models={{ selected: [], onChange: vi.fn() }} />
    )
    expect(screen.queryByText('Image and video tasks')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Refused before a channel')
    ).not.toBeInTheDocument()
  })

  it('says the figures could not be read rather than none when the view failed', () => {
    render(
      <QualityTab
        data={undefined}
        models={{ selected: [], onChange: vi.fn() }}
        sources={{
          view: { status: 'error', error: 'boom' },
          previous: { status: 'error' },
          business: { status: 'error' },
        }}
      />
    )
    expect(screen.getAllByText('Could not be read').length).toBeGreaterThan(0)
    expect(
      screen.queryByText('No requests in this range')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('No failed requests in this range')
    ).not.toBeInTheDocument()
  })

  it('turns the all-models card into a clear-filter button under a filter', async () => {
    const onChange = renderTab(['claude-opus-5-5'])
    const all = screen.getByRole('button', { name: /^All models/ })
    expect(all).toHaveTextContent('Clear the filter')
    expect(all).not.toHaveTextContent('requests')
    await userEvent.click(all)
    expect(onChange).toHaveBeenCalledWith([])
  })
})

describe('QualityTab round 3', () => {
  const quiet = { ...data, status_codes: [], error_reasons: [] }
  const tries = {
    ...quiet,
    errors: 12,
    status_codes: [
      { name: '503', count: 10 },
      { name: '400', count: 4 },
    ],
    error_reasons: [
      { name: 'Our servers are currently overloaded', count: 14 },
    ],
  } satisfies QualityInsights
  const task = {
    submitted: 248,
    succeeded: 247,
    failed: 1,
    timed_out: 0,
    running: 0,
    stalled: 0,
    failure_rate: 0.004,
    finish_p50_s: 690,
    finish_p95_s: 3200,
    reasons: null,
  }
  const media = (model: string, requests: number, errors: number) => ({
    model,
    vendor: 'media',
    requests,
    errors,
    error_rate: errors / requests,
    ttft_p50_ms: 0,
    ttft_p95_ms: 0,
    latency_p50_s: 0,
    latency_p95_s: 0,
    cache_share: 0,
  })

  it('says the breakdowns count failed tries and gives their total', () => {
    const { unmount } = render(
      <QualityTab
        data={{ ...tries, failed_tries: 14 }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    expect(
      screen.getAllByText('14 failed tries for 12 failed requests.')
    ).toHaveLength(2)
    unmount()
    // Without the server's total, the status codes are summed to the same figure.
    render(
      <QualityTab data={tries} models={{ selected: [], onChange: vi.fn() }} />
    )
    expect(
      screen.getAllByText('14 failed tries for 12 failed requests.')
    ).toHaveLength(2)
  })

  it('says a previous period before the logs has no data to compare with', () => {
    const end = 1_800_000_000
    render(
      <QualityTab
        data={{
          ...quiet,
          requests: 500,
          cache_share: 0.95,
          logs_since: end - 3 * 86400,
        }}
        previous={{ ...quiet, requests: 0, cache_share: 0 }}
        range={{ start: end - 7 * 86400, end, days: 7, hourly: false }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    // Zero requests before the logs are not a new figure, nor a rise in cache share.
    expect(screen.queryByText('New this period')).toBeNull()
    expect(screen.queryByText('95.0 pt')).toBeNull()
    expect(screen.getAllByText('No data to compare').length).toBeGreaterThan(0)
  })

  it('reads a day before the logs as no data, not zero', () => {
    const end = 1_800_000_000
    const day = (index: number, requests: number) => ({
      day: end - (3 - index) * 86400,
      read: requests * 10,
      write: requests,
      uncached: requests,
      read_share: requests ? 0.8 : 0,
      ttft_p50_ms: requests ? 900 : 0,
      error_rate: 0,
      requests,
      errors: 0,
    })
    render(
      <QualityTab
        data={{
          ...quiet,
          requests: 500,
          daily: [day(0, 0), day(1, 200), day(2, 300)],
          logs_since: end - 2 * 86400,
        }}
        range={{ start: end - 3 * 86400, end, days: 7, hourly: false }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    for (const name of ['Input tokens by cache use', 'Daily failure rate']) {
      const bars = screen
        .getByRole('list', { name })
        .querySelectorAll('[tabindex="0"]')
      expect(bars[0].getAttribute('aria-label')).toContain('No data')
      expect(bars[1].getAttribute('aria-label')).not.toContain('No data')
    }
  })

  it('shows root and staff tests apart, and only when the server sends them', () => {
    const { unmount } = render(
      <QualityTab
        data={{ ...quiet, staff_requests: 7, staff_errors: 2 }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    expect(
      screen.getByText(
        'Root and staff tests: 7 requests, 2 failed, left out of the figures above.'
      )
    ).toBeInTheDocument()
    unmount()
    render(
      <QualityTab data={quiet} models={{ selected: [], onChange: vi.fn() }} />
    )
    expect(screen.queryByText(/Root and staff tests/)).not.toBeInTheDocument()
  })

  it('points per-user refusals at the capacity tab', () => {
    render(
      <QualityTab data={quiet} models={{ selected: [], onChange: vi.fn() }} />
    )
    expect(
      screen.getByText(
        'Per-user limit refusals are counted on the capacity tab:'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Capacity →' })).toBeInTheDocument()
  })

  it('says how many client errors the service failure rate leaves out', () => {
    render(
      <QualityTab
        data={{
          ...quiet,
          error_categories: [
            { name: 'client_error', count: 10 },
            { name: 'upstream_error', count: 2 },
          ],
        }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    expect(
      screen.getByText('Leaves out 10 client errors (4xx).')
    ).toBeInTheDocument()
  })

  it('lists each vendor’s own failure reasons, and leaves the panel out without them', () => {
    const { unmount } = render(
      <QualityTab
        data={{
          ...quiet,
          vendor_failures: [
            {
              vendor: 'media',
              failed_tries: 20,
              reasons: [
                {
                  name: 'Model "gpt-image-2.5-flare" has no image size',
                  count: 15,
                },
              ],
              other_reasons: 5,
              status_codes: null,
              other_status_codes: 0,
            },
          ],
        }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    expect(screen.getByText('Failure reasons by vendor')).toBeInTheDocument()
    expect(
      screen.getByText('Image and video: 20 failed tries')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Model "gpt-image-2.5-flare" has no image size')
    ).toBeInTheDocument()
    expect(screen.getByText('Other reasons')).toBeInTheDocument()
    unmount()
    render(
      <QualityTab data={quiet} models={{ selected: [], onChange: vi.fn() }} />
    )
    expect(
      screen.queryByText('Failure reasons by vendor')
    ).not.toBeInTheDocument()
  })

  it('says how many media requests failed before a task was created', () => {
    render(
      <QualityTab
        data={{
          ...quiet,
          vendors: [...(data.vendors ?? []), figuresOf('media', 520, 223)],
          tasks: {
            total: task,
            models: null,
            channels: null,
            truncated: false,
          },
        }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    expect(
      screen.getByText(
        'Failed before a task was created: 223. Media requests failed 223 of 520; tasks failed 1 of 248 submitted.'
      )
    ).toBeInTheDocument()
  })

  it('names the models that failed nearly every request, with or without a task row', () => {
    render(
      <QualityTab
        data={{
          ...quiet,
          models: [
            media('wan-3.0-480p', 20, 20),
            media('wan-3.0-prime-720p', 20, 20),
            media('seedance-2.5-720p', 22, 20),
            media('seedance-2.0-mini-720p-fixed', 22, 22),
            media('seedance-2.5-480p', 25, 20),
          ],
        }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    expect(
      screen.getByText(
        '4 models failed 90% or more of their requests: seedance-2.0-mini-720p-fixed, seedance-2.5-720p, wan-3.0-480p, wan-3.0-prime-720p.'
      )
    ).toBeInTheDocument()
  })

  it('names one model failing every request once, not twice', () => {
    render(
      <QualityTab
        data={{ ...quiet, models: [media('wan-3.0-480p', 20, 20)] }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    expect(
      screen.getAllByText('wan-3.0-480p fails 100% of its 20 requests.')
    ).toHaveLength(1)
  })

  it('keeps a long failure reason on one line, with its full text in reach', () => {
    const reason =
      'Claude upstream request failed with status 400: messages.3.content.0.text is not a valid field path for this request body, see the logs'
    render(
      <QualityTab
        data={{ ...quiet, error_reasons: [{ name: reason, count: 3 }] }}
        models={{ selected: [], onChange: vi.fn() }}
      />
    )
    expect(screen.getByText(reason)).toHaveClass('truncate')
  })
})

function figuresOf(vendor: string, requests: number, errors: number) {
  return figures({
    vendor,
    requests,
    errors,
    error_rate: errors / requests,
  })
}
