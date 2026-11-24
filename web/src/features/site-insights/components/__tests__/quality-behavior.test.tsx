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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type {
  BehaviorDay,
  BehaviorModel,
  ModelBehavior,
  QualityInsights,
} from '../../types'
import { overviewBehaviorSignals } from '../overview-signals'
import { ModelBehaviorPanel } from '../quality-behavior'
import {
  bandLabel,
  BEHAVIOR_METRICS,
  behaviorLines,
  defaultBehaviorModels,
  lastValue,
  signedPercent,
} from '../quality-behavior-analysis'
import { CacheMixPanel } from '../quality-trends'

const DAY = 86400
const first = 1_800_000_000 - (1_800_000_000 % DAY)

function day(index: number, patch: Partial<BehaviorDay> = {}): BehaviorDay {
  return {
    day: first + index * DAY,
    requests: 100,
    output_p50: 400,
    reasoning_p50: 0,
    reasoning_share: 0,
    ttft_p50_ms: 2000,
    latency_p50_s: 9,
    tries: 100,
    error_rate: 0.01,
    statuses: [],
    cache_share: 0.6,
    flags: [],
    ...patch,
  }
}

function model(name: string, vendor: string, daily: BehaviorDay[]) {
  return {
    model: name,
    vendor,
    requests: daily.reduce((sum, d) => sum + d.requests, 0),
    daily,
  } satisfies BehaviorModel
}

const redFlag = {
  metric: 'output' as const,
  level: 'red' as const,
  band: 2,
  value: 120,
  baseline: 400,
  change: -0.7,
  samples: 120,
}

const behavior: ModelBehavior = {
  models: [
    model('gpt-6.1-sol', 'codex', [
      day(0),
      day(1, { output_p50: 120, flags: [redFlag] }),
    ]),
    model('claude-opus-5-5', 'claude', [day(0), day(1)]),
    model('claude-haiku-5-5', 'claude', [day(0), day(1)]),
  ],
  alerts: [{ ...redFlag, model: 'gpt-6.1-sol' }],
  band_limits: [2000, 16000, 64000],
  missing_hours: 0,
}

function metricOf(key: string) {
  const found = BEHAVIOR_METRICS.find((m) => m.key === key)
  if (!found) throw new Error(`no metric ${key}`)
  return found
}

describe('model behavior helpers', () => {
  it('opens on the GPT models and Opus, or the busiest three when none fits', () => {
    expect(defaultBehaviorModels(behavior.models)).toEqual([
      'gpt-6.1-sol',
      'claude-opus-5-5',
    ])
    const others = [
      model('a', 'claude', [day(0)]),
      model('b', 'claude', [day(0)]),
      model('c', 'claude', [day(0)]),
      model('d', 'claude', [day(0)]),
    ]
    expect(defaultBehaviorModels(others)).toEqual(['a', 'b', 'c'])
    expect(defaultBehaviorModels(undefined)).toEqual([])
  })

  it('breaks a line on a day with too few requests, except for errors', () => {
    const thin = [model('m', 'codex', [day(0), day(1, { requests: 5 })])]
    const output = metricOf('output')
    const errors = metricOf('errors')
    expect(behaviorLines(thin, ['m'], output)[0].values).toEqual([400, null])
    expect(behaviorLines(thin, ['m'], errors)[0].values).toEqual([0.01, 0.01])
  })

  it('leaves a day without reasoning samples empty', () => {
    const reasoning = metricOf('reasoning')
    const lines = behaviorLines(behavior.models, ['gpt-6.1-sol'], reasoning)
    expect(lines[0].values).toEqual([null, null])
  })

  it('writes signed percents, bands and the last present value', () => {
    expect(signedPercent(0.724)).toBe('+72%')
    expect(signedPercent(-0.7)).toBe('−70%')
    expect(signedPercent(0.001)).toBe('0%')
    const limits = [2000, 16000, 64000]
    expect(bandLabel(limits, 1)).toBe('< 2k')
    expect(bandLabel(limits, 2)).toBe('2k–16k')
    expect(bandLabel(limits, 4)).toBe('≥ 64k')
    expect(bandLabel(limits, 0)).toBe('')
    expect(lastValue([1, null, 3, null])).toBe(3)
    expect(lastValue([null])).toBeUndefined()
  })
})

