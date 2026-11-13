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

import { buildBoardRows, ourRank } from '../lib'
import type { RivalBoard, RivalPrice, RivalSite } from '../types'

function price(
  group: string,
  groupRatio: number,
  input: number | null
): RivalPrice {
  return {
    site_id: 0,
    model: 'claude-opus-5-5',
    group,
    raw_model: 'claude-opus-5-5',
    model_ratio: 2,
    completion_ratio: 5,
    cache_ratio: 0.05,
    group_ratio: groupRatio,
    input_cny: input,
    output_cny: input == null ? null : input * 5,
    cache_read_cny: null,
    updated_at: 0,
  }
}

function site(id: number, name: string, prices: RivalPrice[], topUp = 1) {
  return {
    id,
    slug: name.toLowerCase(),
    name,
    site_url: `https://${name.toLowerCase()}.example`,
    top_up_price: topUp,
    prices,
  } as RivalSite & { prices: RivalPrice[] }
}

// Opus 5.5 on 2026-11-13: official input $4 at ¥6.8 is ¥27.2; Packy's cc
// group (2.5 at ¥1) is ¥10, code0's cheapest group ¥4.8, ours (1.9) ¥7.6.
const board: RivalBoard = {
  enabled: true,
  proxy_set: true,
  model: 'claude-opus-5-5',
  models: [{ model: 'claude-opus-5-5', input_cny: 27.2, output_cny: 136 }],
  exchange_rate: 6.8,
  top_up_price: 1,
  ours: [
    {
      group: 'Claude 满血（可外接）',
      group_ratio: 2.05,
      input_cny: 8.2,
      output_cny: 41,
      cache_read_cny: null,
      cache_ratio: null,
    },
    {
      group: 'Claude 满血（仅限CC）',
      group_ratio: 1.9,
      input_cny: 7.6,
      output_cny: 38,
      cache_read_cny: null,
      cache_ratio: null,
    },
  ],
  sites: [
    site(1, 'Packy', [price('claude-officially', 7, 28), price('cc', 2.5, 10)]),
    site(2, 'Code0', [
      price('Max-high', 3, 12),
      price('微注入ccmax', 1.2, 4.8),
    ]),
    site(3, 'NoPrice', [price('default', 0.5, null)], 0),
  ],
  counts: {
    total: 3,
    ok: 3,
    unsupported: 0,
    error: 0,
    pending: 0,
    disabled: 0,
  },
  directory: { synced_at: 0, sites: 0, error: '' },
}

describe('buildBoardRows', () => {
  it('ranks each site at its cheapest group beside our groups', () => {
    const rows = buildBoardRows(board)
    expect(rows.map((r) => `${r.name}/${r.group}`)).toEqual([
      'Code0/微注入ccmax',
      'CoreCode/Claude 满血（仅限CC）',
      'CoreCode/Claude 满血（可外接）',
      'Packy/cc',
      'NoPrice/default',
    ])
    expect(rows[0].share).toBeCloseTo(4.8 / 27.2)
    expect(rows[1].share).toBeCloseTo(0.2794, 3)
    expect(rows[3].groups.map((g) => g.group)).toEqual([
      'cc',
      'claude-officially',
    ])
    expect(rows[4].share).toBeNull()
  })

  it('places our cheapest group among the priced sites', () => {
    expect(ourRank(buildBoardRows(board))).toEqual({ rank: 2, of: 3 })
    expect(ourRank(buildBoardRows({ ...board, ours: null }))).toBeNull()
  })
})
