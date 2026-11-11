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
  buildCanvasUrl,
  CANVAS_ORIGIN,
  pickCanvasKey,
} from '../lib/canvas-link'

const key = (name: string, group: string, status = 1) => ({
  name,
  group,
  status,
})

describe('pickCanvasKey', () => {
  it('prefers the enabled key named 创作台 over an auto key', () => {
    const named = key('创作台', 'default')
    expect(pickCanvasKey([key('a', 'auto'), named])).toBe(named)
  })

  it('falls back to the first enabled auto key', () => {
    const first = key('b', 'auto')
    expect(pickCanvasKey([key('a', 'default'), first, key('c', 'auto')])).toBe(
      first
    )
  })

  it('skips disabled keys, even the named one', () => {
    const auto = key('x', 'auto')
    expect(pickCanvasKey([key('创作台', 'auto', 2), auto])).toBe(auto)
  })

  it('matches the name exactly', () => {
    expect(pickCanvasKey([key('创作台 2', 'default')])).toBeUndefined()
  })

  it('returns undefined without a usable key', () => {
    expect(pickCanvasKey([])).toBeUndefined()
    expect(pickCanvasKey([key('a', 'auto', 2), key('b', 'vip')])).toBe(
      undefined
    )
  })
})

describe('buildCanvasUrl', () => {
  it('puts the encoded address and key in the fragment, not the query', () => {
    const url = buildCanvasUrl('https://corecode.live', 'sk-a+b/c')
    expect(url).toBe(
      `${CANVAS_ORIGIN}/#baseUrl=https%3A%2F%2Fcorecode.live&apiKey=sk-a%2Bb%2Fc`
    )
    expect(new URL(url).search).toBe('')
  })
})
