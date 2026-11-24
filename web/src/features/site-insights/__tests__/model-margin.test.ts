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
import { describe, expect, it } from 'vitest'

import {
  marginExtremes,
  modelMargins,
  placeLabels,
  trafficModels,
  type Point,
} from '../finance-model-margin'
import type { FinanceInsights, ModelAllocation } from '../types'

const DAY = 86400

// A 30-day range with two Pro accounts on claude: $20 each a month, so at 7
// yuan a dollar 280 for the range (see group-margin.test.ts).
function data(allocations: ModelAllocation[] | null | undefined) {
  return {
    start_time: 0,
    end_time: 30 * DAY,
    vendor_revenue: [
      { vendor: 'claude', customer_usd: 0, share: 0, recognized_revenue: 480 },
      { vendor: 'codex', customer_usd: 0, share: 0, recognized_revenue: 20 },
    ],
    plan_accounts: [
      {
        vendor: 'claude',
        plan: 'Pro',
        tier: 'default_claude_ai',
        accounts: 2,
        eligible: 2,
      },
    ],
    vendor_upstream: [],
    upstream_unattributed_bill_usd: 0,
    upstream_unattributed_fee_usd: 0,
    model_allocations: allocations,
  } as unknown as FinanceInsights
}

function row(over: Partial<ModelAllocation>): ModelAllocation {
  return {
    model: 'm',
    kind: 'model',
    vendor: 'claude',
    requests: 0,
    revenue_usd: 0,
    costed_revenue_usd: 0,
    bill_usd: 0,
    fee_usd: 0,
    pool_share: null,
    ...over,
  }
}

const ALLOCATIONS: ModelAllocation[] = [
  row({
    model: 'claude-opus',
    requests: 100,
    revenue_usd: 400,
    costed_revenue_usd: 400,
    pool_share: { claude: 0.75 },
  }),
  row({
    model: 'gpt-6',
    vendor: 'codex',
    requests: 900,
    revenue_usd: 100,
    costed_revenue_usd: 100,
    bill_usd: 10,
    fee_usd: 2,
    pool_share: { claude: 0.25 },
  }),
  row({
    model: 'mystery',
    vendor: 'other',
    requests: 40,
    revenue_usd: 50,
    costed_revenue_usd: 10,
    bill_usd: 1,
  }),
  row({ model: '', kind: 'staff', bill_usd: 3 }),
  row({ model: '', kind: 'unattributed', bill_usd: 2, fee_usd: 1 }),
]

describe('modelMargins', () => {
  it('is null on a server that sends no allocation', () => {
    expect(modelMargins(data(undefined), 7)).toBeNull()
    expect(modelMargins(data(null), 7)).toBeNull()
  })

  it('splits cost by the shares, a fee at the rate, and rates over the costed charge', () => {
    const margins = modelMargins(data(ALLOCATIONS), 7)
    expect(margins).not.toBeNull()
    const [opus, gpt, mystery] = margins?.rows ?? []
    expect(opus).toMatchObject({
      model: 'claude-opus',
      revenue: 400,
      cost: 210,
      margin: 190,
      marginRate: 190 / 400,
      coverage: 1,
      thin: false,
      revenuePerRequest: 4,
      marginPerRequest: 1.9,
    })
    // 10 bill + 2 x 7 fee + 0.25 x 280 pool.
    expect(gpt).toMatchObject({
      model: 'gpt-6',
      cost: 94,
      margin: 6,
      marginRate: 0.06,
      thin: true,
    })
    expect(mystery).toMatchObject({
      model: 'mystery',
      coverage: 0.2,
      cost: null,
      margin: null,
      marginRate: null,
      marginPerRequest: null,
      thin: false,
    })
  })

  it('counts only the models with enough known cost, and says how much was left out', () => {
    const margins = modelMargins(data(ALLOCATIONS), 7)
    expect(margins).toMatchObject({
      revenue: 550,
      costedRevenue: 500,
      coverage: 500 / 550,
      cost: 304,
      margin: 196,
      marginRate: 196 / 500,
      unknownRevenue: 50,
      staffCost: 3,
      idleCost: 2 + 7,
    })
  })

  it('divides a part-costed model’s margin over the costed share of its requests', () => {
    const margins = modelMargins(
      data([
        row({
          model: 'half-known',
          requests: 100,
          revenue_usd: 100,
          costed_revenue_usd: 60,
          bill_usd: 30,
        }),
      ]),
      7
    )
    expect(margins?.rows[0]).toMatchObject({
      coverage: 0.6,
      cost: 30,
      margin: 30,
      marginRate: 0.5,
      marginPerRequest: 30 / 60,
      revenuePerRequest: 1,
    })
  })

  it('gives empty figures for an empty allocation', () => {
    const margins = modelMargins(data([]), 7)
    expect(margins).toMatchObject({
      rows: [],
      revenue: 0,
      coverage: null,
      marginRate: null,
    })
  })

  it('skips a model with neither charge nor cost, and sorts by charge', () => {
    const margins = modelMargins(
      data([
        row({ model: 'idle' }),
        row({ model: 'b', revenue_usd: 5, costed_revenue_usd: 5 }),
        row({ model: 'a', revenue_usd: 9, costed_revenue_usd: 9 }),
      ]),
      7
    )
    expect(margins?.rows.map((r) => r.model)).toEqual(['a', 'b'])
  })
})

