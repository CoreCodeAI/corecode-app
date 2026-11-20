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
import { describe, expect, test } from 'vitest'

import type { ChainDepositNetwork } from '../types'
import {
  chainDepositTokenUrl,
  splitDepositAddress,
  usableChainDepositNetworks,
} from './chain-deposit'

const bsc: ChainDepositNetwork = {
  network: 'bsc',
  name: 'BNB Smart Chain',
  chain_id: 56,
  tokens: [{ symbol: 'USDT', contract: '0x55d3', decimals: 18 }],
}

describe('chain deposit helpers', () => {
  test('lists only networks that name a token', () => {
    const empty: ChainDepositNetwork = { ...bsc, network: 'base', tokens: [] }
    expect(usableChainDepositNetworks([bsc, empty])).toEqual([bsc])
    expect(usableChainDepositNetworks(undefined)).toEqual([])
  })

  test('links a token to its chain explorer', () => {
    expect(chainDepositTokenUrl(56, '0x55d3')).toBe(
      'https://bscscan.com/token/0x55d3'
    )
    expect(chainDepositTokenUrl(42161, '0xaf88')).toBe(
      'https://arbiscan.io/token/0xaf88'
    )
    expect(chainDepositTokenUrl(8453, '0x1')).toBeNull()
  })

  test('splits an address into its first and last six characters', () => {
    const address = '0xa60e2385a464C40e59117DC60fB60603A3155658'
    const parts = splitDepositAddress(address)
    expect(parts).toEqual({
      head: '0xa60e23',
      middle: '85a464C40e59117DC60fB60603A3',
      tail: '155658',
    })
    expect(parts.head + parts.middle + parts.tail).toBe(address)
    expect(splitDepositAddress('0x1234')).toEqual({
      head: '0x1234',
      middle: '',
      tail: '',
    })
  })
})
