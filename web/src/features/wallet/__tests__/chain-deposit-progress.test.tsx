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
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { ChainDepositProgress } from '../components/dialogs/chain-deposit-progress'
import type { ChainDepositNetwork, ChainDepositTransfer } from '../types'

afterEach(() => {
  cleanup()
})

const networks: ChainDepositNetwork[] = [
  { network: 'bsc', name: 'BNB Smart Chain', chain_id: 56, tokens: [] },
]

const hash = `0x81b4${'0'.repeat(56)}42e4`

function transfer(
  stage: ChainDepositTransfer['stage'],
  extra: Partial<ChainDepositTransfer> = {}
): ChainDepositTransfer {
  return {
    network: 'bsc',
    network_name: 'BNB Smart Chain',
    token: 'USDT',
    amount: '5',
    tx_hash: hash,
    seen_at: 1,
    stage,
    ...extra,
  }
}

it('shows a confirming transfer with its coins, link and current step', () => {
  render(
    <ChainDepositProgress
      transfers={[transfer('confirming')]}
      networks={networks}
    />
  )

  expect(screen.getByText('5 USDT')).toBeTruthy()
  const link = screen.getByRole('link', {
    name: 'View the transaction on the block explorer',
  })
  expect(link.getAttribute('href')).toBe(`https://bscscan.com/tx/${hash}`)
  const steps = within(screen.getByRole('list')).getAllByRole('listitem')
  expect(steps.map((step) => step.textContent)).toEqual([
    'Transfer detected',
    'Confirming on chain',
    'Crediting to your wallet',
  ])
  expect(screen.getByRole('status').textContent).toBe(
    '5 USDT: Confirming on chain'
  )
  expect(screen.getByText('Usually takes a few seconds')).toBeTruthy()
})

it('announces only the newest transfer and shows what a credit added', () => {
  render(
    <ChainDepositProgress
      transfers={[
        transfer('waiting', { amount: '0.5', tx_hash: `0x${'cd'.repeat(32)}` }),
        transfer('credited', { credited: 34, bonus: 0 }),
      ]}
      networks={networks}
    />
  )

  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getByRole('status').textContent).toBe(
    '0.5 USDT: Under 1 USD: credited once your deposits add up to 1 USD.'
  )
  expect(
    screen.getByText(
      'Under 1 USD: credited once your deposits add up to 1 USD.'
    )
  ).toBeTruthy()
  expect(screen.getByText(/^Credited .*34/)).toBeTruthy()
  expect(screen.getByText('Credited to your wallet')).toBeTruthy()
})
