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
  EngineGroup,
  EnginePool,
  FinanceInsights,
  QualityInsights,
} from '../../types'
import { ProvidersPanel, ShareCharts, TopModelsPanel } from '../overview-charts'
import { ShareDonut } from '../share-donut'

const quality = {
  requests: 1000,
  vendors: [
    {
      vendor: 'codex',
      models: [],
      requests: 250,
      errors: 25,
      error_rate: 0.1,
      ttft_p50_ms: 5000,
      ttft_p95_ms: 9000,
    },
    {
      vendor: 'claude',
      models: [],
      requests: 750,
      errors: 0,
      error_rate: 0,
      ttft_p50_ms: 1500,
      ttft_p95_ms: 4000,
    },
  ],
  models: [
    {
      model: 'gpt-5',
      vendor: 'codex',
      requests: 250,
      errors: 25,
      error_rate: 0.1,
      ttft_p50_ms: 5000,
    },
    {
      model: 'claude-opus',
      vendor: 'claude',
      requests: 700,
      errors: 0,
      error_rate: 0,
      ttft_p50_ms: 1500,
    },
    {
      model: 'claude-haiku',
      vendor: 'claude',
      requests: 50,
      errors: 0,
      error_rate: 0,
      ttft_p50_ms: 900,
    },
  ],
} as unknown as QualityInsights

const finance = {
  daily: [
    { day: 1, vendor_usd: { claude: 10, codex: 2 } },
    { day: 2, vendor_usd: { claude: 5 } },
  ],
  methods: [
    { payment_method: 'stripe', money: 100, count: 1 },
    { payment_method: 'alipay', money: 300, count: 3 },
  ],
} as unknown as FinanceInsights

describe('overview charts', () => {
  it('names each provider with its accounts, slots and range figures', () => {
    const groups = [
      {
        id: 1,
        channel: 'claude',
        enabled: true,
        accounts: 4,
        eligible: 3,
        slots: 20,
        in_flight: 6,
      },
      {
        id: 2,
        channel: 'codex',
        enabled: true,
        accounts: 1,
        eligible: 0,
        slots: 5,
        in_flight: 0,
      },
      {
        id: 3,
        channel: 'grok',
        enabled: true,
        accounts: 0,
        eligible: 0,
        slots: 0,
        in_flight: 0,
      },
    ] as unknown as EngineGroup[]
    render(
      <ProvidersPanel
        pool={{ groups } as EnginePool}
        quality={quality}
        finance={finance}
      />
    )
    const claude = screen.getByRole('row', { name: /Claude/ })
    expect(within(claude).getByText('3 / 4')).toBeTruthy()
    expect(within(claude).getByText('6 / 20')).toBeTruthy()
    const gpt = screen.getByRole('row', { name: /GPT/ })
    expect(within(gpt).getByText('0 / 1')).toBeTruthy()
    expect(within(gpt).getByText('10%')).toBeTruthy()
    // Grok has neither accounts nor requests.
    expect(screen.queryByText('Grok')).toBeNull()
  })

  it('splits requests, charge and revenue into labelled shares', () => {
    render(<ShareCharts quality={quality} finance={finance} />)
    expect(
      screen.getByRole('img', { name: 'Requests by provider' })
    ).toBeTruthy()
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0)
    expect(screen.getAllByText('25%').length).toBeGreaterThan(0)
  })

  it('folds the smallest slices into Other and names a hovered slice', async () => {
    const slices = ['a', 'b', 'c', 'd'].map((key, index) => ({
      key,
      label: key.toUpperCase(),
      value: 4 - index,
      color: { stroke: '', fill: '' },
    }))
    render(
      <ShareDonut
        slices={slices}
        limit={3}
        format={String}
        ariaLabel='chart'
        totalLabel='Total'
        empty='none'
      />
    )
    expect(screen.queryByText('C')).toBeNull()
    expect(screen.getByText('Other')).toBeTruthy()
    expect(screen.getByText('Total')).toBeTruthy()
    await userEvent.hover(screen.getByText('A'))
    expect(screen.getAllByText('A')).toHaveLength(2)
  })

  it('ranks the busiest models by requests', () => {
    render(<TopModelsPanel quality={quality} />)
    const names = screen
      .getAllByText(/^(gpt-5|claude-opus|claude-haiku)$/)
      .map((node) => node.textContent)
    expect(names).toEqual(['claude-opus', 'gpt-5', 'claude-haiku'])
  })
})
