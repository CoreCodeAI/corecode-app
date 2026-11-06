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
import { afterEach, describe, expect, it } from 'vitest'

import { readPoolRefresh, writePoolRefresh } from '../lib'

afterEach(() => localStorage.clear())

describe('pool refresh interval', () => {
  it('starts at 15 seconds when nothing was chosen', () => {
    expect(readPoolRefresh()).toBe(15)
  })

  it('keeps a chosen interval, including off', () => {
    writePoolRefresh(60)
    expect(readPoolRefresh()).toBe(60)
    writePoolRefresh(0)
    expect(readPoolRefresh()).toBe(0)
  })

  it('falls back to 15 seconds for a value it does not offer', () => {
    localStorage.setItem('site-insights:pool-refresh-seconds', '1')
    expect(readPoolRefresh()).toBe(15)
    localStorage.setItem('site-insights:pool-refresh-seconds', 'abc')
    expect(readPoolRefresh()).toBe(15)
  })
})
