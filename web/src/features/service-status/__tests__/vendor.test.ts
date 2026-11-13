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

import { groupVendorKey, vendorCounts } from '../lib/vendor'

const GROUPS = [
  { name: 'Claude 满血（仅限CC）', model: 'claude-opus-5-5' },
  { name: 'Claude 满血（可外接）', model: 'claude-opus-5-5' },
  { name: 'GPT（仅限Codex）', model: 'gpt-6.1-sol' },
  { name: 'GPT', model: 'gpt-6.1-sol' },
  { name: 'Grok', model: 'grok-4.7' },
  { name: 'GPT生图1-4K', model: 'gpt-image-2.5-sunburst' },
  { name: 'Seedance视频', model: 'seedance-2.5-720p-fixed' },
  { name: 'GPT 福利', model: 'gpt-6.1-sol' },
]

describe('vendorCounts', () => {
  it('counts the live groups by vendor, the largest first', () => {
    expect(vendorCounts(GROUPS).map((item) => [item.key, item.count])).toEqual([
      ['OpenAI', 4],
      ['Anthropic', 2],
      ['xAI', 1],
      ['ByteDance', 1],
    ])
  })

  it('names a group with no traffic by its own name', () => {
    expect(groupVendorKey({ name: 'Claude 备用', model: null })).toBe(
      'Anthropic'
    )
  })

  it('puts groups of no known vendor last, under an empty key', () => {
    const counts = vendorCounts([
      { name: '神秘分组', model: null },
      { name: 'GPT', model: 'gpt-6.1-sol' },
    ])
    expect(counts.map((item) => item.key)).toEqual(['OpenAI', ''])
    expect(counts[1].icon).toBeNull()
  })
})
