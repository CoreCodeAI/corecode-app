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
import { describe, expect, it, vi } from 'vitest'

import { consumeResetCredit } from '../../api'
import type { EngineAccount } from '../../types'
import { ResetCreditsCell } from '../reset-credits-cell'

vi.mock('../../api', () => ({ consumeResetCredit: vi.fn() }))

const row = {
  credential_id: 21,
  group_id: 7,
  email_mask: 'a***@example.com',
  reset_credits: [
    { expires_at_ms: Date.UTC(2026, 11, 10), kind: 'full' },
    { expires_at_ms: Date.UTC(2027, 2, 9), kind: 'partial' },
  ],
} as EngineAccount

function renderCell(account: EngineAccount) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ResetCreditsCell row={account} at={(ms) => String(ms)} />
    </QueryClientProvider>
  )
}

describe('ResetCreditsCell', () => {
  it('offers one redemption per kind', () => {
    renderCell(row)
    expect(screen.getByRole('button', { name: /Full reset 1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Partial reset 1/ })).toBeTruthy()
  })

  it('shows a dash without credits', () => {
    renderCell({ ...row, reset_credits: [] })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('redeems the chosen kind and reuses the key after an unknown outcome', async () => {
    const consume = vi.mocked(consumeResetCredit)
    consume
      .mockRejectedValueOnce(
        new Error('unknown', {
          cause: { success: false, code: 'RESET_CREDIT_OUTCOME_UNKNOWN' },
        })
      )
      .mockResolvedValueOnce({
        status: 'succeeded',
        windows_reset: 2,
        observation_pending: false,
        replayed: true,
      })
    const user = userEvent.setup()
    renderCell(row)
    await user.click(screen.getByRole('button', { name: /Partial reset 1/ }))
    await user.click(screen.getByRole('button', { name: 'Use reset credit' }))
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1))
    // The dialog stays open, so the same redemption can be checked again.
    await user.click(screen.getByRole('button', { name: 'Use reset credit' }))
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(2))
    const [first, second] = consume.mock.calls.map(([params]) => params)
    expect(first).toMatchObject({
      groupId: 7,
      credentialId: 21,
      kind: 'partial',
    })
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
  })
})