describe('ModelBehaviorPanel', () => {
  it('lists the models that moved on the last day above the chart', () => {
    render(
      <ModelBehaviorPanel data={behavior} source={{ status: 'success' }} />
    )
    const list = screen.getByRole('list', {
      name: 'Models that moved on the last day',
    })
    expect(within(list).getByText('gpt-6.1-sol')).toBeInTheDocument()
    expect(within(list).getByText('−70%')).toBeInTheDocument()
    expect(
      screen.getByText(
        'On the last day 1 model readings moved past a threshold: 1 red.'
      )
    ).toBeInTheDocument()
  })

  it('says nothing moved when there are no alerts', () => {
    render(
      <ModelBehaviorPanel
        data={{ ...behavior, alerts: [] }}
        source={{ status: 'success' }}
      />
    )
    expect(
      screen.getByText(
        'No model moved past 40% against its previous seven days.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Models that moved on the last day' })
    ).toBeNull()
  })

  it('offers every model and starts with the default ones pressed', async () => {
    render(
      <ModelBehaviorPanel data={behavior} source={{ status: 'success' }} />
    )
    const group = screen.getByRole('group', { name: 'Models shown' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    const haiku = within(group).getByRole('button', {
      name: 'claude-haiku-5-5',
    })
    expect(haiku).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(haiku)
    expect(haiku).toHaveAttribute('aria-pressed', 'true')
  })

  it('explains an empty reasoning chart instead of drawing nothing', async () => {
    render(
      <ModelBehaviorPanel data={behavior} source={{ status: 'success' }} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reasoning' }))
    expect(
      screen.getByText(/Reasoning tokens are recorded only for requests made/)
    ).toBeInTheDocument()
  })

  it('says so when no model has enough requests, and when hours are missing', () => {
    const { rerender } = render(
      <ModelBehaviorPanel
        data={{ ...behavior, models: [], alerts: [] }}
        source={{ status: 'success' }}
      />
    )
    expect(
      screen.getByText('No model has enough requests in this range')
    ).toBeInTheDocument()
    rerender(
      <ModelBehaviorPanel
        data={{ ...behavior, missing_hours: 3 }}
        source={{ status: 'success' }}
      />
    )
    expect(
      screen.getByText(/3 hours of this range are still being read/)
    ).toBeInTheDocument()
  })

  it('shows a failed read as an error, not as a quiet panel', () => {
    render(<ModelBehaviorPanel data={undefined} source={{ status: 'error' }} />)
    expect(screen.getByText('Could not be read')).toBeInTheDocument()
  })
})

describe('overview signal for models that moved', () => {
  const t = ((key: string, options?: Record<string, unknown>) =>
    key.replaceAll(/{{(\w+)}}/g, (_, name) => String(options?.[name]))) as never

  it('names the models with a red reading and links to the panel', () => {
    const [signal] = overviewBehaviorSignals(t, behavior)
    expect(signal.tone).toBe('danger')
    expect(signal.title).toBe(
      '1 models changed sharply on the last day: gpt-6.1-sol'
    )
    expect(signal.detail).toContain('gpt-6.1-sol Output length −70%')
    expect(signal.tab).toBe('quality')
  })

  it('stays silent for yellow readings, no data, or an older server', () => {
    const yellow = {
      ...behavior,
      alerts: [{ ...redFlag, level: 'yellow' as const, model: 'm' }],
    }
    expect(overviewBehaviorSignals(t, yellow)).toEqual([])
    expect(overviewBehaviorSignals(t, undefined)).toEqual([])
  })
})

describe('cache hit rate by vendor', () => {
  const quality = {
    requests: 300,
    errors: 0,
    error_rate: 0,
    ttft_p50_ms: 0,
    ttft_p95_ms: 0,
    cache_share: 0.937,
    daily: [],
    vendors: [
      {
        vendor: 'claude',
        models: [],
        requests: 100,
        errors: 0,
        error_rate: 0,
        ttft_p50_ms: 0,
        ttft_p95_ms: 0,
        cache_read: 960,
        cache_input: 1000,
        cache_share: 0.96,
      },
      {
        vendor: 'codex',
        models: [],
        requests: 200,
        errors: 0,
        error_rate: 0,
        ttft_p50_ms: 0,
        ttft_p95_ms: 0,
        cache_read: 620,
        cache_input: 1000,
        cache_share: 0.62,
      },
      {
        vendor: 'gemini',
        models: [],
        requests: 1,
        errors: 0,
        error_rate: 0,
        ttft_p50_ms: 0,
        ttft_p95_ms: 0,
      },
    ],
  } as unknown as QualityInsights

  it('gives GPT its own row beside the site-wide rate', () => {
    render(<CacheMixPanel data={quality} vendorName={(v) => v.toUpperCase()} />)
    const list = screen.getByRole('list', { name: 'Cache hit rate by vendor' })
    const rows = within(list).getAllByRole('listitem')
    // The caption, then one row per vendor that read any input.
    expect(rows).toHaveLength(3)
    expect(within(list).getByText('CODEX')).toBeInTheDocument()
    expect(within(list).getByText('62%')).toBeInTheDocument()
    expect(within(list).queryByText('GEMINI')).toBeNull()
  })

  it('omits the list from an older server that sends no vendor figures', () => {
    render(<CacheMixPanel data={{ ...quality, vendors: undefined }} />)
    expect(
      screen.queryByRole('list', { name: 'Cache hit rate by vendor' })
    ).toBeNull()
  })
})

describe('line styles', () => {
  it('draws a line past the palette’s fourth dashed so colors stay apart', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((name) =>
      model(name, 'codex', [day(0)])
    )
    const lines = behaviorLines(
      many,
      ['a', 'b', 'c', 'd', 'e'],
      metricOf('output')
    )
    expect(lines.map((line) => line.dashed)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ])
  })
})