describe('marginExtremes and trafficModels', () => {
  const margins = modelMargins(
    data([
      ...ALLOCATIONS,
      row({
        model: 'loss',
        requests: 10,
        revenue_usd: 20,
        costed_revenue_usd: 20,
        bill_usd: 30,
      }),
    ]),
    7
  )
  const rows = margins?.rows ?? []

  it('names the biggest margins and every loss, leaving out the unknown', () => {
    const { top, losing } = marginExtremes(rows)
    expect(top.map((r) => r.model)).toEqual(['claude-opus', 'gpt-6'])
    expect(losing.map((r) => r.model)).toEqual(['loss'])
  })

  it('finds the thin models that carry a real share of the requests', () => {
    // gpt-6: 900 of 1010 counted requests at 6%; loss is thin but 1%.
    expect(trafficModels(rows).map((r) => r.model)).toEqual(['gpt-6'])
    expect(trafficModels([])).toEqual([])
  })
})

describe('placeLabels', () => {
  const margins = modelMargins(
    data([
      ...ALLOCATIONS,
      row({
        model: 'loss',
        requests: 10,
        revenue_usd: 20,
        costed_revenue_usd: 20,
        bill_usd: 30,
      }),
    ]),
    7
  )
  const rows = margins?.rows ?? []
  const at = (model: string, x: number, y: number): Point => ({
    row: rows.find((r) => r.model === model) ?? rows[0],
    x,
    y,
    r: 5,
  })

  it('names a loss first, then the largest charges', () => {
    const labels = placeLabels(
      [at('claude-opus', 100, 20), at('gpt-6', 100, 60), at('loss', 100, 100)],
      520
    )
    expect(labels.map((label) => label.row.model)).toEqual([
      'loss',
      'claude-opus',
      'gpt-6',
    ])
    expect(labels.every((label) => label.anchor === 'start')).toBe(true)
  })

  it('tries the left side, then skips a name that fits neither', () => {
    const labels = placeLabels(
      [
        at('claude-opus', 100, 20),
        at('gpt-6', 100, 22),
        at('mystery', 100, 21),
      ],
      520
    )
    expect(labels.map((label) => [label.row.model, label.anchor])).toEqual([
      ['claude-opus', 'start'],
      ['gpt-6', 'end'],
    ])
  })

  it('puts a name left of its bubble near the right edge, and drops one that fits neither side', () => {
    const near = placeLabels([at('claude-opus', 500, 20)], 520)
    expect(near[0].anchor).toBe('end')
    expect(placeLabels([at('claude-opus', 40, 20)], 60)).toEqual([])
  })
})
