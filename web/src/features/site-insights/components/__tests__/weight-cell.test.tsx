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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveCredentialWeight } from '../../api'
import type { EngineAccount } from '../../types'
import { WeightCell } from '../weight-cell'

vi.mock('../../api', () => ({ saveCredentialWeight: vi.fn() }))

const row = { credential_id: 21, group_id: 7, weight: 50 } as EngineAccount

function renderCell(account: EngineAccount) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WeightCell row={account} />
    </QueryClientProvider>
  )
}

async function pick(name: RegExp) {
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('combobox', { name: 'Schedule weight of account #21' })
  )
  await user.click(await screen.findByRole('option', { name }))
}

describe('WeightCell', () => {
  beforeEach(() => vi.mocked(saveCredentialWeight).mockReset())

  it('saves a preset as the engine weight', async () => {
    vi.mocked(saveCredentialWeight).mockResolvedValue()
    renderCell(row)
    await pick(/^×2$/)
    await vi.waitFor(() =>
      expect(saveCredentialWeight).toHaveBeenCalledWith({
        groupId: 7,
        credentialId: 21,
        weight: 100,
      })
    )
  })

  it('clears the weight for the default instead of storing 50', async () => {
    vi.mocked(saveCredentialWeight).mockResolvedValue()
    renderCell({ ...row, weight: 100 })
    await pick(/^×1 \(default\)$/)
    await vi.waitFor(() =>
      expect(saveCredentialWeight).toHaveBeenCalledWith({
        groupId: 7,
        credentialId: 21,
        weight: null,
      })
    )
  })

  it('keeps a weight set elsewhere listed', async () => {
    renderCell({ ...row, weight: 60 })
    expect(
      screen.getByRole('combobox', { name: 'Schedule weight of account #21' })
    ).toHaveTextContent('×1.2')
  })

  it('shows a dash before the server reports weights', () => {
    renderCell({ ...row, weight: undefined })
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
