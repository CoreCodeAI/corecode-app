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

import { getFirstRunSteps, isFirstRun } from '../first-run'

describe('first-run steps', () => {
  it('is a first run only with no requests and no spend', () => {
    expect(isFirstRun({ request_count: 0, used_quota: 0 })).toBe(true)
    expect(isFirstRun({})).toBe(true)
    expect(isFirstRun({ request_count: 1, used_quota: 0 })).toBe(false)
    expect(isFirstRun({ request_count: 0, used_quota: 5 })).toBe(false)
  })

  it('derives each step from balance, keys and requests', () => {
    const done = (input: Parameters<typeof getFirstRunSteps>[0]) =>
      getFirstRunSteps(input).map((step) => step.done)

    expect(done({ available: 0, keyCount: 0, requestCount: 0 })).toEqual([
      false,
      false,
      false,
      false,
    ])
    expect(done({ available: 10, keyCount: 1, requestCount: 0 })).toEqual([
      true,
      true,
      false,
      false,
    ])
    expect(done({ available: 10, keyCount: 1, requestCount: 3 })).toEqual([
      true,
      true,
      true,
      true,
    ])
  })
})
