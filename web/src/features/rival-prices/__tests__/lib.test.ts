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

import { boardStats, buildBoardRows } from '../lib'
import type {
  RivalBoard,
  RivalBoardPrice,
  RivalKind,
  RivalSite,
  RivalTrust,
} from '../types'

function price(
  group: string,
  kind: RivalKind,
  input: number | null,
  blended: number | null = input == null ? null : input / 2
): RivalBoardPrice {
  return {
    site_id: 0,
    model: 'claude-opus-5-5',
    group,
    raw_model: 'claude-opus-5-5',
    model_ratio: 2,
    completion_ratio: 5,
    cache_ratio: 0.05,
    create_cache_ratio: 1.25,
    group_ratio: 1,
    input_cny: input,
    output_cny: input == null ? null : input * 5,
    cache_read_cny: null,
    updated_at: 0,
    kind,
    kind_overridden: false,
    blended_cny: blended,
  }
}

function site(
  id: number,
  name: string,
  prices: RivalBoardPrice[],
  trust: RivalTrust = 'ok'
) {
  return {
    id,
    slug: name.toLowerCase(),
    name,
    site_url: '',
    top_up_price: 1,
    trust,
    prices,
  } as RivalSite & {
    trust: RivalTrust
    prices: RivalBoardPrice[]
  }
}

// Opus 5.5 on 2026-11-13: official input ¥27.2. Code0's cheapest group is a
// pool at ¥4.8 but its Kiro group is cheaper; Packy's pool is ¥10, ours ¥7.6.
const board: RivalBoard = {
  enabled: true,
  proxy_set: true,
  feishu_set: false,
  our_kind: 'pool',
  kinds: ['official', 'cloud', 'pool', 'kiro', 'reverse', 'default', 'other'],
  model: 'claude-opus-5-5',
  models: [
    {
      model: 'claude-opus-5-5',
      input_cny: 27.2,
      output_cny: 136,
      blended_cny: 13.6,
      mix: null,
    },
  ],
  exchange_rate: 6.8,
  top_up_price: 1,
  ours: [
    {
      group: '可外接',
      kind: 'pool',
      group_ratio: 2.05,
      input_cny: 8.2,
      output_cny: 41,
      blended_cny: 4.1,
      cache_read_cny: null,
      cache_ratio: 0.05,
    },
    {
      group: '仅限CC',
      kind: 'pool',
      group_ratio: 1.9,
      input_cny: 7.6,
      output_cny: 38,
      blended_cny: 3.8,
      cache_read_cny: null,
      cache_ratio: 0.05,
    },
  ],
  sites: [
    site(1, 'Packy', [
      price('claude-officially', 'official', 28),
      price('cc', 'pool', 10),
    ]),
    site(2, 'Code0', [
      price('Claude-kiro', 'kiro', 2),
      price('微注入ccmax', 'pool', 4.8),
    ]),
    site(3, 'Defaulted', [price('cc', 'pool', 1)], 'default'),
    // Cheap by input, dear blended: no cache discount.
    site(4, 'NoCache', [price('max', 'pool', 5, 9)]),
  ],
  counts: {
    total: 4,
    ok: 4,
    unsupported: 0,
    error: 0,
    pending: 0,
    disabled: 0,
  },
  directory: { synced_at: 0, sites: 0, error: '' },
}

describe('buildBoardRows', () => {
  it('compares our pool with other pools, by the blended price', () => {
    const rows = buildBoardRows(board, {
      kind: 'pool',
      metric: 'blended',
      includeUntrusted: false,
    })
    expect(rows.map((r) => `${r.name}/${r.group}`)).toEqual([
      'Code0/微注入ccmax',
      'CoreCode/仅限CC',
      'CoreCode/可外接',
      'Packy/cc',
      'NoCache/max',
    ])
    expect(rows[0].share).toBeCloseTo(2.4 / 13.6)
  })

  it('ranks the other way by input price', () => {
    const rows = buildBoardRows(board, {
      kind: 'pool',
      metric: 'input',
      includeUntrusted: false,
    })
    expect(rows.map((r) => r.name)).toEqual([
      'Code0',
      'NoCache',
      'CoreCode',
      'CoreCode',
      'Packy',
    ])
  })

  it('leaves untrusted sites out unless asked', () => {
    const rows = buildBoardRows(board, {
      kind: 'pool',
      metric: 'input',
      includeUntrusted: true,
    })
    expect(rows[0].name).toBe('Defaulted')
    expect(rows[0].trust).toBe('default')
  })

  it('shows each site at its cheapest group of every kind when asked', () => {
    const rows = buildBoardRows(board, {
      kind: 'all',
      metric: 'input',
      includeUntrusted: false,
    })
    expect(rows[0]).toMatchObject({
      name: 'Code0',
      group: 'Claude-kiro',
      kind: 'kiro',
    })
  })

  it('falls back to input when there is no blended official price', () => {
    const noMix = {
      ...board,
      models: [{ ...board.models[0], blended_cny: null }],
    }
    const rows = buildBoardRows(noMix, {
      kind: 'pool',
      metric: 'blended',
      includeUntrusted: false,
    })
    expect(rows[0].share).toBeCloseTo(4.8 / 27.2)
  })
})

describe('boardStats', () => {
  it('places our cheapest group among the sites of the kind', () => {
    const rows = buildBoardRows(board, {
      kind: 'pool',
      metric: 'blended',
      includeUntrusted: false,
    })
    const stats = boardStats(rows, board, 'blended')
    expect(stats).toMatchObject({
      sites: 3,
      ours: 3.8,
      cheaper: 1,
      cheapest: 2.4,
      median: 5,
    })
    expect(stats.percentile).toBeCloseTo(1 / 3)
  })
})
