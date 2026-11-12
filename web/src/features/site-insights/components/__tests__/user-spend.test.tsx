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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getUserSpend } from '../../api'
import type { UserSpend, UserSpendHours } from '../../types'
import { UserSpendPanel } from '../user-spend'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  getUserSpend: vi.fn(),
}))

function spend(hours: UserSpendHours, patch: Partial<UserSpend> = {}) {
  return {
    hours,
    start_time: 0,
    end_time: hours * 3600,
    usd_exchange_rate: 5,
    engine_configured: true,
    customers: 2,
    quota_usd: 60,
    root_quota_usd: 10,
    engine_usd: 25,
    customer_engine_usd: 20,
    root_engine_usd: 5,
    unattributed_engine_usd: 0,
    users: [
      {
        user_id: 7,
        username: 'alice',
        email: 'alice@example.com',
        requests: 40,
        quota_usd: 50,
        engine_usd: 16.5,
        topup_paid: 300,
        subscription_paid: 99,
        balance_usd: 12.5,
      },
      {
        user_id: 9,
        username: 'bob',
        email: '',
        requests: 3,
        quota_usd: 10,
        engine_usd: 3.5,
        topup_paid: 0,
        subscription_paid: 0,
        balance_usd: -2,
      },
    ],
    ...patch,
  } satisfies UserSpend
}

function rowOf(table: HTMLElement, name: string) {
  const row = within(table).getByText(name).closest('tr')
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

function renderPanel(onOpen?: (tab: string) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <UserSpendPanel onOpen={onOpen} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.mocked(getUserSpend).mockReset()
})

describe('consumption by user', () => {
  it('reads the last 24 hours first and lists each customer', async () => {
    vi.mocked(getUserSpend).mockImplementation(async (hours) => spend(hours))
    renderPanel()

    const table = await screen.findByRole('table')
    expect(getUserSpend).toHaveBeenCalledWith(24)
    const alice = rowOf(table, 'alice')
    expect(within(alice).getByText('#7')).toBeInTheDocument()
    expect(within(alice).getByText('alice@example.com')).toBeInTheDocument()
    // new-api's charge in yuan, its dollars at ¥5 under it.
    expect(within(alice).getByText('¥50')).toBeInTheDocument()
    expect(within(alice).getByText('$10.00')).toBeInTheDocument()
    expect(within(alice).getByText('$16.50')).toBeInTheDocument()
    expect(within(alice).getByText('¥300')).toBeInTheDocument()
    expect(within(alice).getByText('Plans ¥99')).toBeInTheDocument()
    expect(within(alice).getByText('¥12.5')).toBeInTheDocument()

    const bob = rowOf(table, 'bob')
    expect(within(bob).getByText('-¥2')).toHaveClass('text-destructive')
    expect(within(bob).queryByText(/^Plans/)).toBeNull()

    expect(
      screen.getByText(
        '2 customers used ¥60 of new-api value and $20.00 at gpt-load’s official prices. Root’s and staff’s own use, ¥10 and $5.00, is not listed.'
      )
    ).toBeInTheDocument()
  })

  it('switches its own window without touching the page range', async () => {
    vi.mocked(getUserSpend).mockImplementation(async (hours) =>
      spend(hours, { customers: hours })
    )
    renderPanel()
    await screen.findByText(/^24 customers used/)

    fireEvent.click(screen.getByRole('button', { name: '1 hour' }))
    expect(await screen.findByText(/^1 customers used/)).toBeInTheDocument()
    expect(getUserSpend).toHaveBeenLastCalledWith(1)

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(await screen.findByText(/^168 customers used/)).toBeInTheDocument()
    expect(getUserSpend).toHaveBeenLastCalledWith(168)
  })

  it('shows the engine error and no gpt-load figures when it failed', async () => {
    vi.mocked(getUserSpend).mockImplementation(async (hours) =>
      spend(hours, { engine_error: 'engine timeout' })
    )
    renderPanel()

    expect(await screen.findByText('engine timeout')).toBeInTheDocument()
    const table = screen.getByRole('table')
    const alice = rowOf(table, 'alice')
    expect(within(alice).getByText('—')).toBeInTheDocument()
    expect(within(alice).queryByText('$16.50')).toBeNull()
    expect(
      screen.getByText(
        '2 customers used ¥60 of new-api value. Root’s and staff’s own use, ¥10, is not listed.'
      )
    ).toBeInTheDocument()
  })

  it('draws each customer as a card for a phone', async () => {
    vi.mocked(getUserSpend).mockImplementation(async (hours) => spend(hours))
    renderPanel()

    // The flags below the table are list items too; a card names its user id.
    const cards = (await screen.findAllByRole('listitem')).filter((item) =>
      within(item).queryByText(/^#\d+$/)
    )
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('alice@example.com')).toBeInTheDocument()
    expect(within(cards[0]).getByText('$16.50')).toBeInTheDocument()
    expect(within(cards[0]).getByText('¥300')).toBeInTheDocument()
    expect(within(cards[1]).getByText('-¥2')).toBeInTheDocument()
  })

  it('flags who is charged below cost, in debt or holds the window', async () => {
    vi.mocked(getUserSpend).mockImplementation(async (hours) => spend(hours))
    const onOpen = vi.fn()
    renderPanel(onOpen)

    const table = await screen.findByRole('table')
    // Alice: ¥50 is $10 at ¥5, under her $16.50, and 83% of the ¥60.
    expect(
      within(rowOf(table, 'alice')).getByText(
        'Below official cost · Large share'
      )
    ).toBeInTheDocument()
    expect(
      within(rowOf(table, 'bob')).getByText('Below official cost · In debt')
    ).toBeInTheDocument()
    // $6.50 short on Alice and $1.50 on Bob.
    expect(
      screen.getByText(
        '2 customers were charged $8.00 less than gpt-load’s official cost.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('alice used 83.3% of the window’s consumption.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Risk →' }))
    expect(onOpen).toHaveBeenCalledWith('risk')
  })
})
