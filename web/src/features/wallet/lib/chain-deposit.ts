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
import type {
  ChainDepositNetwork,
  ChainDepositStage,
  ChainDepositTransfer,
} from '../types'

/**
 * The networks a deposit address can be shown with: those that list at least
 * one token, in the order the server gave them.
 */
export function usableChainDepositNetworks(
  networks: ChainDepositNetwork[] | undefined
): ChainDepositNetwork[] {
  return (networks ?? []).filter((network) => network.tokens?.length > 0)
}

const EXPLORERS: Record<number, string> = {
  56: 'https://bscscan.com',
  97: 'https://testnet.bscscan.com',
  42161: 'https://arbiscan.io',
  421614: 'https://sepolia.arbiscan.io',
}

/**
 * A token contract's page on its chain's block explorer, or null for a chain
 * without a known explorer.
 */
export function chainDepositTokenUrl(
  chainId: number,
  contract: string
): string | null {
  const base = EXPLORERS[chainId]
  return base ? `${base}/token/${contract}` : null
}

/**
 * Splits an address so its first and last six characters can be checked at a
 * glance: "0x" and six characters, the middle, and the last six.
 */
export function chainDepositTxUrl(
  chainId: number,
  hash: string
): string | null {
  const base = EXPLORERS[chainId]
  return base ? `${base}/tx/${hash}` : null
}

export function splitDepositAddress(address: string): {
  head: string
  middle: string
  tail: string
} {
  const headLength = address.startsWith('0x') ? 8 : 6
  if (address.length <= headLength + 6) {
    return { head: address, middle: '', tail: '' }
  }
  return {
    head: address.slice(0, headLength),
    middle: address.slice(headLength, -6),
    tail: address.slice(-6),
  }
}

/** A progress step's state */
export type ChainDepositStepState = 'done' | 'active' | 'held' | 'pending'

/**
 * The three steps a transfer goes through, detected, confirmed and credited,
 * at a stage. A transfer under 1 USD holds at the last step.
 */
export function chainDepositSteps(
  stage: ChainDepositStage
): [ChainDepositStepState, ChainDepositStepState, ChainDepositStepState] {
  switch (stage) {
    case 'confirming':
      return ['done', 'active', 'pending']
    case 'crediting':
      return ['done', 'done', 'active']
    case 'waiting':
      return ['done', 'done', 'held']
    case 'credited':
      return ['done', 'done', 'done']
  }
}

/** How long a credited transfer stays in the dialog, in seconds */
const SHOWN_AFTER_CREDIT = 30 * 60

/**
 * The one transfer the dialog follows: the newest the service has seen, while
 * it is not yet credited or was seen in the last half hour before `now` (unix
 * seconds). Older transfers stay in the wallet's records, not here.
 */
export function shownChainDepositTransfer(
  transfers: ChainDepositTransfer[] | undefined,
  now: number
): ChainDepositTransfer | null {
  let newest: ChainDepositTransfer | null = null
  for (const transfer of transfers ?? []) {
    if (!newest || transfer.seen_at > newest.seen_at) newest = transfer
  }
  if (!newest) return null
  return newest.stage !== 'credited' ||
    newest.seen_at >= now - SHOWN_AFTER_CREDIT
    ? newest
    : null
}
