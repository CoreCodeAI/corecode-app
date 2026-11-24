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
import { describe, expect, it } from 'vitest'

import {
  blocksAt,
  stagesSeen,
  type GateBlockPoint,
} from '../../risk-gate-stages'
import type { RiskInsights } from '../../types'
import { GateBlocksPanel } from '../risk-blocks'

const DAY = 86400
const start = 1761408000

const series: GateBlockPoint[] = [
  { at: start, stages: { hard_regex: 3, decision: 1 } },
  { at: start + DAY, stages: { distill: 2, hard_regex: 1 } },
  { at: start + 2 * DAY, stages: {} },
]

function risk(overrides: Partial<RiskInsights> = {}): RiskInsights {
  return {
    signups: 0,
    signup_series: [],
    series_unit: 'day',
    gate_blocked: 7,
    gate_block_series: series,
    ...overrides,
  } as unknown as RiskInsights
}

describe('gate block stages', () => {
  it('lists the stages that fired in the order a request passes them, then unknown ones', () => {
    expect(stagesSeen(series)).toEqual(['distill', 'hard_regex', 'decision'])
    expect(
      stagesSeen([{ at: 0, stages: { zeta: 1, refusal_cache: 2, never: 0 } }])
    ).toEqual(['refusal_cache', 'zeta'])
    expect(stagesSeen(null)).toEqual([])
  })

  it('sums a point’s blocks across stages, and a null map is none', () => {
    expect(blocksAt(series[0])).toBe(4)
    expect(blocksAt({ at: 0, stages: null })).toBe(0)
  })
})

describe('GateBlocksPanel', () => {
  it('stacks blocks by stage with the count in its description', () => {
    render(
      <GateBlocksPanel
        data={risk()}
        range={{ start, end: start + 3 * DAY, days: 3, hourly: false }}
      />
    )
    expect(screen.getByText('Gate blocks by stage')).toBeInTheDocument()
    expect(
      screen.getByText('7 requests blocked in this range.')
    ).toBeInTheDocument()
    // The legend names each stage that fired and no other.
    expect(screen.getAllByText('Distillation').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Hard regex').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Decision model').length).toBeGreaterThan(0)
    expect(screen.queryByText('Refusal cache')).not.toBeInTheDocument()
  })

  it('draws nothing on a server that does not send the series', () => {
    const { container } = render(
      <GateBlocksPanel data={risk({ gate_block_series: undefined })} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('says the figures could not be read when the view failed', () => {
    render(<GateBlocksPanel data={undefined} failed />)
    expect(screen.getByText('Could not be read')).toBeInTheDocument()
  })
})
