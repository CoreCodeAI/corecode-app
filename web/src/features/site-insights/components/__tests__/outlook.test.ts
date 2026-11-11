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
  accountsToAdd,
  coverage,
  nearestSample,
  pickModel,
  samplesWithin,
  windowOf,
} from '../outlook'
import { outlook, outlookModel, outlookWindow } from './outlook-fixture'

describe('a window’s coverage', () => {
  const supply = outlook().remaining

  it('is short whenever demand went unserved, however large the supply', () => {
    // $7,200 of supply against $6,000 of demand, yet $300 arrived too late.
    const window = outlookWindow(24, { demand_usd: 6000, short_usd: 300 })
    expect(coverage(window, windowOf(supply, 24))).toBe('short')
  })

  it('is tight when demand takes more than four fifths of the supply', () => {
    expect(
      coverage(outlookWindow(24, { demand_usd: 5800 }), windowOf(supply, 24))
    ).toBe('tight')
    expect(
      coverage(outlookWindow(24, { demand_usd: 5700 }), windowOf(supply, 24))
    ).toBe('enough')
  })

  it('reads a window the server did not send as enough', () => {
    expect(coverage(undefined, windowOf(supply, 24))).toBe('enough')
  })
})

describe('accounts to add', () => {
  const addition = outlookModel('smart').additions[0]

  it('takes the more of keeping up and covering the week', () => {
    expect(accountsToAdd({ ...addition, keep_up: 18, cover_week: 17 })).toBe(18)
    expect(accountsToAdd({ ...addition, keep_up: 2, cover_week: 5 })).toBe(5)
  })

  it('has no count when the server’s search found none', () => {
    expect(accountsToAdd({ ...addition, keep_up: 88, cover_week: null })).toBe(
      null
    )
  })
})

describe('the model shown', () => {
  it('is the one picked when the server could build it', () => {
    expect(pickModel(outlook(), 'history')?.id).toBe('history')
  })

  it('falls back to the last one built', () => {
    expect(pickModel(outlook(), 'linear_12h')?.id).toBe('smart')
    const linearOnly = outlook({
      models: [
        outlookModel('linear_24h'),
        outlookModel('history', { available: false }),
        outlookModel('smart', { available: false }),
      ],
    })
    expect(pickModel(linearOnly, 'smart')?.id).toBe('linear_24h')
    expect(pickModel(outlook({ models: [] }), 'smart')).toBeUndefined()
  })
})

describe('curve samples', () => {
  const hours = [0, 1, 2, 3, 4, 5, 12, 24, 96, 168]

  it('counts the samples inside a window, its end included', () => {
    expect(samplesWithin(hours, 5)).toBe(6)
    expect(samplesWithin(hours, 24)).toBe(8)
    expect(samplesWithin(hours, 168)).toBe(10)
  })

  it('finds the sample nearest a moment', () => {
    expect(nearestSample(hours, 0)).toBe(0)
    expect(nearestSample(hours, 1.4)).toBe(1)
    expect(nearestSample(hours, 1.6)).toBe(2)
    expect(nearestSample(hours, 60)).toBe(7)
    expect(nearestSample(hours, 61)).toBe(8)
    expect(nearestSample(hours, 400)).toBe(9)
  })
})
